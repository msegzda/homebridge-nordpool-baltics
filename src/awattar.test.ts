/**
 * Live integration tests for the aWATTar API data pipeline.
 *
 * Tests download real hourly price data from the aWATTar public API for each
 * supported region (AT, DE, LU) and validate both the raw response and the
 * converted output produced by awattar_convertDataStructure. Requires internet
 * access.
 *
 * Luxembourg (LU) uses the aWATTar DE endpoint and is expected to return
 * identical prices to DE — a cross-region comparison test verifies this.
 */

import axios from 'axios';
import { DateTime } from 'luxon';
import { awattar_convertDataStructure } from './funcs_Awattar';
import { defaultAreaTimezone } from './settings';

// ──────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────

/** Regions served by the aWATTar API */
const AWATTAR_REGIONS = ['AT', 'DE', 'LU'] as const;
type AwattarRegion = typeof AWATTAR_REGIONS[number];

/** Stores per-region converted output for cross-region assertions */
const convertedByRegion = new Map<AwattarRegion, NordpoolEntry[]>();

/** Raw shape returned by the aWATTar API (only fields used by the plugin) */
interface AwattarRawEntry {
  start_timestamp: number; // Unix timestamp in milliseconds
  marketprice: number;     // Price in EUR/MWh
}

/** Converted shape produced by awattar_convertDataStructure */
interface NordpoolEntry {
  day: string;
  hour: number;
  price: number;
}

// Network requests can be slow — allow up to 30 s per test.
jest.setTimeout(30000);

// ──────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────

function mockConfig(area: AwattarRegion) {
  return { area, decimalPrecision: 2 } as never;
}

/** aWATTar domain: AT uses awattar.at; DE and LU both use awattar.de */
function awattarDomain(area: AwattarRegion): string {
  return area.toLowerCase() === 'at' ? 'awattar.at' : 'awattar.de';
}

/** Build the API URL matching what awattar_getNordpoolData uses */
function awattarUrl(area: AwattarRegion): string {
  const tz = defaultAreaTimezone({ area } as never);
  const tomorrow = DateTime.now().setZone(tz).plus({ days: 2 }).startOf('day').toFormat('yyyy-MM-dd');
  const today    = DateTime.now().setZone(tz).minus({ days: 1 }).startOf('day').toFormat('yyyy-MM-dd');
  return `https://api.${awattarDomain(area)}/v1/marketdata?start=${today}&end=${tomorrow}`;
}

/**
 * Today's date expressed in the area's own timezone (matches awattar_convertDataStructure).
 */
function todayForRegion(area: AwattarRegion): string {
  const tz = defaultAreaTimezone({ area } as never);
  return DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');
}

/** Returns the number of local hours in a calendar day (23 on spring-forward, 24 on normal). */
function hoursInDay(dateStr: string, tz: string): number {
  const start = DateTime.fromISO(dateStr, { zone: tz });
  return Math.round(start.plus({ days: 1 }).diff(start, 'hours').hours);
}

/** Returns the local clock hour skipped by DST spring-forward, or null on a normal day. */
function dstMissingHour(dateStr: string, tz: string): number | null {
  const start = DateTime.fromISO(dateStr, { zone: tz });
  if (Math.round(start.plus({ days: 1 }).diff(start, 'hours').hours) !== 23) return null;
  for (let h = 0; h <= 23; h++) {
    const dt = start.plus({ hours: h });
    if (dt.hour !== h) return h;
  }
  return null;
}

// ──────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────

