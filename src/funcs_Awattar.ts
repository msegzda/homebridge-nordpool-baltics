import { DateTime } from 'luxon';
import { defaultAreaTimezone } from './settings';
import axios from 'axios';
import { Logger, PlatformConfig } from 'homebridge';

export async function awattar_getNordpoolData(log: Logger, config: PlatformConfig) {
  const areaTimeZone = defaultAreaTimezone(config);
  const tomorrow = DateTime.now().setZone(areaTimeZone).plus({ days: 2 }).startOf('day').toFormat('yyyy-MM-dd');
  const today = DateTime.now().setZone(areaTimeZone).minus({ days: 1 }).startOf('day').toFormat('yyyy-MM-dd');

  const domain = config.area.toLowerCase() === 'at' ? 'awattar.at' : 'awattar.de';
  const url = `https://api.${domain}/v1/marketdata?start=${today}&end=${tomorrow}`;

  try {
    const response = await axios.get(url, { timeout: 10000 });
    if (response.status !== 200) {
      log.warn(`WARN: Nordpool API provider 3 (Awattar) returned unusual response status ${response.status}`);
    }
    if (response.data && response.data.data) {
      const convertedData = awattar_convertDataStructure(response.data.data, config);
      return convertedData;
    } else {
      log.error(`ERR: Nordpool API provider 3 (Awattar) returned unusual data ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    log.error(`ERR: General Nordpool API provider 3 (Awattar) error: ${error}`);
  }
  return null;
}

export function awattar_convertDataStructure(
  data: { start_timestamp: number; marketprice: number }[],
  config: PlatformConfig,
) {
  const areaTimeZone = defaultAreaTimezone(config);
  const decimalPrecision = config.decimalPrecision ?? 1;

  return data.map((item) => {
    // start_timestamp is in milliseconds — convert in area timezone, not local system timezone
    const date = DateTime.fromMillis(item.start_timestamp).setZone(areaTimeZone);

    // marketprice is Eur/MWh, convert to cents/kWh by dividing by 10
    const price = parseFloat((item.marketprice / 10).toFixed(decimalPrecision));

    return {
      day: date.toFormat('yyyy-MM-dd'),
      hour: parseInt(date.toFormat('HH')),
      price: price,
    };
  });
}
