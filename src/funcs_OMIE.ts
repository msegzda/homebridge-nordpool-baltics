import axios from 'axios';
import { DateTime } from 'luxon';
import { Logger, PlatformConfig } from 'homebridge';
import { defaultAreaTimezone } from './settings';

// MIBEL (Mercado Ibérico de Electricidade) market timezone — OMIE publishes data in CET
const OMIE_MARKET_TIMEZONE = 'Europe/Madrid';

function buildOmieUrl(date: DateTime): string {
  const dateStr = date.toFormat('yyyyMMdd');
  return `https://www.omie.es/es/file-download?parents=marginalpdbcpt&filename=marginalpdbcpt_${dateStr}.1`;
}

async function fetchOmieFile(log: Logger, date: DateTime): Promise<string | null> {
  const url = buildOmieUrl(date);
  try {
    const response = await axios.get(url, { timeout: 10000, responseType: 'text' });
    if (response.status !== 200 || !response.data) return null;
    return response.data as string;
  } catch (error) {
    log.debug(`DEBUG: OMIE fetch failed for ${date.toFormat('yyyy-MM-dd')}: ${error}`);
    return null;
  }
}

export function omie_convertDataStructure(
  csvText: string,
  area: string,
  config: PlatformConfig,
): { day: string; hour: number; price: number }[] {
  const decimalPrecision = config.decimalPrecision ?? 1;
  const results: { day: string; hour: number; price: number }[] = [];

  for (const line of csvText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '*' || trimmed.startsWith('MARGINAL')) continue;

    const parts = trimmed.split(';').map(p => p.trim()).filter(p => p);
    if (parts.length < 6) continue;

    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    const quarter = parseInt(parts[3]); // 1-indexed 15-minute slots (1–96 per normal day)
    const esPrice = parseFloat(parts[4]);
    const ptPrice = parseFloat(parts[5]);

    if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(quarter)) continue;

    const priceEurMwh = area === 'PT' ? ptPrice : esPrice;
    if (isNaN(priceEurMwh)) continue;

    // Convert EUR/MWh → cents/kWh by dividing by 10
    const priceCentsKwh = parseFloat((priceEurMwh / 10).toFixed(decimalPrecision));

    // Each quarter index (1-based) represents 15 minutes of elapsed real time since the
    // start of the CET calendar day.  Using DateTime.fromObject with a derived local hour
    // breaks on DST spring-forward days because the computed hour (e.g. 02:00 CET) does
    // not exist in local time — Luxon snaps it to the next valid time and two price slots
    // collapse onto the same hour.  Instead, add elapsed minutes to the unambiguous
    // start-of-day UTC instant and let Luxon resolve the DST transition automatically.
    const offsetMinutes = (quarter - 1) * 15;
    const dt = DateTime.fromObject(
      { year, month, day, hour: 0, minute: 0, second: 0 },
      { zone: OMIE_MARKET_TIMEZONE },
    ).plus({ minutes: offsetMinutes })
      .setZone(defaultAreaTimezone(config));

    results.push({
      day: dt.toFormat('yyyy-MM-dd'),
      hour: dt.hour,
      price: priceCentsKwh,
    });
  }

  return results;
}

export async function omie_getNordpoolData(log: Logger, config: PlatformConfig) {
  const area = config.area.toUpperCase();

  // Fetch today and tomorrow files (OMIE CET dates) to cover a full 48-hour window.
  // Portugal is 1 hour behind CET, so combining both files yields all 24 Portuguese hours for today.
  const today = DateTime.now().setZone(OMIE_MARKET_TIMEZONE);
  const tomorrow = today.plus({ days: 1 });

  const [todayCSV, tomorrowCSV] = await Promise.all([
    fetchOmieFile(log, today),
    fetchOmieFile(log, tomorrow),
  ]);

  if (!todayCSV) {
    log.error(`ERR: OMIE API provider returned no data for ${area}`);
    return null;
  }

  const data = omie_convertDataStructure(todayCSV, area, config);

  if (data.length < 92) {
    log.error(`ERR: OMIE API provider returned insufficient data (${data.length} entries)`);
    return null;
  }

  if (tomorrowCSV) {
    data.push(...omie_convertDataStructure(tomorrowCSV, area, config));
  }

  return data;
}
