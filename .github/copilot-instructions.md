## Purpose

Quick, focused guidance for AI coding agents working on this Homebridge plugin repository.
Follow these repository-specific rules to be productive immediately.

## Big picture

- **Plugin type:** Homebridge platform plugin. Entry point: `src/index.ts` which registers the platform class `NordpoolPlatform`.
- **Runtime flow:** `src/platform.ts` discovers/registers accessories -> `src/platformAccessory.ts` initializes services and schedules hourly price fetches -> `src/functions.ts` pulls and processes Nordpool data and updates virtual accessories.
- **Data providers:** on files `src/funcs_*.ts`. If provider returns 15-minute interval prices, they are converted to hourly averages in `Functions.pullNordpoolData()`.

## Key files to inspect

- Core: [src/index.ts](../src/index.ts), [src/platform.ts](../src/platform.ts), [src/platformAccessory.ts](../src/platformAccessory.ts), [src/functions.ts](../src/functions.ts)
- Config/constants: `src/settings.ts`,`config.schema.json`
- Dev & publish scripts: `package.json`

## Important patterns & domain rules

- The plugin caches daily prices using `file-system-cache` via helpers in `settings.ts`. Cache keys include `fnc_todayKey`, `fnc_tomorrowKey`, and flags like `5consecutiveUpdated` and `solarOverrideApplied_<day>`.
- Pricing arrays may be length 23/24/25 due to DST handling; code explicitly checks these lengths when computing current hour and cheapest/priciest hours.
- The plugin computes hourly averages from 15-minute intervals — preserve that conversion logic when modifying nordpool data fetchers.
- Cron schedule: hourly fetch runs are scheduled with `node-cron` in `platformAccessory.ts` using `schedule('0 * * * *', ...)`. Avoid duplicating fetch intervals elsewhere.
- Timezone: `Functions.checkSystemTimezone()` compares system timezone to area timezone. Any change in time mapping logic must respect `defaultAreaTimezone` in `settings.ts`.
- Solar override logic: `Functions.applySolarOverride()` overrides prices to 0 for configured hours (March-September). Tests or changes affecting dates/hours should account for `latitude` and `solarOffsetMinutes` calculation.

## Dev / build / test workflows

- Build: `npm run build` (outputs into `dist/`, `main` points to `dist/index.js`).
- Deploylocal (deploy to local Homebridge): `npm run deploylocal`
- Dev homebridge logs tail: `hb-service logs -f`
- Tests & lint: `npm test` runs `jest` and markdown lint; `npm run lint` runs `eslint` on `src/**.ts`.
- Publishing: `npm publish` triggers `prepublishOnly` (`lint` + `build`) and `postpublish` runs `scripts/deprecate-old-versions.mjs`.
- Node & Homebridge versions: see `package.json` `engines` for supported Node/homebridge ranges — match these when running dev or CI.

## Coding & review conventions

- Use Homebridge APIs as shown: register platforms in `src/index.ts`, update accessories via `api.updatePlatformAccessories`, and unregister via `api.unregisterPlatformAccessories` when necessary.
- Logging: prefer `this.platform.log.debug/info/warn/error` consistent with surrounding code.
- Configuration-driven behavior: many features are toggled via `platform.config` (e.g., `currentHour`, `cheapest5HoursConsec`, `dynamicCheapestConsecutiveHours`, `solarOverride`). Check `config.schema.json` before changing defaults.
- Precision & cache invalidation: `decimalPrecision` and `area` changes clear cached day/tomorrow price keys; update cache removal logic when altering cache layout.

## Elering data pipeline

Full architecture details (Cloudflare Worker, Homebridge provider, live tests) are in [.github/elering-pipeline.md](elering-pipeline.md). Read it before touching `nordpool-cf/`, `src/funcs_Elering.ts`, or `src/elering.test.ts`.

## OMIE data provider (Spain & Portugal)

`src/funcs_OMIE.ts` fetches daily CSV files from the OMIE public API (Iberian electricity market operator — no API key required). Data is published in CET (Europe/Madrid). Portugal uses Europe/Lisbon (1 hour behind CET), so both today and tomorrow CET files are fetched to cover a full Portuguese local day. Prices are in EUR/MWh and converted to cents/kWh by dividing by 10. Live tests are in `src/omie.test.ts`.

## Where to add tests

- Unit tests for data processing in `src/functions.ts` (e.g. `convertToHourlyAverages`, `getCheapestConsecutiveHours`): use Jest with mocked provider responses.
- Live integration tests for data providers: follow the pattern in `src/elering.test.ts` and name files `src/<provider>.test.ts`.
- Never include tests files into plugin deployment prod package and run any tests on production installations. Tests should only run in dev environments and CI.

## Small checklist to always follow

- Verify timezone-sensitive changes using `Functions.checkSystemTimezone()` and test DST edge cases (23/25 hour days).
- If modifying price conversion, keep the 15→60 minute averaging step in `Functions.pullNordpoolData()`.
- Preserve existing cache keys and semantics unless intentionally migrating cache format
- Never hallucinate. Make sure any solutions are based on the code and context provided and based on trustworthy internet resources.
- Always provide reliable solutions that work as expected.
- When suggesting code, ensure it follows the existing coding style and conventions used in the repository.
- Make sure code is compiling after any agentic updates.
- If new countries are added make sure edits are minimally invasive and these countries are noted in the README.md and plugin description.
- **Before creating a git tag for a release, always update `package.json` `version` to match the tag version.** The npm package is published from `package.json` — version mismatch means a wrong version gets published.
- **Always add a new entry to `CHANGELOG.md` for every release.** Use plain, human-friendly language — no jargon or technical commit details. Homebridge displays this file to users when they update the plugin.

## Release process (follow every step in order)

When asked to create a release or new version, do ALL of the following:

1. **Update `package.json` `version`** to match specified new version number. If version number is not specified in the prompt or request, ask user if they want to increment the patch version (e.g. 1.2.3 → 1.2.4) following semantic versioning rules.
2. **Update `CHANGELOG.md`** — add a new entry at the top for the new version. Use plain language a non-technical user can understand. Lead with new features and supported countries/regions. Keep internal/CI changes brief at the bottom. No commit hashes, no technical jargon.
3. **Commit** both files together with a short descriptive commit message.
4. **Create an annotated git tag** for the new version. Tag is matching new version number (e.g. `v1.2.4`) and tag message is the same as the `CHANGELOG.md` entry for that version.
5. **Push** commits and the tag to origin.
6. **Create a GitHub Release** using `gh release create <tag>` with a user-friendly title and release notes. Use `gh` CLI (install via `brew install gh` if missing). Release notes must: lead with new features/countries in bold, be written in plain language, and omit internal/CI details unless they affect users.

### Release notes writing rules

- Lead with the most valuable user-facing changes (new countries, new features, bug fixes that affect behaviour).
- Use **bold** for new country or feature names.
- Word electricity or anything related to it should be decorated with ⚡️ character when logical.
- Do not copy commit messages — rewrite for a non-technical audience. Do not mention provider or API name, authorisation to it whatsoever.
- Keep it short: ±6 bullet points maximum.
- Internal work (CI, tests, tooling) goes last and only if worth mentioning at all.
