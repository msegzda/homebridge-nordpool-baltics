import { DateTime } from 'luxon';
import { defaultAreaTimezone } from './settings';
import axios from 'axios';
import { Logger, PlatformConfig } from 'homebridge';

export async function awattar_getNordpoolData(log: Logger, config: PlatformConfig) {
  const areaTimeZone = defaultAreaTimezone(config);
  const tomorrow = DateTime.now().plus({ days: 2 }).startOf('day').toFormat('yyyy-MM-dd');
  const today = DateTime.now().minus({ days: 1 }).startOf('day').toFormat('yyyy-MM-dd');
  const url = `https://api.awattar.de/v1/marketdata?start=${today}&end=${tomorrow}`;
  log.debug(`DEBUG: Fetching ${url}`);

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
  data: { start_timestamp: number; end_timestamp: number; marketprice: number; unit: string }[],
  config: PlatformConfig,
) {
  const areaTimeZone = defaultAreaTimezone(config);
  const decimalPrecision = config.decimalPrecision ?? 1;

  return data.map((item) => {
    // start_timestamp is in milliseconds
    const date = DateTime.fromMillis(item.start_timestamp);

    // marketprice is Eur/MWh, convert to cents/kWh by dividing by 10
    const price = parseFloat((item.marketprice / 10).toFixed(decimalPrecision));

    return {
      day: date.toFormat('yyyy-MM-dd'),
      hour: parseInt(date.toFormat('HH')),
      price: price,
    };
  });
}
