import { DateTime } from 'luxon';
import { defaultAreaTimezone } from './settings';
import axios from 'axios';
import { Logger, PlatformConfig } from 'homebridge';

export async function eleringEE_getNordpoolData(log:Logger, config:PlatformConfig) {

  // logic and format resembles elering implementation on nordpool-cf/src/worker.js
  const url = `https://pub-460c981173fb4262a268d6f273d18dd2.r2.dev/elering_${config.area.toUpperCase()}.json`;

  try {
    const response = await axios.get(url, {timeout:10000});
    if (response.status !== 200 ) {
      log.warn(`WARN: Nordpool API provider 1 returned unusual response status ${response.status}`);
    }
    if (response.data) {
      const convertedData = eleringEE_convertDataStructure(response.data, config);
      return convertedData;
    } else {
      log.error(`ERR: Nordpool API provider 1 returned unusual data ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    log.error(`ERR: General Nordpool API provider 1 error: ${error}`);
  }
  return null;
}

export function eleringEE_convertDataStructure(
  data: { timestamp: number; price: number }[],
  config: PlatformConfig,
) {
  const areaTimeZone = defaultAreaTimezone(config);
  const decimalPrecision = config.decimalPrecision ?? 1;

  return data.map((item: { timestamp: number; price: number }) => {
    // convert the timestamp to ISO string, then to timezone in the area
    const date = DateTime.fromISO(new Date(item.timestamp * 1000).toISOString()).setZone(areaTimeZone);
    // divide by 10 to convert price to cents per kWh
    item.price = parseFloat((item.price / 10).toFixed(decimalPrecision));

    return {
      day: date.toFormat('yyyy-MM-dd'),
      hour: parseInt(date.toFormat('HH')),
      price: item.price,
    };
  });
}
