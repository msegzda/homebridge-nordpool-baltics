# Elering data pipeline — end-to-end architecture

## 1. Cloudflare Worker (`nordpool-cf`)

- **Location:** `nordpool-cf/src/worker.js`; deploy with `npm run deploy --prefix nordpool-cf`.
- **Purpose:** Caching proxy. Fetches raw price data from `https://dashboard.elering.ee/api/nps/price` and writes it to a Cloudflare R2 bucket, one file per region.
- **Schedule:** Cloudflare Cron `0 3,15 * * *` (UTC 03:00 and 15:00) — configured in `nordpool-cf/wrangler.jsonc`.
- **Date range fetched:** yesterday 20:00 UTC → day-after-tomorrow 02:00 UTC (covers today + tomorrow across all area timezones).
- **R2 output files:** `elering_EE.json`, `elering_LT.json`, `elering_LV.json`, `elering_FI.json` — uppercase region, flat array, no nesting.
- **Data format:** `{ timestamp: number (Unix seconds), price: number }[]`, one entry per **15-minute** interval, sorted ascending.
- **Public URL:** `https://pub-460c981173fb4262a268d6f273d18dd2.r2.dev/elering_<REGION>.json` (R2 public bucket — no custom domain as of v2.2.0).
- **HTTP fetch handler:** always returns `405` — the Worker is not a REST API; files are accessed directly via R2.

## 2. Homebridge Elering provider (`src/funcs_Elering.ts`)

- **Entry point:** `eleringEE_getNordpoolData(log, config)` — provider 1 for areas `EE`, `LT`, `LV`, `FI` in `Functions.pullNordpoolData()`.
- **URL:** `` `https://pub-460c981173fb4262a268d6f273d18dd2.r2.dev/elering_${config.area.toUpperCase()}.json` `` — R2 is case-sensitive; must match Worker filename exactly.
- **`eleringEE_convertDataStructure(data, config)`:** maps each raw entry to `{ day, hour, price }`:
  - `timestamp * 1000` → `Date` → `DateTime.setZone(defaultAreaTimezone(config))`.
  - `price / 10` → cents/kWh, rounded to `config.decimalPrecision`.
  - Outputs **4 entries per hour** (15-min granularity preserved). Averaging into true hourly values is done downstream by `Functions.convertToHourlyAverages()`.
- **Fallback chain in `pullNordpoolData()`:**
  1. `eleringEE_getNordpoolData` — EE/LT/LV/FI
  2. `awattar_getNordpoolData` — DE/LU/AT
  3. `spothinta_getNordpoolData` — all areas (last resort)
- `convertToHourlyAverages` is **always** called after any provider returns data.

## 3. Live integration tests (`src/elering.test.ts`)

- **Framework:** Jest + ts-jest. File must be named `*.test.ts` (not `*.tests.ts`) to be auto-discovered.
- **Excluded from build:** `tsconfig.json` has `"**/*.test.ts"` in `exclude` — never lands in `dist/`.
- **Excluded from Jest dist scan:** `package.json` jest config has `testPathIgnorePatterns: ["/node_modules/", "/dist/"]`.
- **Per-region assertions (EE, LT, LV, FI):**
  - HTTP 200, non-empty array.
  - Every raw entry: `timestamp > 0`, `price` is finite.
  - ≥ 92 raw entries for today in the correct area timezone (96 = full day × 4 intervals/hour; 92 = DST/partial-day margin).
  - Timestamps strictly ascending.
  - Converted shape: `{ day: YYYY-MM-DD, hour: 0–23, price: number }`.
  - Today's hours 0–22 all present.
  - Prices in range −100 to 500 c/kWh.
  - Exactly 4 sub-hourly entries per hour.
  - Decimal precision ≤ 2 places.
- **Timeout:** 30 s per test (live network). Run with `npm test`.
- **Update tests when:** R2 URL or filename pattern changes, data format changes (e.g. 15-min → hourly), or default `decimalPrecision` changes.