describe('aWATTar API – live data tests', () => {

  AWATTAR_REGIONS.forEach((region: AwattarRegion) => {

    describe(`Region ${region}`, () => {

      let rawData: AwattarRawEntry[];
      let converted: NordpoolEntry[];

      const config      = mockConfig(region);
      const today       = todayForRegion(region);
      const tz          = defaultAreaTimezone(config);
      const isDstToday  = hoursInDay(today, tz) === 23;
      const missingHour = dstMissingHour(today, tz);

      // Download once per region before running assertions
      beforeAll(async () => {
        const url = awattarUrl(region);
        const response = await axios.get<{ data: AwattarRawEntry[] }>(url, { timeout: 15000 });
        rawData   = response.data.data;
        converted = awattar_convertDataStructure(rawData, config);
        convertedByRegion.set(region, converted);
      });

      // ── Raw data validation ────────────────────────────────────────────────

      it('returns HTTP 200 and a non-empty data array', () => {
        console.log(`[${region}] Total raw entries: ${rawData.length}`);
        expect(Array.isArray(rawData)).toBe(true);
        expect(rawData.length).toBeGreaterThan(0);
      });

      it('every entry has valid start_timestamp (ms) and marketprice', () => {
        const first = rawData[0];
        const last  = rawData[rawData.length - 1];
        console.log(`[${region}] First entry: start=${new Date(first.start_timestamp).toISOString()}, price=${first.marketprice}`);
        console.log(`[${region}] Last  entry: start=${new Date(last.start_timestamp).toISOString()}, price=${last.marketprice}`);

        rawData.forEach((entry, idx) => {
          expect(typeof entry.start_timestamp).toBe('number');
          expect(typeof entry.marketprice).toBe('number');
          // Timestamps must be positive and in milliseconds (> year 2000 epoch ms)
          expect(entry.start_timestamp).toBeGreaterThan(946684800000);
          expect(isFinite(entry.marketprice)).toBe(true);
          if (entry.start_timestamp <= 0) {
            fail(`Entry ${idx} has invalid start_timestamp: ${entry.start_timestamp}`);
          }
        });
      });

      it(`contains at least 23 entries for today (${today}) — hourly intervals`, () => {
        // aWATTar returns one entry per hour; 23 is the minimum for a DST short day.
        // Use the area timezone (same as awattar_convertDataStructure) to determine today's entries.
        const todayEntries = rawData.filter(entry => {
          const date = DateTime.fromMillis(entry.start_timestamp).setZone(defaultAreaTimezone(config));
          return date.toFormat('yyyy-MM-dd') === today;
        });
        console.log(`[${region}] Raw entries for today (${today}): ${todayEntries.length}`);
        expect(todayEntries.length).toBeGreaterThanOrEqual(23);
      });

      it('start_timestamps are strictly increasing (sorted order)', () => {
        const span = rawData[rawData.length - 1].start_timestamp - rawData[0].start_timestamp;
        console.log(`[${region}] Timestamp span: ${(span / 3600000).toFixed(1)} hours across ${rawData.length} entries`);
        for (let i = 1; i < rawData.length; i++) {
          expect(rawData[i].start_timestamp).toBeGreaterThan(rawData[i - 1].start_timestamp);
        }
      });

      // ── Converted data validation ──────────────────────────────────────────

      it('converts to a non-empty NordpoolData array', () => {
        const days = [...new Set(converted.map(e => e.day))].sort();
        console.log(`[${region}] Converted entries: ${converted.length}, days: ${days.join(', ')}`);
        expect(Array.isArray(converted)).toBe(true);
        expect(converted.length).toBeGreaterThan(0);
      });

      it('every converted entry has correct shape (day, hour, price)', () => {
        converted.forEach(item => {
          // day must be YYYY-MM-DD
          expect(typeof item.day).toBe('string');
          expect(item.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          // hour must be 0-23
          expect(typeof item.hour).toBe('number');
          expect(item.hour).toBeGreaterThanOrEqual(0);
          expect(item.hour).toBeLessThanOrEqual(23);
          // price must be a finite number
          expect(typeof item.price).toBe('number');
          expect(isFinite(item.price)).toBe(true);
        });
      });

      it(`has today's (${today}) prices in the converted output (≥23 hourly entries)`, () => {
        const todayPrices = converted.filter(item => item.day === today);
        console.log(`[${region}] Converted entries for today (${today}): ${todayPrices.length}`);
        expect(todayPrices.length).toBeGreaterThanOrEqual(23);
      });

      it(`covers at least hours 0-22 for today (${today})`, () => {
        const hours = converted
          .filter(item => item.day === today)
          .map(item => item.hour);
        const uniqueHours = [...new Set(hours)].sort((a, b) => a - b);
        console.log(`[${region}] Unique hours found for today: ${uniqueHours.join(', ')}`);
        for (let h = 0; h <= 22; h++) {
          if (h === missingHour) continue; // On DST spring-forward day this hour does not exist
          expect(uniqueHours).toContain(h);
        }
      });

      it('has exactly one entry per hour for today (hourly granularity)', () => {
        // aWATTar provides one price slot per hour — no sub-hourly entries.
        const todayPrices = converted.filter(item => item.day === today);
        const byHour = new Map<number, number>();
        todayPrices.forEach(item => {
          byHour.set(item.hour, (byHour.get(item.hour) ?? 0) + 1);
        });
        console.log(`[${region}] Entries per hour: ${[...byHour.entries()].map(([h, c]) => `h${h}:${c}`).join(' ')}`);
        byHour.forEach((count, _hour) => {
          expect(count).toBe(1);
        });
        // All hours of the day should be present
        expect(byHour.size).toBeGreaterThanOrEqual(23);
      });

      it('prices are in cents/kWh range (divided by 10, expect -100 to 500)', () => {
        const todayPrices = converted.filter(item => item.day === today);
        const prices = todayPrices.map(p => p.price);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const avg = (prices.reduce((s, p) => s + p, 0) / prices.length).toFixed(2);
        console.log(`[${region}] Today price range: min=${min}, max=${max}, avg=${avg} c/kWh`);
        todayPrices.forEach(item => {
          // marketprice in EUR/MWh ÷ 10 = cents/kWh; sanity bounds
          expect(item.price).toBeGreaterThanOrEqual(-100);
          expect(item.price).toBeLessThanOrEqual(500);
        });
      });

      it('decimal precision is applied (max 2 decimal places)', () => {
        const sample = converted.filter(item => item.day === today).slice(0, 4);
        console.log(`[${region}] Sample converted prices (first 4 of today): ${sample.map(e => `h${e.hour}:${e.price}`).join(', ')}`);
        converted.forEach(item => {
          const decimalPart = String(item.price).split('.')[1];
          const decimals = decimalPart ? decimalPart.length : 0;
          expect(decimals).toBeLessThanOrEqual(2);
        });
      });

    }); // describe region

  }); // AWATTAR_REGIONS.forEach

  // ── Cross-region comparison ────────────────────────────────────────────────

  describe('Cross-region: LU prices match DE prices (same aWATTar DE endpoint)', () => {

    const today = todayForRegion('DE');

    it('LU and DE have identical hourly prices for today', () => {
      const de = (convertedByRegion.get('DE') ?? []).filter(e => e.day === today);
      const lu = (convertedByRegion.get('LU') ?? []).filter(e => e.day === today);

      expect(de.length).toBeGreaterThan(0);
      expect(lu.length).toBe(de.length);

      // Build hour → price maps for a deterministic comparison
      const deByHour = new Map(de.map(e => [e.hour, e.price]));
      const luByHour = new Map(lu.map(e => [e.hour, e.price]));

      console.log(`[DE vs LU] DE today prices: ${[...deByHour.entries()].map(([h, p]) => `h${h}:${p}`).join(' ')}`);
      console.log(`[DE vs LU] LU today prices: ${[...luByHour.entries()].map(([h, p]) => `h${h}:${p}`).join(' ')}`);

      deByHour.forEach((price, hour) => {
        expect(luByHour.get(hour)).toBe(price);
      });
    });

  }); // describe cross-region

  // ── DST spring-forward: tomorrow must have the right number of hourly slots ──

  describe('DST spring-forward – tomorrow has the correct number of hourly price slots', () => {

    AWATTAR_REGIONS.forEach((region: AwattarRegion) => {

      const tz       = defaultAreaTimezone({ area: region } as never);
      const tomorrow = DateTime.now().setZone(tz).plus({ days: 1 }).toFormat('yyyy-MM-dd');
      const isDstDay = hoursInDay(tomorrow, tz) === 23;
      // Only activate this test on the eve of a DST spring-forward day.
      const testFn   = isDstDay ? it : it.skip;

      testFn(`[${region}] tomorrow (${tomorrow}) has exactly 23 hourly price slots on DST spring-forward day`, () => {
        const tomorrowEntries = (convertedByRegion.get(region) ?? []).filter(e => e.day === tomorrow);
        const uniqueHours     = new Set(tomorrowEntries.map(e => e.hour));

        console.log(
          `[${region}] Tomorrow ${tomorrow}: ${uniqueHours.size} unique hours (DST spring-forward ⏰)`
        );

        expect(uniqueHours.size).toBe(23);
      });

    }); // AWATTAR_REGIONS.forEach

  }); // describe DST

}); // describe suite
