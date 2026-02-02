## Purpose
Quick, focused guidance for AI coding agents working on this Homebridge plugin repository.
Follow these repository-specific rules to be productive immediately.

## Big picture
- **Plugin type:** Homebridge platform plugin. Entry point: `src/index.ts` which registers the platform class `NordpoolPlatform`.
- **Runtime flow:** `src/platform.ts` discovers/registers accessories -> `src/platformAccessory.ts` initializes services and schedules hourly price fetches -> `src/functions.ts` pulls and processes Nordpool data and updates virtual accessories.
- **Data providers:** `src/funcs_Elering.ts` and `src/funcs_SpotHinta.ts` implement external API fetches. Prices are converted to hourly averages in `Functions.pullNordpoolData()`.

## Key files to inspect
- Core: [src/index.ts](../src/index.ts), [src/platform.ts](../src/platform.ts), [src/platformAccessory.ts](../src/platformAccessory.ts), [src/functions.ts](../src/functions.ts)
- Nordpool data providers: [src/funcs_Elering.ts](../src/funcs_Elering.ts), [src/funcs_SpotHinta.ts](../src/funcs_SpotHinta.ts)
- Config/constants: [src/settings.ts](../src/settings.ts), [config.schema.json](../config.schema.json)
- Dev & publish scripts: [package.json](../package.json)

## Important patterns & domain rules
- The plugin caches daily prices using `file-system-cache` via helpers in `settings.ts`. Cache keys include `fnc_todayKey`, `fnc_tomorrowKey`, and flags like `5consecutiveUpdated` and `solarOverrideApplied_<day>`.
- Pricing arrays may be length 23/24/25 due to DST handling; code explicitly checks these lengths when computing current hour and cheapest/priciest hours.
- The plugin computes hourly averages from 15-minute intervals — preserve that conversion logic when modifying nordpool data fetchers.
- Cron schedule: hourly fetch runs are scheduled with `node-cron` in `platformAccessory.ts` using `schedule('0 * * * *', ...)`. Avoid duplicating fetch intervals elsewhere.
- Timezone: `Functions.checkSystemTimezone()` compares system timezone to area timezone. Any change in time mapping logic must respect `defaultAreaTimezone` in `settings.ts`.
- Solar override logic: `Functions.applySolarOverride()` overrides prices to 0 for configured hours (March-September). Tests or changes affecting dates/hours should account for `latitude` and `solarOffsetMinutes` calculation.

## Dev / build / test workflows
- Build: `npm run build` (outputs into `dist/`, `main` points to `dist/index.js`).
- Dev (local linked Homebridge): `npm run build && npm link && sudo hb-service restart`
- Dev homebridge logs tail: `hb-service logs -f`
- Tests & lint: `npm test` runs `jest` and markdown lint; `npm run lint` runs `eslint` on `src/**.ts`.
- Publishing: `npm publish` triggers `prepublishOnly` (`lint` + `build`) and `postpublish` runs `src/deprecate-old-versions.mjs`.
- Node & Homebridge versions: see `package.json` `engines` for supported Node/homebridge ranges — match these when running dev or CI.

## Coding & review conventions
- Use Homebridge APIs as shown: register platforms in `src/index.ts`, update accessories via `api.updatePlatformAccessories`, and unregister via `api.unregisterPlatformAccessories` when necessary.
- Logging: prefer `this.platform.log.debug/info/warn/error` consistent with surrounding code.
- Configuration-driven behavior: many features are toggled via `platform.config` (e.g., `currentHour`, `cheapest5HoursConsec`, `dynamicCheapestConsecutiveHours`, `solarOverride`). Check `config.schema.json` before changing defaults.
- Precision & cache invalidation: `decimalPrecision` and `area` changes clear cached day/tomorrow price keys; update cache removal logic when altering cache layout.

## Where to add tests
- Unit-test data processing in `src/functions.ts` (e.g., `convertToHourlyAverages`, `getCheapestConsecutiveHours`, median & priciest logic). Use `jest` and mock provider responses from `funcs_Elering`/`funcs_SpotHinta`.

## Small checklist to always follow
- Verify timezone-sensitive changes using `Functions.checkSystemTimezone()` and test DST edge cases (23/25 hour days).
- If modifying price conversion, keep the 15→60 minute averaging step in `Functions.pullNordpoolData()`.
- Preserve existing cache keys and semantics unless intentionally migrating cache format
- Never hallucinate. Make sure any solutions are based on the code and context provided and based on trustworthy internet resources.
- Always provide reliable solutions that work as expected.
- When suggesting code, ensure it follows the existing coding style and conventions used in the repository.
