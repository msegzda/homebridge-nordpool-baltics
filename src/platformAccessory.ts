import { PlatformAccessory } from 'homebridge';
import { NordpoolPlatform } from './platform';

import {
  defaultPricing, defaultService, defaultPricesCache,
  fnc_todayKey, fnc_tomorrowKey, fnc_currentHour, NordpoolData,
} from './settings';

import { Functions } from './functions';
import { schedule } from 'node-cron';

export class NordpoolPlatformAccessory {

  private decimalPrecision = this.platform.config.decimalPrecision ?? 1;
  private dynamicCheapestConsecutiveHours:boolean = this.platform.config.dynamicCheapestConsecutiveHours ?? false;
  private pricing = defaultPricing;
  private service = defaultService;
  private pricesCache = defaultPricesCache;
  private fnc = new Functions(this.platform, this.accessory, this.pricing, this.service);

  constructor(
    private readonly platform: NordpoolPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.fnc.initAccessories()
      .then(() => {
        this.fnc.checkSystemTimezone();
        this.getPrices();

        schedule('0 * * * *', () => {
          this.getPrices();
        });
      })
      .catch((error) => {
        this.platform.log.error(error);
      });
  }

  async getPrices() {
    const todayKey = fnc_todayKey();
    const tomorrowKey = fnc_tomorrowKey();
    const currentHour = fnc_currentHour();

    // did precision config change?
    // if changed: clear cache and reload the data from Nordpool prices provider
    const decimalPrecisionCache = this.pricesCache.getSync('decimalPrecision');
    if (decimalPrecisionCache !== this.decimalPrecision) {
      try {
        await this.pricesCache.remove(todayKey);
        await this.pricesCache.remove(tomorrowKey);
      } catch (error) {
        this.platform.log.error(`ERR: failed clearing pricesCache: ${JSON.stringify(error)}`);
      } finally {
        this.platform.log.warn(
          `Configured Decimal Precision value changed from ${decimalPrecisionCache} to ${this.decimalPrecision}`,
        );
        this.pricesCache.set('decimalPrecision', this.decimalPrecision);
      }
    }

    this.pricing.today = this.pricesCache.getSync(todayKey, []);
    if (this.pricing.today.length === 0
        || (currentHour >= 18 && !this.pricesCache.getSync(tomorrowKey))
    ) {
      this.fnc.eleringEE_getNordpoolData()
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
              this.platform.log.warn('WARN: Something is incorrect with API response. Unable to determine today\'s Nordpool prices.');
              this.platform.log.warn(`Raw response: ${results}`);
            }

            if ( tomorrowResults.length===24 ) {
              this.pricesCache.set(tomorrowKey, tomorrowResults);

              // keep decimalPrecision cache fresh so it does not ttl/expire
              this.pricesCache.set('decimalPrecision', this.decimalPrecision);

              this.platform.log.debug(`OK: pulled Nordpool prices in ${this.platform.config.area} area for TOMORROW (${tomorrowKey})`);
              this.platform.log.debug(JSON.stringify(tomorrowResults.map(({ hour, price }) => ({ hour, price }))));
              if (this.dynamicCheapestConsecutiveHours) {
                this.getCheapestHoursIn2days();
              }
            }
          } else {
            this.platform.log.warn('WARN: API returned no or abnormal results for todays\'s Nordpool prices data. Will retry in 1 hour');
          }
        })
        .catch((error) => {
          this.platform.log.error(`ERR: Failed to get todays's prices, will retry in 1 hour. ${error}`);
        });
    } else {
      this.pricing.today = this.pricesCache.getSync(todayKey, []);
      this.analyze_and_setServices(currentHour);
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
      this.fnc.getCheapestHoursToday();
    }

    if (
      this.pricing.cheapest5HoursConsec.length === 0
        || (currentHour === 0 && (!this.dynamicCheapestConsecutiveHours || !this.pricesCache.getSync('5consecutiveUpdated', false)))
        || (currentHour === 7 && this.dynamicCheapestConsecutiveHours)
    ) {
      this.fnc.getCheapestConsecutiveHours(5, this.pricing.today).then((retVal) => {
        this.pricing.cheapest5HoursConsec = retVal;
        this.fnc.setOccupancyByHour(currentHour, 'cheapest5HoursConsec');
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

      this.fnc.setOccupancyByHour(currentHour, key);
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

    this.fnc.getCheapestConsecutiveHours(5, twoDaysPricing).then((retVal) => {
      this.pricing.cheapest5HoursConsec = retVal;
    }).catch((error)=> {
      this.platform.log.error('An error occurred calculating cheapest 5 consecutive hours: ', error);
    });

  }

}