/**
 * Live integration tests for the OMIE API data pipeline (Spain & Portugal).
 *
 * Tests download real hourly price data from the OMIE public API for each
 * supported region (ES, PT) and validate both the raw CSV response and the
 * converted output produced by omie_convertDataStructure.
 * Requires internet access.
 */

import axios from 'axios';
import { DateTime } from 'luxon';
import { omie_convertDataStructure } from './funcs_OMIE';
import { defaultAreaTimezone } from './settings';

// ──────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────

/** Regions served by the OMIE API */
const OMIE_REGIONS = ['ES', 'PT'] as const;
type OmieRegion = typeof OMIE_REGIONS[number];

/** Raw parsed row from the OMIE CSV */
interface OmieRow {
  year: number;
  month: number;
  day: number;
  quarter: number; // 1-indexed 15-min slot (1–96 for a 24-hour day)
  esPrice: number; // EUR/MWh
  ptPrice: number; // EUR/MWh
}

/** Converted shape produced by omie_convertDataStructure */
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

const OMIE_MARKET_TIMEZONE = 'Europe/Madrid';

function mockConfig(area: OmieRegion) {
  return { area, decimalPrecision: 2 } as never;
}

function omieUrl(date: DateTime): string {
  return `https://www.omie.es/es/file-download?parents=marginalpdbcpt&filename=marginalpdbcpt_${date.toFormat('yyyyMMdd')}.1`;
}

function parseOmieCsv(csv: string): OmieRow[] {
  const rows: OmieRow[] = [];
  for (const line of csv.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '*' || trimmed.startsWith('MARGINAL')) continue;
    const parts = trimmed.split(';').map(p => p.trim()).filter(p => p);
    if (parts.length < 6) continue;
    const [y, m, d, q, es, pt] = parts.map(Number);
    if ([y, m, d, q, es, pt].some(isNaN)) continue;
    rows.push({ year: y, month: m, day: d, quarter: q, esPrice: es, ptPrice: pt });
  }
  return rows;
}

/** Today expressed in the OMIE market timezone (CET) */
function todayInMarketTz(): DateTime {
  return DateTime.now().setZone(OMIE_MARKET_TIMEZONE);
}

