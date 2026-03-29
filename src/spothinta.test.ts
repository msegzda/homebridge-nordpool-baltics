/**
 * Live integration tests for the SpotHinta API data pipeline.
 *
 * Tests download real hourly price data from the SpotHinta public API for each
 * supported region (SE1–SE4, DK1–DK2, NO1–NO5) and validate both the raw
 * response and the converted output produced by spothinta_convertDataStructure.
 * Requires internet access.
 */

import axios from 'axios';
import { DateTime } from 'luxon';
import { spothinta_convertDataStructure } from './funcs_SpotHinta';
import { defaultAreaTimezone } from './settings';

// ──────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────

/** Regions served by the SpotHinta API */
const SPOTHINTA_REGIONS = ['SE1', 'SE2', 'SE3', 'SE4', 'DK1', 'DK2', 'NO1', 'NO2', 'NO3', 'NO4', 'NO5'] as const;
type SpotHintaRegion = typeof SPOTHINTA_REGIONS[number];

/** Raw shape returned by the SpotHinta API (only fields used by the plugin) */
interface SpotHintaRawEntry {
  DateTime: string; // ISO 8601 datetime string
  PriceNoTax: number;
}

/** Converted shape produced by spothinta_convertDataStructure */
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

function mockConfig(area: SpotHintaRegion) {
  return { area, decimalPrecision: 2 } as never;
}

/** Build the API URL matching what spothinta_getNordpoolData uses */
function spothintaUrl(area: SpotHintaRegion): string {
  const tz = defaultAreaTimezone({ area } as never);
  const reqDate = DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');
  return `https://api.spot-hinta.fi/TodayAndDayForward?reqDate=${reqDate}&region=${area}`;
}

