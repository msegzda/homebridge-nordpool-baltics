import { PlatformAccessory, API, PlatformConfig, Logging } from 'homebridge';
import { NordpoolPlatform } from './platform';
import { eleringEE_getNordpoolData } from './funcs_Elering';
import { spothinta_getNordpoolData } from './funcs_SpotHinta';
import { fnc_todayKey } from './settings';

import { DateTime } from 'luxon';
import * as asciichart from 'asciichart';

import {
  defaultAreaTimezone, PLATFORM_MANUFACTURER, PLATFORM_MODEL, PLATFORM_SERIAL_NUMBER,
  pricing, NordpoolData, SensorType, defaultPricesCache, fnc_tomorrowKey, fnc_currentHour,
} from './settings';

export class Functions {

  private decimalPrecision = this.platform.config.decimalPrecision ?? 1;
  private excessivePriceMargin = this.platform.config.excessivePriceMargin ?? 200;
  private minPriciestMargin = this.platform.config.minPriciestMargin ?? 0;
  private plotTheChart:boolean = this.platform.config.plotTheChart ?? false;
  private dynamicCheapestConsecutiveHours:boolean = this.platform.config.dynamicCheapestConsecutiveHours ?? false;
  private pricesCache = defaultPricesCache(this.api, this.platform.log as Logging);

  constructor(
    private readonly platform: NordpoolPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly service: SensorType,
    private readonly api: API,
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
        .updateValue(pricing.currently);
    }

    // hourly ticker
    this.service.hourlyTickerSwitch = this.accessory.getService('Nordpool_hourlyTickerSwitch') || this.accessory.addService(
      this.platform.Service.Switch, 'Nordpool_hourlyTickerSwitch', 'hourlyTickerSwitch');

    // current hour as temperature sensor
    if ( this.platform.config['currentHour'] !== undefined && this.platform.config['currentHour'] ) {
      this.service.currentHour = this.accessory.getService('Nordpool_currentHour') || this.accessory.addService(
        this.platform.Service.TemperatureSensor, 'Nordpool_currentHour', 'currentHour');

      if (this.service.currentHour) {
        this.service.currentHour.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
          .updateValue(fnc_currentHour(this.platform.config));
      }
    } else {
      const currentHourService = this.accessory.getService('Nordpool_currentHour');
      if (currentHourService !== undefined) {
        this.accessory.removeService(currentHourService);
        this.platform.log.debug('Accessory Nordpool_currentHour removed according to Plugin Config');
      }
    }

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

