import { PlatformAccessory } from 'homebridge';
import { NordpoolPlatform } from './platform';

import {
  defaultPricing, defaultService, defaultAreaTimezone, PLATFORM_MANUFACTURER,
} from './settings';

import {
  getCheapestConsecutiveHours,
} from './functions';

import { schedule } from 'node-cron';
import { DateTime } from 'luxon';
import NodeCache from 'node-cache';
import axios from 'axios';

export class NordpoolPlatformAccessory {

  private decimalPrecision = this.platform.config.decimalPrecision || 0;
  private excessivePriceMargin = this.platform.config.excessivePriceMargin || 200;

  private pricing = defaultPricing;
  private service = defaultService;
  private areaTimezone = defaultAreaTimezone;

  private pricesCache = new NodeCache({ stdTTL: 86400 });

  constructor(
    private readonly platform: NordpoolPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, PLATFORM_MANUFACTURER)
      .setCharacteristic(this.platform.Characteristic.Model, 'Electricity price sensors')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'UN783GU921Y0');

    // init light sensor for current price
    this.service.currently = this.accessory.getService('Nordpool_currentPrice') || this.accessory.addService(
      this.platform.Service.LightSensor, 'Nordpool_currentPrice', 'currentPrice');

    // hourly ticker
    this.service.hourlyTickerSwitch = this.accessory.getService('Nordpool_hourlyTickerSwitch') || this.accessory.addService(
      this.platform.Service.Switch, 'Nordpool_hourlyTickerSwitch', 'hourlyTickerSwitch');

    // turn OFF hourly ticker if its turned on by schedule or manually
    this.service.hourlyTickerSwitch.getCharacteristic(this.platform.Characteristic.On)
      .on('set', (value, callback) => {
        if(value) {
          // If switch is manually turned on, start a timer to switch it back off after 1 second
          setTimeout(() => {
            this.service.hourlyTickerSwitch!.updateCharacteristic(this.platform.Characteristic.On, false);
            this.platform.log.debug('hourlyTickerSwitch turned OFF automatically with 1s delay');
          }, 1000);
        }
        callback(null);
      });

    // init all virtual occupancy sensors for price levels
    for (const key of Object.keys(this.service)) {
      if (/^(cheapest|priciest)/.test(key)) {
        this.service[key] = this.accessory.getService(`Nordpool_${key}`) || this.accessory.addService(
          this.platform.Service.OccupancySensor, `Nordpool_${key}`, key);
      }
    }

    this.checkSystemTimezone();

    this.getPrices();

    schedule('0 * * * *', () => {
      this.getPrices();
    });

  }

  async checkSystemTimezone( ) {
    const systemTimezone = DateTime.local().toFormat('ZZ');
    const preferredTimezone = DateTime.local().setZone(this.areaTimezone).toFormat('ZZ');

    if (systemTimezone !== preferredTimezone) {
      this.platform.log.warn(
        `WARN: System timezone ${systemTimezone} DOES NOT match with ${this.platform.config.area} area timezone ${preferredTimezone}.`
        + 'This may result in incorrect time-to-price coding. If possible, please update your system time setting to match timezone of '
        + 'your specified Nordpool area.',
      );
    } else {
      this.platform.log.debug(
        `OK: system timezone ${systemTimezone} match ${this.platform.config.area} area timezone ${preferredTimezone}`,
      );
    }
  }

  async getPrices() {
    const todayKey = DateTime.local().setZone(this.areaTimezone).toFormat('yyyy-MM-dd');
    const tomorrowKey = DateTime.local().plus({ day: 1 }).setZone(this.areaTimezone).toFormat('yyyy-MM-dd');
    const currentHour = DateTime.local().setZone(this.areaTimezone).hour;

    this.pricing.today = this.pricesCache.get(todayKey)||[];
    if (this.pricing.today.length === 0 || !this.pricesCache.get(todayKey) || (currentHour >= 18 && !this.pricesCache.get(tomorrowKey))) {
      this.eleringEE_getNordpoolData()
        .then((results) => {
          if (results) {
            const todayResults = results.filter(result => result.day === todayKey);
            const tomorrowResults = results.filter(result => result.day === tomorrowKey);

            if (todayResults.length===24) {
              this.pricesCache.set(todayKey, todayResults);
              this.pricing.today = todayResults;
              this.platform.log.debug(`OK: pulled Nordpool prices in ${this.platform.config.area} area for TODAY (${todayKey})`);
              this.platform.log.debug(JSON.stringify(todayResults.map(({ hour, price }) => ({ hour, price }))));
              this.analyze_and_setServices(currentHour);
            } else {
              this.platform.log.warn('WARN: Something is incorrect with API response. Unable to determine TODAYS Nordpool prices.');
              this.platform.log.warn(`Raw response: ${results}`);
            }

            if ( tomorrowResults.length===24 ) {
              this.pricesCache.set(tomorrowKey, tomorrowResults);
              this.platform.log.debug(`OK: pulled Nordpool prices in ${this.platform.config.area} area for TOMORROW (${tomorrowKey})`);
              this.platform.log.debug(JSON.stringify(tomorrowResults.map(({ hour, price }) => ({ hour, price }))));
            }
          } else {
            this.platform.log.warn('WARN: API returned no or abnormal results for todays\'s Nordpool prices data. Will retry in 1 hour');
          }
        })
        .catch((error) => {
          this.platform.log.error(`ERROR: Failed to get todays's prices, will retry in 1 hour. ${error}`);
        });
    } else {
      this.pricing.today = this.pricesCache.get(todayKey)||[];
      this.analyze_and_setServices(currentHour);
    }
  }

  async analyze_and_setServices (currentHour: number) {
    // if new day or cheapest hours not calculated yet
    if (currentHour === 0 || this.pricing.cheapest4Hours.length === 0) {
      this.getCheapestHoursToday();
    }

    // current hour price
    if (this.pricing.today.length === 24) {
      this.pricing.currently = this.pricing.today[currentHour]['price'];
      this.platform.log.info(`Current hour: ${currentHour}; Price: ${this.pricing.currently} cents`);
    } else {
      this.platform.log.warn('WARN: Unable to determine current hour Nordpool price because data not available');
    }

    // set current price level on light sensor
    if (this.service.currently) {
      this.service.currently.getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel).updateValue(this.pricing.currently);
    }

    // set price levels on relevant occupancy sensors
    for (const key of Object.keys(this.pricing)) {
      if (!/^(cheapest|priciest)/.test(key)) {
        continue;
      }

      if (!this.service[key] || !Array.isArray(this.pricing[key])) {
        continue;
      }

    this.service[key]!.setCharacteristic(
      this.platform.Characteristic.OccupancyDetected,
      this.pricing[key].includes(currentHour)
        ? this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
        : this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
    );

    }

    // toggle hourly ticker in 1s ON
    if (this.service.hourlyTickerSwitch) {
      setTimeout(() => {
      this.service.hourlyTickerSwitch!.setCharacteristic(this.platform.Characteristic.On, true);
      }, 1000);
    }
  }

  async eleringEE_getNordpoolData() {
    const area = this.platform.config.area.toLowerCase();
    if (!['lt', 'lv', 'ee', 'fi'].includes(area)) {
      this.platform.log.error(`ERROR: Invalid area code '${this.platform.config.area}' provided`);
      return null;
    }

    const start = DateTime.utc().startOf('day').minus({hours:4}).toISO();
    const end = DateTime.utc().plus({days:1}).endOf('day').toISO();

    const encodedStart = encodeURIComponent(start);
    const encodedEnd = encodeURIComponent(end);

    try {
      const url = `https://dashboard.elering.ee/api/nps/price?start=${encodedStart}&end=${encodedEnd}`;
      const response = await axios.get(url);
      const convertedData = this.eleringEE_convertDataStructure(response.data.data);
      return convertedData;
    } catch (error) {
      this.platform.log.error(`ERROR retrieving Nordpool data: ${error}`);
      return null;
    }
  }

  eleringEE_convertDataStructure(data: { [x: string]: { timestamp: number; price: number }[] }) {
    const area = this.platform.config.area.toLowerCase();

    return data[area].map((item: { timestamp: number; price: number }) => {
      // convert the timestamp to ISO string, add the '+02:00' timezone offset
      const date = DateTime.fromISO(new Date(item.timestamp * 1000).toISOString()).setZone(this.areaTimezone);

      // divide by 10 to convert price to cents per kWh
      if (item.price < 0) {
        item.price = 0;
      } else {
        item.price = parseFloat((item.price / 10).toFixed(this.decimalPrecision));
      }

      return {
        day: date.toFormat('yyyy-MM-dd'),
        hour: parseInt(date.toFormat('HH')),
        price: item.price,
      };
    });
  }

  getCheapestHoursToday() {
    if (this.pricing.today.length !== 24) {
      this.platform.log.warn(
        'WARN: Cannot determine cheapest hours of the day because Nordpool dataset is not available '
        + `or has abnormal amount of elements: ${this.pricing.today.length} (must be 24)`,
      );
      return;
    }

    const sortedPrices = [...this.pricing.today].sort((a, b) => a.price - b.price);

    // make sure these arrays are empty on each (new day) re-calculation
    for (const key of Object.keys(this.pricing)) {
      if (!/^(cheapest|priciest)/.test(key)) {
        continue;
      }
      this.pricing[key] = [];
    }

    this.pricing.median = parseFloat(
      ((sortedPrices[Math.floor(sortedPrices.length / 2) - 1].price +
          sortedPrices[Math.ceil(sortedPrices.length / 2)].price) / 2
      ).toFixed(this.decimalPrecision),
    );


    this.pricing.today
      .map((price, idx) => ({ value: price.price, hour: idx }))
      .forEach(({ value, hour }) => {
        if (value <= sortedPrices[0].price) {
          this.pricing.cheapestHour.push(hour);
        }
        if (value <= sortedPrices[3].price) {
          this.pricing.cheapest4Hours.push(hour);
        }
        if (value <= sortedPrices[4].price) {
          this.pricing.cheapest5Hours.push(hour);
        }
        if (value <= sortedPrices[5].price) {
          this.pricing.cheapest6Hours.push(hour);
        }
        if (value <= sortedPrices[6].price) {
          this.pricing.cheapest7Hours.push(hour);
        }
        if (value <= sortedPrices[7].price) {
          this.pricing.cheapest8Hours.push(hour);
        }
        if (value >= sortedPrices[23].price || value >= this.pricing.median * this.excessivePriceMargin/100 ) {
          this.pricing.priciestHour.push(hour);
        }
      });

    this.pricing.cheapest5HoursConsec = getCheapestConsecutiveHours(5, this.pricing.today);

    this.platform.log.info(`Cheapest hour(s): ${this.pricing.cheapestHour.join(', ')}`);
    this.platform.log.info(`4 cheapest hours: ${this.pricing.cheapest4Hours.join(', ')}`);
    this.platform.log.info(`5 cheapest hours₁: ${this.pricing.cheapest5Hours.join(', ')}`);
    this.platform.log.info(`5 cheapest hours₂: ${this.pricing.cheapest5HoursConsec.join(', ')} (consecutive)`);
    this.platform.log.info(`6 cheapest hours: ${this.pricing.cheapest6Hours.join(', ')}`);
    this.platform.log.info(`7 cheapest hours: ${this.pricing.cheapest7Hours.join(', ')}`);
    this.platform.log.info(`8 cheapest hours: ${this.pricing.cheapest8Hours.join(', ')}`);
    this.platform.log.debug(`Configured excessive price above median margin: ${this.excessivePriceMargin}`);
    this.platform.log.info(`Most expensive hour(s): ${this.pricing.priciestHour.join(', ')}`);
    this.platform.log.info(`Median price today: ${this.pricing.median} cents`);
  }

}