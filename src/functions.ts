import { NordpoolPlatform } from './platform';
import { DateTime } from 'luxon';
import axios from 'axios';

import {
  defaultPricing, defaultService, defaultAreaTimezone, PLATFORM_MANUFACTURER, defaultPricesCache,
  fnc_todayKey, fnc_tomorrowKey, fnc_currentHour, PriceData,
} from './settings';

export async function fnc_checkSystemTimezone(platform: NordpoolPlatform) {
  const systemTimezone = DateTime.local().toFormat('ZZ');
  const preferredTimezone = DateTime.local().setZone(defaultAreaTimezone).toFormat('ZZ');

  if (systemTimezone !== preferredTimezone) {
    platform.log.warn(
      `WARN: System timezone ${systemTimezone} DOES NOT match with ${platform.config.area} area timezone ${preferredTimezone}.`
        + 'This may result in incorrect time-to-price coding. If possible, please update your system time setting to match timezone of '
        + 'your specified Nordpool area.',
    );
  } else {
    platform.log.debug(
      `OK: system timezone ${systemTimezone} match ${platform.config.area} area timezone ${preferredTimezone}`,
    );
  }
}

export async function eleringEE_getNordpoolData(platform: NordpoolPlatform) {
  const start = DateTime.utc().startOf('day').minus({hours:4}).toISO();
  const end = DateTime.utc().plus({days:1}).endOf('day').toISO();

  const encodedStart = encodeURIComponent(start);
  const encodedEnd = encodeURIComponent(end);

  try {
    const url = `https://dashboard.elering.ee/api/nps/price?start=${encodedStart}&end=${encodedEnd}`;
    const response = await axios.get(url);
    if (response.status !== 200 ) {
      platform.log.warn(`WARN: Nordpool API provider Elering returned unusual response status ${response.status}`);
    }
    if (response.data.data) {
      const convertedData = eleringEE_convertDataStructure(platform, response.data.data);
      return convertedData;
    } else {
      platform.log.error(`ERR: Nordpool API provider Elering returned unusual data ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    platform.log.error(`ERR: General Nordpool API provider Elering error: ${error}`);
  }
  return null;
}

function eleringEE_convertDataStructure(
  platform: NordpoolPlatform, data: { [x: string]: { timestamp: number; price: number }[] },
) {
  const area = platform.config.area.toLowerCase();
  const decimalPrecision = platform.config.decimalPrecision ?? 0;

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