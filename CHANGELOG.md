# Changelog

## [2.2.1] - 2026-03-17

- Improved how the plugin is tested and built behind the scenes — no changes to plugin behaviour
- Package JSON files are now automatically checked for correctness during testing

## [2.2.0] - 2025-11-25

- Added support for **Germany** and **Luxembourg** electricity prices
- Improved reliability of background data fetching and caching
- Minor log message cleanup

## [2.1.0] - 2025-09-10

- Prices for areas that provide 15-minute interval data are now correctly averaged into hourly values, giving more accurate readings

## [2.0.4] - 2025-07-01

- Baltic countries now automatically switch to a backup data source if the primary one is unavailable — more reliable price updates

## [2.0.3] - 2025-03-30

- Fixed a missing hour in price data on daylight saving time change days in spring (clocks going forward)

## [2.0.1] - 2025-03-01

- Minor fix for cache file permissions

## [2.0.0]

- Added support for **Sweden** (SE1, SE2, SE3, SE4), **Norway** (NO1–NO5), and **Denmark** (DK1, DK2) electricity prices
- Major internal rewrite for better reliability and maintainability
- Improved caching
