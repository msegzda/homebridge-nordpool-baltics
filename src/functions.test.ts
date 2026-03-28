/**
 * Unit tests for the Functions class helper methods.
 *
 * Methods under test run on a minimal proxy created via Object.create, so the
 * full Homebridge platform does not need to be bootstrapped.  Only the members
 * actually used by each method are stubbed.
 */

import { Functions } from './functions';
import { NordpoolData } from './settings';

// ──────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────

/**
 * Creates a minimal Functions proxy for unit-testing methods that only use
 * this.platform.log.*. All log calls are captured via jest.fn() mocks.
 */
function makeFunctions(): Functions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fnc: any = Object.create(Functions.prototype);
  fnc.platform = {
    log: {
      warn:  jest.fn(),
      debug: jest.fn(),
      info:  jest.fn(),
      error: jest.fn(),
    },
  };
  return fnc as Functions;
}

/** Builds a complete 24-hour NordpoolData array (prices 1-24 c/kWh). */
function makeFullDay(day: string): NordpoolData[] {
  return Array.from({ length: 24 }, (_, h) => ({ day, hour: h, price: h + 1 }));
}

/**
 * Builds a 23-hour NordpoolData array simulating DST spring-forward where
 * `missingHour` local slot is absent.
 *
 * Typical values: CET → 2, EET → 3, WET (Portugal) → 1
 */
function makeDstDay(day: string, missingHour: number): NordpoolData[] {
  return makeFullDay(day).filter(e => e.hour !== missingHour);
}

// ──────────────────────────────────────────────────
// fillMissingHours
// ──────────────────────────────────────────────────

describe('Functions – fillMissingHours', () => {

  it('returns a 24-hour array unchanged (no DST transition)', () => {
    const fnc = makeFunctions();
    const data = makeFullDay('2026-03-28');
    const result = fnc.fillMissingHours(data, '2026-03-28');
    expect(result).toHaveLength(24);
    expect(result.map(e => e.hour).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 24 }, (_, i) => i));
  });

  it('returns a 25-hour array unchanged (DST fall-back — clock goes back, no padding needed)', () => {
    const fnc = makeFunctions();
    // 25th entry simulates the repeated hour when clocks fall back
    const data = [...makeFullDay('2026-10-25'), { day: '2026-10-25', hour: 2, price: 99 }];
    expect(fnc.fillMissingHours(data, '2026-10-25')).toHaveLength(25);
  });

  it('fills missing hour 2 – CET spring-forward (AT/DE/LU/ES/SE/DK/NO, clocks jump 02:00→03:00)', () => {
    const fnc = makeFunctions();
    // Hours present: 0, 1, 3, 4 … 23 — hour 2 (02:00–03:00 CET) is absent
    const data = makeDstDay('2026-03-29', 2);
    expect(data).toHaveLength(23);

    const result = fnc.fillMissingHours(data, '2026-03-29');

    expect(result).toHaveLength(24);
    expect(result.map(e => e.hour).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 24 }, (_, i) => i));

    // The synthetic hour 2 must be a clone of hour 1 (the predecessor)
    const h1 = result.find(e => e.hour === 1)!;
    const h2 = result.find(e => e.hour === 2)!;
    expect(h2.price).toBe(h1.price);
    expect(h2.day).toBe('2026-03-29');
  });

  it('fills missing hour 3 – EET spring-forward (EE/LT/LV/FI, clocks jump 03:00→04:00)', () => {
    const fnc = makeFunctions();
    // Hours present: 0, 1, 2, 4, 5 … 23 — hour 3 (03:00–04:00 EET) is absent
    const data = makeDstDay('2026-03-29', 3);
    expect(data).toHaveLength(23);

    const result = fnc.fillMissingHours(data, '2026-03-29');

    expect(result).toHaveLength(24);
    expect(result.map(e => e.hour).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 24 }, (_, i) => i));

    // The synthetic hour 3 must be a clone of hour 2 (the predecessor)
    const h2 = result.find(e => e.hour === 2)!;
    const h3 = result.find(e => e.hour === 3)!;
    expect(h3.price).toBe(h2.price);
    expect(h3.day).toBe('2026-03-29');
  });

  it('fills missing hour 1 – WET spring-forward (PT/Lisbon, clocks jump 01:00→02:00)', () => {
    const fnc = makeFunctions();
    // Hours present: 0, 2, 3 … 23 — hour 1 (01:00–02:00 WET) is absent
    const data = makeDstDay('2026-03-29', 1);
    expect(data).toHaveLength(23);

    const result = fnc.fillMissingHours(data, '2026-03-29');

    expect(result).toHaveLength(24);
    expect(result.map(e => e.hour).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 24 }, (_, i) => i));

    // The synthetic hour 1 must be a clone of hour 0 (the predecessor)
    const h0 = result.find(e => e.hour === 0)!;
    const h1 = result.find(e => e.hour === 1)!;
    expect(h1.price).toBe(h0.price);
    expect(h1.day).toBe('2026-03-29');
  });

  it('emits a warning log that includes the added hour number', () => {
    const fnc = makeFunctions();
    fnc.fillMissingHours(makeDstDay('2026-03-29', 3), '2026-03-29');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logWarn: jest.Mock = (fnc as any).platform.log.warn;
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('3'));
  });

});
