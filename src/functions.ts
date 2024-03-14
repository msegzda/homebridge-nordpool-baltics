import { PlatformAccessory } from 'homebridge';
import { NordpoolPlatform } from './platform';

import { DateTime } from 'luxon';
import axios from 'axios';
import * as asciichart from 'asciichart';


import {
  defaultAreaTimezone, PLATFORM_MANUFACTURER, PLATFORM_MODEL, PLATFORM_SERIAL_NUMBER,
  Pricing, NordpoolData, SensorType, defaultPricesCache, fnc_tomorrowKey, fnc_currentHour,
} from './settings';

export class Functions {

  private decimalPrecision = this.platform.config.decimalPrecision ?? 1;
  private excessivePriceMargin = this.platform.config.excessivePriceMargin ?? 200;
  private plotTheChart:boolean = this.platform.config.plotTheChart ?? false;
  private dynamicCheapestConsecutiveHours:boolean = this.platform.config.dynamicCheapestConsecutiveHours ?? false;
  private pricesCache = defaultPricesCache;

  constructor(
    private readonly platform: NordpoolPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly pricing: Pricing,
    private readonly service: SensorType,
  ) {}

  async initAccessories() {

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, PLATFORM_MANUFACTURER)
      .setCharacteristic(this.platform.Characteristic.Model, PLATFORM_MODEL)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, PLATFORM_SERIAL_NUMBER);

    // init light sensor for current price
    this.service.currently = this.accessory.getService('Nordpool_currentPrice') || this.accessory.addService(
      this.platform.Service.LightSensor, 'Nordpool_currentPrice', 'currentPrice');

    // set default price level
    if (this.service.currently) {
      this.service.currently.getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
        .updateValue(this.pricing.currently);
    }

    // hourly ticker
    this.service.hourlyTickerSwitch = this.accessory.getService('Nordpool_hourlyTickerSwitch') || this.accessory.addService(
      this.platform.Service.Switch, 'Nordpool_hourlyTickerSwitch', 'hourlyTickerSwitch');

    // turn OFF hourly ticker if its turned on by schedule or manually
    if (this.service.hourlyTickerSwitch) {
      this.service.hourlyTickerSwitch.getCharacteristic(this.platform.Characteristic.On)
        .on('set', (value, callback) => {
          if(value) {
            // If switch is manually turned on, start a timer to switch it back off after 1 second
            setTimeout(() => {
              this.service.hourlyTickerSwitch!.updateCharacteristic(this.platform.Characteristic.On, false);
            }, 1000);
          }
          callback(null);
        });
    }

    // init virtual occupancy sensors for price levels
    for (const key of Object.keys(this.service)) {
      if (/^(cheapest|priciest)/.test(key)) {

        const accessoryService = this.accessory.getService(`Nordpool_${key}`);

        if ( this.platform.config[key] !== undefined && !this.platform.config[key] ) {
          if ( accessoryService !== undefined ) {
            this.accessory.removeService(accessoryService);
            this.platform.log.debug(`Accessory Nordpool_${key} removed according to Plugin Config`);
          } else {
            this.platform.log.debug(`Accessory Nordpool_${key} skipped according to Plugin Config`);
          }
          continue;
        }

        this.service[key] = accessoryService
        || this.accessory.addService(this.platform.Service.OccupancySensor, `Nordpool_${key}`, key);

        if ( this.service[key] ) {
            this.service[key]!
              .getCharacteristic(this.platform.Characteristic.OccupancyDetected)
              .setValue(this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        }

      }
    }
    // make sure accessories cache on homebridge gets updated
    this.platform.api.updatePlatformAccessories([this.accessory]);
  }

  async checkSystemTimezone() {
    const systemTimezone = DateTime.local().toFormat('ZZ');
    const preferredTimezone = DateTime.local().setZone(defaultAreaTimezone).toFormat('ZZ');

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

  async eleringEE_getNordpoolData() {
    const start = DateTime.utc().startOf('day').minus({hours:4}).toISO();
    const end = DateTime.utc().plus({days:1}).endOf('day').toISO();

    const encodedStart = encodeURIComponent(start);
    const encodedEnd = encodeURIComponent(end);

    try {
      const url = `https://dashboard.elering.ee/api/nps/price?start=${encodedStart}&end=${encodedEnd}`;
      const response = await axios.get(url);
      if (response.status !== 200 ) {
        this.platform.log.warn(`WARN: Nordpool API provider Elering returned unusual response status ${response.status}`);
      }
      if (response.data.data) {
        const convertedData = this.eleringEE_convertDataStructure(response.data.data);
        return convertedData;
      } else {
        this.platform.log.error(`ERR: Nordpool API provider Elering returned unusual data ${JSON.stringify(response.data)}`);
      }
    } catch (error) {
      this.platform.log.error(`ERR: General Nordpool API provider Elering error: ${error}`);
    }
    return null;
  }

  eleringEE_convertDataStructure(
    data: { [x: string]: { timestamp: number; price: number }[] },
  ) {
    const area = this.platform.config.area.toLowerCase();
    const decimalPrecision = this.platform.config.decimalPrecision ?? 1;

    return data[area].map((item: { timestamp: number; price: number }) => {
      // convert the timestamp to ISO string, add the '+02:00' timezone offset
      const date = DateTime.fromISO(new Date(item.timestamp * 1000).toISOString()).setZone(defaultAreaTimezone);

      // divide by 10 to convert price to cents per kWh
      item.price = parseFloat((item.price / 10).toFixed(decimalPrecision));

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
      if (!/^(cheapest|priciest|cheapest5HoursConsec)/.test(key)) {
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
        if ((value >= (sortedPrices[23].price * 0.9) || value >= this.pricing.median * this.excessivePriceMargin/100)
                && !this.pricing.cheapest8Hours.includes(hour)
        ) {
          this.pricing.priciestHour.push(hour);
        }
      });

    this.platform.log.info(`Cheapest hour(s): ${this.pricing.cheapestHour.join(', ')}`);

    for (let i=4; i<=8; i++) {
      const key = `cheapest${i}Hours`;
      if (this.platform.config[key] !== undefined && this.platform.config[key]) {
        this.platform.log.info(`${i} cheapest hours: ${this.pricing[key].join(', ')}`);
      }
    }

    this.platform.log.info(`Most expensive hour(s): ${this.pricing.priciestHour.join(', ')}`);
    this.platform.log.info(`Median price today: ${this.pricing.median} cents`);

    if (this.plotTheChart) {
      this.plotPricesChart().then().catch((error)=> {
        this.platform.log.error('An error occurred plotting the chart for today\'s Nordpool data: ', error);
      });
    }

  }

  async getCheapestConsecutiveHours(numHours: number, pricesSequence: NordpoolData[] ): Promise<number[]> {
    interface HourSequence {
        startHour: number;
        total: number;
    }

    // if not required on plugin config, just return empty
    if (this.platform.config['cheapest5HoursConsec'] !== undefined && !this.platform.config['cheapest5HoursConsec']) {
      return [];
    }

    // try cached from 2days calculation
    let retVal = this.pricesCache.getSync('5consecutiveUpdated', []);

    if (retVal.length === 0) {
      const hourSequences: HourSequence[] = [];

      for(let i = 0; i <= pricesSequence.length - numHours; i++) {
        const totalSum = pricesSequence.slice(i, i + numHours).reduce((total, priceObj) => total + priceObj.price, 0);
        hourSequences.push({ startHour: i, total: totalSum });
      }

      const cheapestHours = hourSequences.sort((a, b) => a.total - b.total)[0];
      retVal = Array.from({length: numHours}, (_, i) => pricesSequence[cheapestHours.startHour + i].hour);
    }

    this.platform.log.info(
      `Consecutive ${numHours} cheapest hours: ${retVal.join(', ')}`,
    );
    return retVal;
  }

  async plotPricesChart(){

    if (this.pricing.today.length !== 24) {
      this.platform.log.warn('Cannot plot the chart because not complete or no pricing information is available');
      return;
    }

    const priceData = this.pricing.today.map(elem => elem.price);

    const chart = asciichart.plot(priceData, {
      padding: '      ', // 6 spaces
      height: 9,
    });

    const lines = chart.split('\n');

    lines.forEach((line: string) => {
      this.platform.log.warn(line);
    });
  }

  setOccupancyByHour(currentHour: number, accessoryName: string) {
    let characteristic = this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;

    if (this.pricing[accessoryName].includes(currentHour)) {
      characteristic = this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;
    }
    const accessoryService = this.service[accessoryName];

    if ( accessoryService !== undefined && accessoryService !== null) {
      accessoryService.setCharacteristic(this.platform.Characteristic.OccupancyDetected, characteristic);
    }
  }

  async analyze_and_setServices (currentHour: number) {

    if (this.pricing.today.length === 24) {
      this.pricing.currently = this.pricing.today[currentHour]['price'];
    } else {
      this.platform.log.warn('WARN: Unable to determine current hour Nordpool price because data not available');
      return;
    }

    // if new day or cheapest hours not calculated yet
    if (currentHour === 0 || this.pricing.cheapest4Hours.length === 0) {
      this.getCheapestHoursToday();
    }

    if (
      this.pricing.cheapest5HoursConsec.length === 0
        || currentHour === 0
        || (currentHour === 7 && this.dynamicCheapestConsecutiveHours)
    ) {
      this.getCheapestConsecutiveHours(5, this.pricing.today).then((retVal) => {
        this.pricing.cheapest5HoursConsec = retVal;
        this.setOccupancyByHour(currentHour, 'cheapest5HoursConsec');
      }).catch((error)=> {
        this.pricing.cheapest5HoursConsec = []; // make sure its empty in case of error
        this.platform.log.error('An error occurred calculating cheapest 5 consecutive hours: ', error);
      });
    }

    // set current price level on light sensor
    if (this.service.currently) {
      this.service.currently.getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
        .updateValue(this.pricing.currently >= 0.0001 ? this.pricing.currently : 0.0001);
    }

    // set price levels on relevant occupancy sensors
    for (const key of Object.keys(this.pricing)) {
      if (!/^(cheapest|priciest)/.test(key)) {
        continue;
      }

      if (!this.service[key] || !Array.isArray(this.pricing[key])) {
        continue;
      }

      this.setOccupancyByHour(currentHour, key);
    }

    this.platform.log.info(`Hour: ${currentHour}; Price: ${this.pricing.currently} cents`);

    // toggle hourly ticker in 1s ON
    if (this.service.hourlyTickerSwitch) {
      setTimeout(() => {
      this.service.hourlyTickerSwitch!.setCharacteristic(this.platform.Characteristic.On, true);
      }, 1000);
    }
  }

  async getCheapestHoursIn2days() {

    // make sure its not allowed to execute if not enabled on plugin config
    if (!this.dynamicCheapestConsecutiveHours){
      return;
    }

    const tomorrowKey = fnc_tomorrowKey();
    const currentHour = fnc_currentHour();

    let tomorrow = [] as Array<NordpoolData>; tomorrow = this.pricesCache.getSync(tomorrowKey, []);
    let twoDaysPricing = [] as Array<NordpoolData>;

    // stop function if not full data
    if ( this.pricing.today.length !== 24 || tomorrow.length !== 24 ) {
      return;
    }

    const remainingHoursToday = Array.from({length: Math.min(24 - currentHour, 24)}, (_, i) => currentHour + i);

    // Check if any of the remaining hours are within the cheapest consecutive hours
    if( this.pricing.cheapest5HoursConsec.some(hour => remainingHoursToday.includes(hour)) ) {
      // from now till next day 6AM
      twoDaysPricing = this.pricing.today.slice(currentHour, 24).concat(tomorrow.slice(0, 7));
    } else {
      // do nothing, allow recalculate 0AM
      this.pricesCache.remove('5consecutiveUpdated');
      return;
    }

    this.getCheapestConsecutiveHours(5, twoDaysPricing).then((retVal) => {
      this.pricing.cheapest5HoursConsec = retVal;
      // ttl in seconds till next morning 7am
      const ttl = this.ttlSecondsTill_7AM();
      this.pricesCache.set('5consecutiveUpdated', retVal, ttl);
    }).catch((error)=> {
      this.platform.log.error('An error occurred calculating cheapest 5 consecutive hours: ', error);
    });
  }

  ttlSecondsTill_7AM() {
    const now = DateTime.local();
    let next7am = now.startOf('day').plus({ hours: 6, minutes: 59 });

    if(now >= next7am) {
      next7am = next7am.plus({ days: 1 });
    }

    return next7am.diff(now, 'seconds').seconds;
  }

}