/** Today expressed in the given area's local timezone */
function todayForRegion(area: OmieRegion): string {
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

describe('OMIE API – live data tests', () => {
  /** Stores converted output per region so the suite-level DST section can access it. */
  const convertedByRegion = new Map<OmieRegion, NordpoolEntry[]>();
  // ── Shared raw CSV tests (fetched once, shared across ES & PT) ──────────────

  describe('Raw CSV – today\'s OMIE file', () => {

    let rawCsv: string;
    let rows: OmieRow[];
    const today = todayInMarketTz();

    beforeAll(async () => {
      const url = omieUrl(today);
      const response = await axios.get<string>(url, { timeout: 15000, responseType: 'text' });
      rawCsv = response.data;
      rows = parseOmieCsv(rawCsv);
    });

    it('returns HTTP 200 and non-empty text', () => {
      expect(typeof rawCsv).toBe('string');
      expect(rawCsv.length).toBeGreaterThan(0);
      console.log(`[OMIE raw] CSV size: ${rawCsv.length} chars, rows parsed: ${rows.length}`);
    });

    it('starts with MARGINALPDBCPT header', () => {
      expect(rawCsv.trim().startsWith('MARGINALPDBCPT')).toBe(true);
    });

    it('has at least 92 data rows (23 h × 4 quarters — handles DST)', () => {
      console.log(`[OMIE raw] Total rows: ${rows.length}`);
      expect(rows.length).toBeGreaterThanOrEqual(92);
    });

    it('all rows carry the same date as the requested file date', () => {
      const dateStr = today.toFormat('yyyy-MM-dd');
      rows.forEach(row => {
        const rowDate = `${row.year}-${String(row.month).padStart(2, '0')}-${String(row.day).padStart(2, '0')}`;
        expect(rowDate).toBe(dateStr);
      });
    });

    it('quarter indices are strictly increasing from 1', () => {
      rows.forEach((row, i) => {
        expect(row.quarter).toBe(i + 1);
      });
    });

    it('each slot spans exactly 15 minutes (quarter step of 1)', () => {
      // Verified implicitly by quarter indices being 1, 2, 3, … with no gaps.
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].quarter - rows[i - 1].quarter).toBe(1);
      }
    });

    it('Spain and Portugal prices are finite numbers', () => {
      rows.forEach(row => {
        expect(isFinite(row.esPrice)).toBe(true);
        expect(isFinite(row.ptPrice)).toBe(true);
      });
    });

    it('prices are in a plausible EUR/MWh range (-500 to 4000)', () => {
      const esPrices = rows.map(r => r.esPrice);
      const ptPrices = rows.map(r => r.ptPrice);
      const min = Math.min(...esPrices, ...ptPrices);
      const max = Math.max(...esPrices, ...ptPrices);
      console.log(`[OMIE raw] Price range: min=${min} max=${max} EUR/MWh`);
      rows.forEach(row => {
        expect(row.esPrice).toBeGreaterThanOrEqual(-500);
        expect(row.esPrice).toBeLessThanOrEqual(4000);
        expect(row.ptPrice).toBeGreaterThanOrEqual(-500);
        expect(row.ptPrice).toBeLessThanOrEqual(4000);
      });
    });

  });

  // ── Per-region converted data tests ────────────────────────────────────────

  OMIE_REGIONS.forEach((region: OmieRegion) => {

    describe(`Region ${region}`, () => {

      let rawCsv: string;
      let converted: NordpoolEntry[];

      const config      = mockConfig(region);
      const today       = todayForRegion(region);
      const tz          = defaultAreaTimezone(config);
      const isDstToday  = hoursInDay(today, tz) === 23;
      const missingHour = dstMissingHour(today, tz);

      beforeAll(async () => {
        // Fetch CET files: yesterday, today, tomorrow, and day-after-tomorrow.
        //
        // Portugal (Europe/Lisbon, WET→WEST) is 1 hour behind CET, so:
        //   - CET yesterday covers PT hour 23 of the day before today.
        //   - CET today     covers PT hours 0–22 of today (PT hour 23 is in CET tomorrow).
        //   - CET tomorrow  covers PT hours 0–22 of tomorrow (PT hour 23 is in CET day+2).
        //   - CET day+2     covers PT hour 23 of tomorrow.
        //
        // Including all four files ensures complete 23-/24-hour coverage for both today
        // and tomorrow in both the ES and PT local timezones, including on DST days.
        const todayCet   = todayInMarketTz();
        const [r0, r1, r2, r3] = await Promise.all([
          axios.get<string>(omieUrl(todayCet.minus({ days: 1 })), { timeout: 15000, responseType: 'text' }).catch(() => null),
          axios.get<string>(omieUrl(todayCet),                    { timeout: 15000, responseType: 'text' }),
          axios.get<string>(omieUrl(todayCet.plus({ days: 1 })),  { timeout: 15000, responseType: 'text' }).catch(() => null),
          axios.get<string>(omieUrl(todayCet.plus({ days: 2 })),  { timeout: 15000, responseType: 'text' }).catch(() => null),
        ]);
        rawCsv = r1.data;
        const combinedCsv = [r0?.data, rawCsv, r2?.data, r3?.data].filter(Boolean).join('\n');
        converted = omie_convertDataStructure(combinedCsv, region, config);
        convertedByRegion.set(region, converted);
        console.log(`[${region}] Total converted entries: ${converted.length}, days: ${[...new Set(converted.map(e => e.day))].sort().join(', ')}`);
      });

      it('converts to a non-empty NordpoolEntry array', () => {
        expect(Array.isArray(converted)).toBe(true);
        expect(converted.length).toBeGreaterThan(0);
      });

      it('every converted entry has correct shape (day YYYY-MM-DD, hour 0-23, finite price)', () => {
        converted.forEach(item => {
          expect(item.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(item.hour).toBeGreaterThanOrEqual(0);
          expect(item.hour).toBeLessThanOrEqual(23);
          expect(typeof item.price).toBe('number');
          expect(isFinite(item.price)).toBe(true);
        });
      });

      it(`has today's (${today}) prices in the converted output (≥ 92 entries)`, () => {
        const todayPrices = converted.filter(item => item.day === today);
        console.log(`[${region}] Converted entries for today (${today}): ${todayPrices.length}`);
        // PT on a DST day loses hour 1 (clock skipped) and potentially hour 23 (CET day+2 file
        // may not be published yet), giving 22 × 4 = 88 entries minimum.
        // ES on a DST day has 23 × 4 = 92 entries (hour 2 skipped, but no cross-day dependency).
        const minEntries = (region === 'PT' && isDstToday) ? 88 : 92;
        expect(todayPrices.length).toBeGreaterThanOrEqual(minEntries);
      });

      it(`covers at least hours 0–22 for today (${today})`, () => {
        const hours = [...new Set(
          converted.filter(item => item.day === today).map(item => item.hour),
        )].sort((a, b) => a - b);
        console.log(`[${region}] Unique hours for today: ${hours.join(', ')}`);
        for (let h = 0; h <= 22; h++) {
          if (h === missingHour) continue; // On DST spring-forward day this hour does not exist
          expect(hours).toContain(h);
        }
      });

      it('has exactly 4 sub-hourly entries per hour for today (15-min granularity)', () => {
        const todayPrices = converted.filter(item => item.day === today);
        const byHour = new Map<number, number>();
        todayPrices.forEach(item => {
          byHour.set(item.hour, (byHour.get(item.hour) ?? 0) + 1);
        });
        console.log(`[${region}] Sub-hourly counts per hour: ${[...byHour.entries()].map(([h, c]) => `h${h}:${c}`).join(' ')}`);
        byHour.forEach((count) => {
          expect(count).toBe(4);
        });
      });

      it('prices are in cents/kWh range (EUR/MWh ÷ 10 → expect -50 to 400)', () => {
        const todayPrices = converted.filter(item => item.day === today);
        const prices = todayPrices.map(p => p.price);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const avg = (prices.reduce((s, p) => s + p, 0) / prices.length).toFixed(2);
        console.log(`[${region}] Today price range: min=${min}, max=${max}, avg=${avg} c/kWh`);
        todayPrices.forEach(item => {
          expect(item.price).toBeGreaterThanOrEqual(-50);
          expect(item.price).toBeLessThanOrEqual(400);
        });
      });

      it('decimal precision is applied (max 2 decimal places)', () => {
        converted.forEach(item => {
          const decimalPart = String(item.price).split('.')[1];
          const decimals = decimalPart ? decimalPart.length : 0;
          expect(decimals).toBeLessThanOrEqual(2);
        });
      });

    }); // describe region

  }); // OMIE_REGIONS.forEach

  // ── DST spring-forward: tomorrow must have the right number of hourly slots ──

  describe('DST spring-forward – tomorrow has the correct number of hourly price slots', () => {

    OMIE_REGIONS.forEach((region: OmieRegion) => {

      const tz             = defaultAreaTimezone({ area: region } as never);
      const tomorrow       = DateTime.now().setZone(tz).plus({ days: 1 }).toFormat('yyyy-MM-dd');
      const isDstDay       = hoursInDay(tomorrow, tz) === 23;
      // Only activate this test on the eve of a DST spring-forward day.
      const testFn         = isDstDay ? it : it.skip;

      testFn(`[${region}] tomorrow (${tomorrow}) has exactly 23 hourly price slots on DST spring-forward day`, () => {
        const tomorrowEntries = (convertedByRegion.get(region) ?? []).filter(e => e.day === tomorrow);
        const uniqueHours     = new Set(tomorrowEntries.map(e => e.hour));

        console.log(
          `[${region}] Tomorrow ${tomorrow}: ${uniqueHours.size} unique hours (DST spring-forward ⏰)`
        );

        expect(uniqueHours.size).toBe(23);
      });

    }); // OMIE_REGIONS.forEach

  }); // describe DST

}); // describe suite
