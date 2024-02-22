import { PlatformAccessory } from 'homebridge';
import { NordpoolPlatform } from './platform';

import { DateTime } from 'luxon';
import axios from 'axios';

import {
  defaultAreaTimezone, PLATFORM_MANUFACTURER, PLATFORM_MODEL, PLATFORM_SERIAL_NUMBER, Pricing, SensorType,
} from './settings';

export class Functions {

  constructor(
    private readonly platform: NordpoolPlatform,
    private readonly accessory: PlatformAccessory,
  ) {}

  async initAccessories(
    service: SensorType, pricing: Pricing,
  ) {

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, PLATFORM_MANUFACTURER)
      .setCharacteristic(this.platform.Characteristic.Model, PLATFORM_MODEL)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, PLATFORM_SERIAL_NUMBER);

    // init light sensor for current price
    service.currently = this.accessory.getService('Nordpool_currentPrice') || this.accessory.addService(
      this.platform.Service.LightSensor, 'Nordpool_currentPrice', 'currentPrice');

    // set default price level
    if (service.currently) {
      service.currently.getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
        .updateValue(pricing.currently);
    }

    // hourly ticker
    service.hourlyTickerSwitch = this.accessory.getService('Nordpool_hourlyTickerSwitch') || this.accessory.addService(
      this.platform.Service.Switch, 'Nordpool_hourlyTickerSwitch', 'hourlyTickerSwitch');

    // turn OFF hourly ticker if its turned on by schedule or manually
    if (service.hourlyTickerSwitch) {
      service.hourlyTickerSwitch.getCharacteristic(this.platform.Characteristic.On)
        .on('set', (value, callback) => {
          if(value) {
            // If switch is manually turned on, start a timer to switch it back off after 1 second
            setTimeout(() => {
              service.hourlyTickerSwitch!.updateCharacteristic(this.platform.Characteristic.On, false);
              this.platform.log.debug('Hourly ticker switch turned OFF automatically with 1s delay');
            }, 1000);
          }
          callback(null);
        });
    }

    // init virtual occupancy sensors for price levels
    for (const key of Object.keys(service)) {
      if (/^(cheapest|priciest)/.test(key)) {
        service[key] = this.accessory.getService(`Nordpool_${key}`)
        || this.accessory.addService(this.platform.Service.OccupancySensor, `Nordpool_${key}`, key);

        if ( service[key] ) {
        service[key]!
          .getCharacteristic(this.platform.Characteristic.OccupancyDetected)
          .setValue(this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        }
      }
    }
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
      if (item.price < 0) {
        item.price = 0;
      } else {
        item.price = parseFloat((item.price / 10).toFixed(decimalPrecision));
      }

      return {
        day: date.toFormat('yyyy-MM-dd'),
        hour: parseInt(date.toFormat('HH')),
        price: item.price,
      };
    });
  }

}
