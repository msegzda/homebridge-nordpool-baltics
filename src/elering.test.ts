/**
 * Live integration tests for the Elering Cloudflare R2 data pipeline.
 *
 * Tests download real data from the Cloudflare R2 bucket for each supported
 * Elering region and validate both the raw response and the converted output
 * produced by eleringEE_convertDataStructure. Requires internet access.
 */

import axios from 'axios';
import { DateTime } from 'luxon';
import { eleringEE_convertDataStructure } from './funcs_Elering';
import { defaultAreaTimezone } from './settings';

// ──────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────

const R2_BASE_URL = 'https://pub-460c981173fb4262a268d6f273d18dd2.r2.dev';

/** Regions served by the Elering / R2 pipeline */
const ELERING_REGIONS = ['EE', 'LT', 'LV', 'FI'] as const;

/** Stores converted output per region so the suite-level DST section can access it. */
const convertedByRegion = new Map<EleringRegion, NordpoolEntry[]>();
type EleringRegion = typeof ELERING_REGIONS[number];

/** Raw shape stored in each R2 JSON file */
interface EleringRawEntry {
  timestamp: number; // Unix timestamp (seconds)
  price: number;     // Price in raw units (divide by 10 → cents/kWh)
}

/** Converted shape produced by eleringEE_convertDataStructure */
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

function mockConfig(area: EleringRegion) {
  return { area, decimalPrecision: 2 } as never;
}

function todayIn(timezone: string): string {
  return DateTime.local().setZone(timezone).toFormat('yyyy-MM-dd');
}

// ──────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────

