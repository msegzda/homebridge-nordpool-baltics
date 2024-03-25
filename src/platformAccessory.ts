import { PlatformAccessory, API } from 'homebridge';
import { NordpoolPlatform } from './platform';

import {
  defaultPricing, defaultService, defaultPricesCache,
  fnc_todayKey, fnc_tomorrowKey, fnc_currentHour,
} from './settings';

import { Functions } from './functions';
import { schedule } from 'node-cron';

export class NordpoolPlatformAccessory {

  private decimalPrecision = this.platform.config.decimalPrecision ?? 1;
  private dynamicCheapestConsecutiveHours:boolean = this.platform.config.dynamicCheapestConsecutiveHours ?? false;
  private pricing = defaultPricing;
  private service = defaultService;
  private pricesCache = defaultPricesCache(this.api);
  private fnc = new Functions(this.platform, this.accessory, this.pricing, this.service, this.api);

  constructor(
    private readonly platform: NordpoolPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly api: API,
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
        await this.pricesCache.remove('5consecutiveUpdated');
      } catch (error) {
        this.platform.log.error(`ERR: failed clearing pricesCache: ${JSON.stringify(error)}`);
      } finally {
        this.platform.log.warn(
          `Configured Decimal Precision value changed from ${decimalPrecisionCache} to ${this.decimalPrecision}`,
        );
        this.pricesCache.set('decimalPrecision', this.decimalPrecision);
      }
    }

    const areaCache = this.pricesCache.getSync('area');
    if (this.platform.config.area !== undefined && areaCache !== this.platform.config.area) {
      try {
        await this.pricesCache.remove(todayKey);
        await this.pricesCache.remove(tomorrowKey);
        await this.pricesCache.remove('5consecutiveUpdated');
      } catch (error) {
        this.platform.log.error(`ERR: failed clearing pricesCache: ${JSON.stringify(error)}`);
      } finally {
        this.platform.log.warn(
          `Configured Nordpool area changed from ${areaCache} to ${this.platform.config.area}`,
        );
        this.pricesCache.set('area', this.platform.config.area);
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
              this.fnc.analyze_and_setServices(currentHour);
            } else {
              this.platform.log.warn('WARN: Something is incorrect with API response. Unable to determine today\'s Nordpool prices.');
              this.platform.log.warn(`Raw response: ${results}`);
            }

            if ( tomorrowResults.length===24 ) {
              this.pricesCache.set(tomorrowKey, tomorrowResults);

              // keep decimalPrecision and area cache fresh so it does not ttl/expire
              this.pricesCache.set('decimalPrecision', this.decimalPrecision);
              this.pricesCache.set('area', this.platform.config.area);

              this.platform.log.debug(`OK: pulled Nordpool prices in ${this.platform.config.area} area for TOMORROW (${tomorrowKey})`);
              this.platform.log.debug(JSON.stringify(tomorrowResults.map(({ hour, price }) => ({ hour, price }))));

              if (this.dynamicCheapestConsecutiveHours) {
                setTimeout(() => {
                  this.fnc.getCheapestHoursIn2days();
                }, 2000);
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
      this.fnc.analyze_and_setServices(currentHour);
    }
  }
}