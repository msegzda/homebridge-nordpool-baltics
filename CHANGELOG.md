# Changelog

## [2.2.1] - 2026-03-17

- Improved how the plugin is tested and built behind the scenes — no changes to plugin behaviour
- Package JSON files are now automatically checked for correctness during testing

## [2.2.0] - 2025-11-25

- Added support for **Germany** and **Luxembourg** electricity prices
- Minor internal fixes and stability improvements

## [2.1.0] - 2025-09-10

- Prices are now correctly averaged from 15-minute data intervals into hourly values for areas that provide sub-hourly data

## [2.0.4] - 2025-07-01

- Baltic countries now automatically switch to a backup data source if the primary one is unavailable

## [2.0.3] - 2025-03-30

- Fixed a missing hour in price data on daylight saving time (DST) change days in spring

## [2.0.1] - 2025-03-01

- Minor fix

## [2.0.0]

- Major rewrite with support for more countries and areas
- Added Sweden, Norway, Denmark, Finland price areas
- Improved reliability and caching