describe('Elering R2 Cloudflare – live data tests', () => {

  ELERING_REGIONS.forEach((region: EleringRegion) => {

    describe(`Region ${region}`, () => {

      let rawData: EleringRawEntry[];
      let converted: NordpoolEntry[];

      const config    = mockConfig(region);
      const timezone  = defaultAreaTimezone(config);
      const today     = todayIn(timezone);

      // Download once per region before running assertions
      beforeAll(async () => {
        const url = `${R2_BASE_URL}/elering_${region}.json`;
        const response = await axios.get<EleringRawEntry[]>(url, { timeout: 15000 });
        rawData   = response.data;
        converted = eleringEE_convertDataStructure(rawData, config);
        convertedByRegion.set(region, converted);
      });

      // ── Raw data validation ────────────────────────────────────────────────

      it('returns HTTP 200 and a non-empty array', () => {
        console.log(`[${region}] Total raw entries: ${rawData.length}`);
        expect(Array.isArray(rawData)).toBe(true);
        expect(rawData.length).toBeGreaterThan(0);
      });

      it('every entry has a positive numeric timestamp and a numeric price', () => {
        const first = rawData[0];
        const last  = rawData[rawData.length - 1];
        console.log(`[${region}] First entry: timestamp=${first.timestamp} (${new Date(first.timestamp * 1000).toISOString()}), price=${first.price}`);
        console.log(`[${region}] Last  entry: timestamp=${last.timestamp} (${new Date(last.timestamp * 1000).toISOString()}), price=${last.price}`);
        rawData.forEach((entry, idx) => {
          expect(typeof entry.timestamp).toBe('number');
          expect(typeof entry.price).toBe('number');
          expect(entry.timestamp).toBeGreaterThan(0);
          expect(isFinite(entry.price)).toBe(true);
          if (entry.timestamp <= 0) {
            fail(`Entry ${idx} has invalid timestamp: ${entry.timestamp}`);
          }
        });
      });

      it(`contains at least 92 entries for today (${today}) in timezone ${timezone} — 15-min intervals`, () => {
        // Elering stores 15-minute interval data: 24 hours × 4 intervals = 96 entries per full day.
        // 92 = 23 complete hours minimum (handles potential DST / partial days).
        const todayEntries = rawData.filter(entry => {
          const date = DateTime.fromSeconds(entry.timestamp).setZone(timezone);
          return date.toFormat('yyyy-MM-dd') === today;
        });
        console.log(`[${region}] Raw entries for today (${today}): ${todayEntries.length}`);
        expect(todayEntries.length).toBeGreaterThanOrEqual(92);
      });

      it('timestamps are strictly increasing (sorted order)', () => {
        const span = rawData[rawData.length - 1].timestamp - rawData[0].timestamp;
        console.log(`[${region}] Timestamp span: ${(span / 3600).toFixed(1)} hours across ${rawData.length} entries`);
        for (let i = 1; i < rawData.length; i++) {
          expect(rawData[i].timestamp).toBeGreaterThan(rawData[i - 1].timestamp);
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
          // hour must be in 0-23
          expect(typeof item.hour).toBe('number');
          expect(item.hour).toBeGreaterThanOrEqual(0);
          expect(item.hour).toBeLessThanOrEqual(23);
          // price must be a finite number
          expect(typeof item.price).toBe('number');
          expect(isFinite(item.price)).toBe(true);
        });
      });

      it(`has today's (${today}) prices in the converted output (15-min granularity, ≥92 entries)`, () => {
        // eleringEE_convertDataStructure maps timestamps → {day, hour, price} but does NOT
        // deduplicate hours. Each 15-minute slot within an hour keeps its own entry.
        // Deduplication into true hourly averages is done by Functions.convertToHourlyAverages.
        const todayPrices = converted.filter(item => item.day === today);
        console.log(`[${region}] Converted entries for today (${today}): ${todayPrices.length}`);
        expect(todayPrices.length).toBeGreaterThanOrEqual(92);
      });

      it(`covers at least hours 0-22 for today (${today})`, () => {
        const hours = converted
          .filter(item => item.day === today)
          .map(item => item.hour);
        const uniqueHours = [...new Set(hours)].sort((a, b) => a - b);
        console.log(`[${region}] Unique hours found for today: ${uniqueHours.join(', ')}`);

        for (let h = 0; h <= 22; h++) {
          expect(hours).toContain(h);
        }
      });

      it('prices are in cents/kWh range (divided by 10, expect -100 to 500)', () => {
        const todayPrices = converted.filter(item => item.day === today);
        const prices = todayPrices.map(p => p.price);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const avg = (prices.reduce((s, p) => s + p, 0) / prices.length).toFixed(2);
        console.log(`[${region}] Today price range: min=${min}, max=${max}, avg=${avg} c/kWh`);
        todayPrices.forEach(item => {
          // Raw values are in (EUR/MWh * 10); after /10 they become cents/kWh.
          // Sanity-check: prices should be within a realistic range.
          expect(item.price).toBeGreaterThanOrEqual(-100);
          expect(item.price).toBeLessThanOrEqual(500);
        });
      });

      it('has exactly 4 sub-hourly entries per hour for today (15-min granularity)', () => {
        // The raw Elering API returns 15-min intervals; R2 stores them as-is.
        // After eleringEE_convertDataStructure, there should be 4 entries per hour
        // (each mapping to the same hour integer but different prices).
        const todayPrices = converted.filter(item => item.day === today);
        const byhour = new Map<number, number>();
        todayPrices.forEach(item => {
          byhour.set(item.hour, (byhour.get(item.hour) ?? 0) + 1);
        });
        console.log(`[${region}] Sub-hourly entries per hour: ${[...byhour.entries()].map(([h, c]) => `h${h}:${c}`).join(' ')}`);
        // Each populated hour should have exactly 4 entries (one per 15-min slot)
        byhour.forEach((count, hour) => {
          expect(count).toBe(4);
        });
        // And we should have all 24 hours represented
        expect(byhour.size).toBe(24);
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

  }); // ELERING_REGIONS.forEach

  // ── DST spring-forward: tomorrow must have the right number of hourly slots ──

  describe('DST spring-forward – tomorrow has the correct number of hourly price slots', () => {

    /**
     * Returns the number of local hours in a calendar day.
     * Returns 23 on a spring-forward DST day, 24 on a normal day.
     */
    function hoursInDay(dateStr: string, tz: string): number {
      const start = DateTime.fromISO(dateStr, { zone: tz });
      return Math.round(start.plus({ days: 1 }).diff(start, 'hours').hours);
    }

    ELERING_REGIONS.forEach((region: EleringRegion) => {

      const tz       = defaultAreaTimezone(mockConfig(region));
      const tomorrow = DateTime.local().setZone(tz).plus({ days: 1 }).toFormat('yyyy-MM-dd');
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

    }); // ELERING_REGIONS.forEach

  }); // describe DST

}); // describe suite