  async pullNordpoolData() {
    try {
      const rawData = this.platform.config.area.match(/^(LT|LV|EE|FI)$/)
        ? await eleringEE_getNordpoolData(this.platform.log, this.platform.config)
        : await spothinta_getNordpoolData(this.platform.log, this.platform.config);

      if (!rawData) {
        this.platform.log.warn(`ERR: No response from API for ${this.platform.config.area} area`);
        return null;
      }

      return rawData;

    } catch (error) {
      this.platform.log.error('API Error:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async checkSystemTimezone() {
    const systemTimezone = DateTime.local().toFormat('ZZ');
    const preferredTimezone = DateTime.local().setZone(
      defaultAreaTimezone(this.platform.config),
    ).toFormat('ZZ');

    if (systemTimezone !== preferredTimezone) {
      this.platform.log.warn(
        `WARN: System timezone ${systemTimezone} DOES NOT match with ${this.platform.config.area} area timezone ${preferredTimezone}. `
        + 'This may result in incorrect time-to-price coding. If possible, please update your system time setting to match timezone of '
        + 'your specified Nordpool area.',
      );
    } else {
      this.platform.log.debug(
        `OK: system timezone ${systemTimezone} match ${this.platform.config.area} area timezone ${preferredTimezone}`,
      );
    }
  }

  applySolarOverride(config: PlatformConfig, force: boolean) {
    if (config.solarOverride === null || config.solarOverride === false) {
      return;
    }

    const today = DateTime.local();
    const todayKey = fnc_todayKey(config);

    if ( !force && this.pricesCache.getSync(`solarOverrideApplied_${todayKey}`) ) {
      return;
    }

    if (today.month < 3 || today.month > 9) {
      this.platform.log.warn('Solar power plant override applies in March-September months only.');
      this.pricesCache.set(`solarOverrideApplied_${todayKey}`, true);
      return;
    }

    const latitude = config.latitude || 55;

    const daysDifference = today.diff(
      DateTime.fromObject({ year: today.year, month: 6, day: 24 }), 'days').days;

    const solarOffsetMinutes = Math.abs(daysDifference) * (1.6 + 0.04 * (latitude - 55));

    const solarOverrideJuneHourStart = DateTime.fromObject({ hour: config.solarOverrideJuneHourStart })
      .plus({ minutes: solarOffsetMinutes });
    const solarOverrideJuneHourStartDecimal = Math.round(
      solarOverrideJuneHourStart.hour + solarOverrideJuneHourStart.minute / 60,
    );

    // one hour added, to make configured value 'inclusive'
    const solarOverrideJuneHourEnd = DateTime.fromObject({ hour: config.solarOverrideJuneHourEnd+1 })
      .minus({ minutes: solarOffsetMinutes });
    const solarOverrideJuneHourEndDecimal = Math.round(
      solarOverrideJuneHourEnd.hour + solarOverrideJuneHourEnd.minute / 60,
    );

    if (solarOverrideJuneHourStartDecimal < solarOverrideJuneHourEndDecimal) {
      this.platform.log.debug(`solarOffsetMinutes: ${solarOffsetMinutes}`);
      this.platform.log.debug(`solarOverrideJuneHourStart: ${solarOverrideJuneHourStart.toJSON()}`);
      this.platform.log.debug(`solarOverrideJuneHourEnd: ${solarOverrideJuneHourEnd.toJSON()}`);
      this.platform.log.warn(
        `Hours from ${solarOverrideJuneHourStartDecimal} to ${solarOverrideJuneHourEndDecimal - 1} (inclusive) are overridden ` +
          'price values to 0 because of solar plant settings.',
      );

      for (let i = solarOverrideJuneHourStartDecimal; i < solarOverrideJuneHourEndDecimal; i++) {
        pricing.today[i].price = 0;
      }
    }
    this.pricesCache.set(todayKey, pricing.today);
    this.pricesCache.set(`solarOverrideApplied_${todayKey}`, true);
  }

  getCheapestHoursToday() {

    // make sure these arrays are empty on each (new day) re-calculation
    for (const key of Object.keys(pricing)) {
      if (!/^(cheapest|priciest|cheapest5HoursConsec)/.test(key)) {
        continue;
      }
      pricing[key] = [];
    }

    const sortedPrices = [...pricing.today].sort((a, b) => a.price - b.price);
    pricing.median = parseFloat(
      ((sortedPrices[Math.floor(sortedPrices.length / 2) - 1].price +
          sortedPrices[Math.ceil(sortedPrices.length / 2)].price) / 2
      ).toFixed(this.decimalPrecision),
    );

    pricing.today
      .map((price) => ({ value: price.price, hour: price.hour }))
      .forEach(({ value, hour }) => {
        if (value <= sortedPrices[0].price) {
          pricing.cheapestHour.push(hour);
        }
        if (value <= sortedPrices[3].price) {
          pricing.cheapest4Hours.push(hour);
        }
        if (value <= sortedPrices[4].price) {
          pricing.cheapest5Hours.push(hour);
        }
        if (value <= sortedPrices[5].price) {
          pricing.cheapest6Hours.push(hour);
        }
        if (value <= sortedPrices[6].price) {
          pricing.cheapest7Hours.push(hour);
        }
        if (value <= sortedPrices[7].price) {
          pricing.cheapest8Hours.push(hour);
        }
        if (value <= sortedPrices[8].price) {
          pricing.cheapest9Hours.push(hour);
        }
        if (value <= sortedPrices[9].price) {
          pricing.cheapest10Hours.push(hour);
        }
        if (value <= sortedPrices[10].price) {
          pricing.cheapest11Hours.push(hour);
        }
        if (value <= sortedPrices[11].price) {
          pricing.cheapest12Hours.push(hour);
        }
        // last element
        if (
          (value >= (sortedPrices[sortedPrices.length-1].price * 0.9) || value >= pricing.median * this.excessivePriceMargin/100)
                && !pricing.cheapest12Hours.includes(hour)
                && value > this.minPriciestMargin
        ) {
          pricing.priciestHour.push(hour);
        }
      });

    this.platform.log.info(`Cheapest hour(s): ${pricing.cheapestHour.join(', ')}`);

    for (let i=4; i<=12; i++) {
      const key = `cheapest${i}Hours`;
      if (this.platform.config[key] !== undefined && this.platform.config[key]) {
        this.platform.log.info(`${i} cheapest hours: ${pricing[key].join(', ')}`);
      }
    }

    if (pricing.priciestHour.length === 0) {
      this.platform.log.info(`Most expensive hour(s): N/A (all hours prices fall below ${this.minPriciestMargin} cents)`);
    } else {
      this.platform.log.info(`Most expensive hour(s): ${pricing.priciestHour.join(', ')}`);
    }

    this.platform.log.info(`Median price today: ${pricing.median} cents`);

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

    if (pricesSequence.length < numHours) {
      this.platform.log.error(`Insufficient price data to calculate ${numHours} consecutive hours.`);
      return [];
    }

    // try cached from 2-days calculation - if not avail then calculate fresh
    let retVal = this.pricesCache.getSync('5consecutiveUpdated', []);

    if (retVal === undefined || retVal.length === 0) {
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

    const priceData = pricing.today.map(elem => elem.price);

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

    if (pricing[accessoryName].includes(currentHour)) {
      characteristic = this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;
    }
    const accessoryService = this.service[accessoryName];

    if ( accessoryService !== undefined && accessoryService !== null) {
      accessoryService.setCharacteristic(this.platform.Characteristic.OccupancyDetected, characteristic);
    }
  }

  async analyze_and_setServices (currentHour: number) {

    if (pricing.today.length === 25 || pricing.today.length === 24 || pricing.today.length === 23 ) {
      pricing.currently = pricing.today[currentHour]['price'];
    } else {
      this.platform.log.warn('WARN: Unable to determine current hour Nordpool price because data not available');
      return;
    }

    pricing.currentHour = currentHour;
    if (this.service.currentHour) {
      this.service.currentHour.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .updateValue(currentHour);
    }

    this.applySolarOverride(this.platform.config, false);

    // if new day or cheapest hours not calculated yet
    if (currentHour === 0 || pricing.cheapest4Hours.length === 0) {
      this.getCheapestHoursToday();
    }

    if (
      pricing.cheapest5HoursConsec.length === 0
        || currentHour === 0
        || (currentHour === 7 && this.dynamicCheapestConsecutiveHours)
    ) {
      this.getCheapestConsecutiveHours(5, pricing.today).then((retVal) => {
        pricing.cheapest5HoursConsec = retVal;
        this.setOccupancyByHour(currentHour, 'cheapest5HoursConsec');
      }).catch((error)=> {
        pricing.cheapest5HoursConsec = []; // make sure its empty in case of error
        this.platform.log.error('An error occurred calculating cheapest 5 consecutive hours: ', error);
      });
    }

    // set current price level on light sensor
    if (this.service.currently) {
      this.service.currently.getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
        .updateValue(pricing.currently >= 0.0001 ? pricing.currently : 0.0001);
    }

    // set price levels on relevant occupancy sensors
    for (const key of Object.keys(pricing)) {
      if (!/^(cheapest|priciest)/.test(key)) {
        continue;
      }

      if (!this.service[key] || !Array.isArray(pricing[key])) {
        continue;
      }

      this.setOccupancyByHour(currentHour, key);
    }

    this.platform.log.info(`Hour: ${currentHour}; Price: ${pricing.currently} cents`);

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

    const tomorrowKey = fnc_tomorrowKey(this.platform.config);
    const currentHour = fnc_currentHour(this.platform.config);

    let tomorrow = [] as Array<NordpoolData>; tomorrow = this.pricesCache.getSync(tomorrowKey, []);
    let twoDaysPricing = [] as Array<NordpoolData>;

    // stop function if not full data
    if ( pricing.today.length !== 24 || tomorrow.length !== 24 ) {
      return;
    }

    const remainingHoursToday = Array.from({length: Math.min(24 - currentHour, 24)}, (_, i) => currentHour + i);

    // Check if any of the remaining hours are within the cheapest consecutive hours
    if( pricing.cheapest5HoursConsec.some(hour => remainingHoursToday.includes(hour)) ) {
      // from now till next day 6AM
      twoDaysPricing = pricing.today.slice(currentHour, 24).concat(tomorrow.slice(0, 7));
    } else {
      // do nothing, allow recalculate 0AM
      this.pricesCache.remove('5consecutiveUpdated');
      return;
    }

    this.getCheapestConsecutiveHours(5, twoDaysPricing).then((retVal) => {
      pricing.cheapest5HoursConsec = retVal;
      this.setOccupancyByHour(currentHour, 'cheapest5HoursConsec');
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

  fillMissingHours(data: NordpoolData[], dayKey: string): NordpoolData[] {
    // If we have all expected hours, return as-is
    if (data.length >= 24) {
      return data;
    }

    // Make a copy to avoid modifying the original
    const filledData = [...data];

    // Sort by hour to ensure proper sequence
    filledData.sort((a, b) => a.hour - b.hour);

    // Find the missing hour by looking for gaps in the sequence
    for (let i = 0; i < filledData.length - 1; i++) {
      if (filledData[i + 1].hour !== filledData[i].hour + 1) {
        const missingHour = filledData[i].hour + 1;
        const previousHour = filledData[i];

        // Clone the previous hour's data for the missing hour
        const clonedHour = {
          ...previousHour,
          hour: missingHour,
          day: dayKey,
        };

        filledData.push(clonedHour);
        filledData.sort((a, b) => a.hour - b.hour);

        this.platform.log.warn(`WARN: Added missing hour ${missingHour} by duplicating hour ${previousHour.hour} data`);

        // Since we only expect to be missing one hour, we can break after fixing it
        break;
      }
    }

    return filledData;
  }
}
