import axios from 'axios';
import { DateTime } from 'luxon';
import { Logger, PlatformConfig } from 'homebridge';
import { defaultAreaTimezone } from './settings';

export async function spothinta_getNordpoolData(log: Logger, config: PlatformConfig) {
  const area = config.area.toUpperCase(); // Ensure the area is in uppercase (e.g., SE1, SE2, etc.)
  const reqDate = DateTime.now().toFormat('yyyy-MM-dd');
  const url = `https://d2bgvb23eieffh.cloudfront.net/?reqDate=${reqDate}&region=${area}`;

  try {
    const response = await axios.get(url, {timeout:10000});

    if (response.status !== 200) {
      log.warn(`WARN: Nordpool API provider 2 returned unusual response status ${response.status}`);
      return null;
    }

    if (!response.data || response.data.length < 23) {
      log.error(`ERR: Nordpool API provider 2 returned unusual data ${JSON.stringify(response.data)}`);
      return null;
    }

    const convertedData = spothinta_convertDataStructure(response.data, config);
    return convertedData;
  } catch (error) {
    log.error(`ERR: General Nordpool API provider 2 error: ${error}`);
    return null;
  }
}


export function spothinta_convertDataStructure(
  data: { Rank: number; DateTime: string; PriceNoTax: number; PriceWithTax: number }[],
  config: PlatformConfig,
): { day: string; hour: number; price: number }[] {

  const decimalPrecision = config.decimalPrecision ?? 1;

  return data
    .map((item) => {
      // Convert timestamp from ISO
      const date = DateTime.fromISO(item['DateTime']).setZone(defaultAreaTimezone(config));
      // Convert price from EUR to Cents per kWh
      const price = parseFloat((item['PriceNoTax']*100).toFixed(decimalPrecision));

      return {
        day: date.toFormat('yyyy-MM-dd'),
        hour: parseInt(date.toFormat('HH')),
        price,
      };
    });
}