/** Today's date expressed in the area's own timezone (matches spothinta_convertDataStructure) */
function todayForRegion(area: SpotHintaRegion): string {
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

describe('SpotHinta API – live data tests', () => {

  // Fetch all regions concurrently once before any nested suite runs.
  const fetchResults = new Map<SpotHintaRegion, { rawData: SpotHintaRawEntry[]; converted: NordpoolEntry[] }>();

  beforeAll(async () => {
    await Promise.all(
      SPOTHINTA_REGIONS.map(async (region) => {
        const url = spothintaUrl(region);
        const response = await axios.get<SpotHintaRawEntry[]>(url, { timeout: 15000 });
        const rawData = response.data;
        const converted = spothinta_convertDataStructure(rawData, mockConfig(region));
        fetchResults.set(region, { rawData, converted });
      }),
    );
  });

  SPOTHINTA_REGIONS.forEach((region: SpotHintaRegion) => {

    describe(`Region ${region}`, () => {

      let rawData: SpotHintaRawEntry[];
      let converted: NordpoolEntry[];

      const config      = mockConfig(region);
      const today       = todayForRegion(region);
      const tz          = defaultAreaTimezone(config);
      const isDstToday  = hoursInDay(today, tz) === 23;
      const missingHour = dstMissingHour(today, tz);

      beforeAll(() => {
        ({ rawData, converted } = fetchResults.get(region)!);
      });

      // ── Raw data validation ────────────────────────────────────────────────

      it('returns HTTP 200 and a non-empty data array', () => {
        console.log(`[${region}] Total raw entries: ${rawData.length}`);
        expect(Array.isArray(rawData)).toBe(true);
        expect(rawData.length).toBeGreaterThan(0);
      });

      it('every entry has valid DateTime (ISO string) and PriceNoTax', () => {
        const first = rawData[0];
        const last  = rawData[rawData.length - 1];
        console.log(`[${region}] First entry: DateTime=${first.DateTime}, PriceNoTax=${first.PriceNoTax}`);
        console.log(`[${region}] Last  entry: DateTime=${last.DateTime}, PriceNoTax=${last.PriceNoTax}`);

        rawData.forEach((entry, idx) => {
          expect(typeof entry.DateTime).toBe('string');
          expect(entry.DateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
          expect(typeof entry.PriceNoTax).toBe('number');
          expect(isFinite(entry.PriceNoTax)).toBe(true);
          if (!entry.DateTime) {
            fail(`Entry ${idx} has missing DateTime`);
          }
        });
      });

      it(`contains at least 92 entries for today (${today}) — 15-min intervals`, () => {
        // SpotHinta returns 15-min interval data: 24 h × 4 intervals = 96 entries per full day.
        // 92 = 23 complete hours minimum (handles potential DST / partial days).
        const tz = defaultAreaTimezone(config);
        const todayEntries = rawData.filter(entry => {
          const date = DateTime.fromISO(entry.DateTime).setZone(tz);
          return date.toFormat('yyyy-MM-dd') === today;
        });
        console.log(`[${region}] Raw entries for today (${today}): ${todayEntries.length}`);
        expect(todayEntries.length).toBeGreaterThanOrEqual(92);
      });

      it('DateTime strings are strictly increasing (sorted order)', () => {
        const tz = defaultAreaTimezone(config);
        const timestamps = rawData.map(e => DateTime.fromISO(e.DateTime).setZone(tz).toMillis());
        const span = timestamps[timestamps.length - 1] - timestamps[0];
        console.log(`[${region}] Timestamp span: ${(span / 3600000).toFixed(1)} hours across ${rawData.length} entries`);
        for (let i = 1; i < timestamps.length; i++) {
          expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
        }
      });

      it('each slot spans exactly 15 minutes (900 000 ms) — 15-min granularity', () => {
        const tz = defaultAreaTimezone(config);
        for (let i = 1; i < rawData.length; i++) {
          const prev = DateTime.fromISO(rawData[i - 1].DateTime).setZone(tz).toMillis();
          const curr = DateTime.fromISO(rawData[i].DateTime).setZone(tz).toMillis();
          const span = curr - prev;
          if (span !== 900000) {
            fail(`Entries ${i - 1}→${i} span is ${span} ms (expected 900 000 ms)`);
          }
          expect(span).toBe(900000);
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

      it(`has today's (${today}) prices in the converted output (15-min granularity, ≥92 entries)`, () => {
        // spothinta_convertDataStructure maps each 15-min slot to {day, hour, price} without
        // deduplicating hours. Hourly averaging is done by Functions.convertToHourlyAverages.
        const todayPrices = converted.filter(item => item.day === today);
        console.log(`[${region}] Converted entries for today (${today}): ${todayPrices.length}`);
        expect(todayPrices.length).toBeGreaterThanOrEqual(92);
      });

      it(`covers at least hours 0–22 for today (${today})`, () => {
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

      it('has exactly 4 sub-hourly entries per hour for today (15-min granularity)', () => {
        // SpotHinta returns 15-min intervals; after spothinta_convertDataStructure there are
        // 4 entries per hour (each mapping to the same hour integer but different prices).
        const todayPrices = converted.filter(item => item.day === today);
        const byHour = new Map<number, number>();
        todayPrices.forEach(item => {
          byHour.set(item.hour, (byHour.get(item.hour) ?? 0) + 1);
        });
        console.log(`[${region}] Sub-hourly entries per hour: ${[...byHour.entries()].map(([h, c]) => `h${h}:${c}`).join(' ')}`);
        byHour.forEach((count, _hour) => {
          expect(count).toBe(4);
        });
        expect(byHour.size).toBe(isDstToday ? 23 : 24);
      });

      it('prices are in cents/kWh range (PriceNoTax * 100, expect -100 to 500)', () => {
        const todayPrices = converted.filter(item => item.day === today);
        const prices = todayPrices.map(p => p.price);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const avg = (prices.reduce((s, p) => s + p, 0) / prices.length).toFixed(2);
        console.log(`[${region}] Today price range: min=${min}, max=${max}, avg=${avg} c/kWh`);
        todayPrices.forEach(item => {
          // PriceNoTax in EUR/kWh × 100 = cents/kWh; sanity bounds
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

  }); // SPOTHINTA_REGIONS.forEach

  // ── DST spring-forward: tomorrow must have the right number of hourly slots ──

  describe('DST spring-forward – tomorrow has the correct number of hourly price slots', () => {

    SPOTHINTA_REGIONS.forEach((region: SpotHintaRegion) => {

      const tz       = defaultAreaTimezone({ area: region } as never);
      const tomorrow = DateTime.now().setZone(tz).plus({ days: 1 }).toFormat('yyyy-MM-dd');
      const isDstDay = hoursInDay(tomorrow, tz) === 23;
      // Only activate this test on the eve of a DST spring-forward day.
      const testFn   = isDstDay ? it : it.skip;

      testFn(`[${region}] tomorrow (${tomorrow}) has exactly 23 hourly price slots on DST spring-forward day`, () => {
        const tomorrowEntries = (fetchResults.get(region)?.converted ?? []).filter(e => e.day === tomorrow);
        const uniqueHours     = new Set(tomorrowEntries.map(e => e.hour));

        console.log(
          `[${region}] Tomorrow ${tomorrow}: ${uniqueHours.size} unique hours (DST spring-forward ⏰)`
        );

        expect(uniqueHours.size).toBe(23);
      });

    }); // SPOTHINTA_REGIONS.forEach

  }); // describe DST

}); // describe suite
