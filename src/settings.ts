import { Service, API, Logging, PlatformConfig } from 'homebridge';
import * as Path from 'path';
import * as fs from 'fs';
import { DateTime } from 'luxon';
import { Cache } from 'file-system-cache';

/* eslint @typescript-eslint/no-var-requires: "off" */
const pkg = require('../package.json');

export const PLATFORM_NAME = 'Nordpool';
export const PLUGIN_NAME = pkg.name;
export const PLATFORM_MANUFACTURER = pkg.author.name;
export const PLATFORM_VERSION = pkg.version;
export const PLATFORM_MODEL = 'Electricity price sensors';
export const PLATFORM_SERIAL_NUMBER = 'UN783GU921Y0';

// main device(s)
export const devices = [
  {
    UniqueId: 'JKGhJH654*87pDE',
    displayName: 'Nordpool',
  },
];

export interface SensorType { [key: string]: Service | null }

export interface NordpoolData {
    day: string;
    hour: number;
    price: number;
  }

export interface Pricing {
    today: NordpoolData[];
    currently: number;
    currentHour: number;
    cheapestHour: number[];
    cheapest4Hours: number[];
    cheapest5Hours: number[];
    cheapest5HoursConsec: number[];
    cheapest5HoursConsec2days: number[];
    cheapest6Hours: number[];
    cheapest7Hours: number[];
    cheapest8Hours: number[];
    cheapest9Hours: number[];
    cheapest10Hours: number[];
    cheapest11Hours: number[];
    cheapest12Hours: number[];
    priciestHour: number[];
    median: number;
    median2days: number;
  }

export let pricing: Pricing = {
  today: [],
  currently: 0.0001,
  currentHour: 0,
  cheapestHour: [],
  cheapest4Hours: [],
  cheapest5Hours: [],
  cheapest5HoursConsec: [],
  cheapest5HoursConsec2days: [],
  cheapest6Hours: [],
  cheapest7Hours: [],
  cheapest8Hours: [],
  cheapest9Hours: [],
  cheapest10Hours: [],
  cheapest11Hours: [],
  cheapest12Hours: [],
  priciestHour: [],
  median: 0,
  median2days: 0,
};

export const defaultService: SensorType = {
  currently: null,
  cheapestHour: null,
  cheapest4Hours: null,
  cheapest5Hours: null,
  cheapest5HoursConsec: null,
  cheapest6Hours: null,
  cheapest7Hours: null,
  cheapest8Hours: null,
  cheapest9Hours: null,
  cheapest10Hours: null,
  cheapest11Hours: null,
  cheapest12Hours: null,
  priciestHour: null,
  hourlyTickerSwitch: null,
};

export function defaultPricesCache(api: API, log: Logging) {
  const ns = 'homebridge-nordpool-baltics';
  const nsHash = 'b162cf22c8adb8fa829628b261839cad18dc3994';

  const storagePath = api.user.storagePath();
  const cacheDirectory = Path.join(storagePath, '.cache');
  const fallbackDirectory = storagePath; // Fallback to root storage path
  let finalCacheDirectory = cacheDirectory;

  try {
    // Ensure .cache directory exists
    if (!fs.existsSync(cacheDirectory)) {
      fs.mkdirSync(cacheDirectory, { recursive: true });
      log.debug(`OK: Cache directory created at ${cacheDirectory}`);
    }
    // Check if directory is writable
    fs.accessSync(cacheDirectory, fs.constants.W_OK);
  } catch (error) {
    // If .cache directory creation or access fails, fall back to root storage path
    log.warn(`Failed to access or create cache directory at ${cacheDirectory}: ${
      error instanceof Error ? error.message : 'Unknown error'
    }`);
    log.warn(`Falling back to root storage path: ${fallbackDirectory}`);
    finalCacheDirectory = fallbackDirectory;
  }

  // Auto-cleanup of old cached files on init
  const files = fs.readdirSync(finalCacheDirectory);
  const now = Date.now();
  files.filter(file => file.startsWith(`${nsHash}-`)).forEach(file => {
    const filePath = Path.join(finalCacheDirectory, file);
    try {
      const stats = fs.statSync(filePath);
      const fileAge = now - stats.mtimeMs;
      // If the file is older than 2 days, clean up
      if (fileAge >= 172800 * 1000 * 2) {
        fs.unlinkSync(filePath);
        log.debug(`OK: Deleted old cache file: ${filePath}`);
        return;
      }
      // Check if file is valid JSON
      const content = fs.readFileSync(filePath, 'utf8');
      JSON.parse(content);
    } catch (error) {
      if (error instanceof SyntaxError) {
        log.warn(`Corrupted cache file detected and removed: ${filePath}`);
        try {
          fs.unlinkSync(filePath);
        } catch (unlinkError) {
          log.error(`Failed to delete corrupted cache file: ${filePath}`);
        }
      } else {
        log.warn(
          `Failed to access file stats or delete file: ${filePath}. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }
  });

  return new Cache({ basePath: finalCacheDirectory, ns: ns, ttl: 172800 });
}

// Dynamically determine the timezone based on the configured area
export function defaultAreaTimezone(config: PlatformConfig): string {
  const area = config.area?.toUpperCase();

  // Define timezone mappings for supported areas
  const timezoneMapping: { [key: string]: string } = {
    LT: 'Europe/Vilnius', // Lithuania
    LV: 'Europe/Riga',    // Latvia
    EE: 'Europe/Tallinn', // Estonia
    FI: 'Europe/Helsinki', // Finland
    SE1: 'Europe/Stockholm', // Sweden
    SE2: 'Europe/Stockholm', // Sweden
    SE3: 'Europe/Stockholm', // Sweden
    SE4: 'Europe/Stockholm', // Sweden
    DK1: 'Europe/Copenhagen', // Denmark DK1
    DK2: 'Europe/Copenhagen', // Denmark DK2
    NO1: 'Europe/Oslo',       // Norway NO1
    NO2: 'Europe/Oslo',       // Norway NO2
    NO3: 'Europe/Oslo',       // Norway NO3
    NO4: 'Europe/Oslo',       // Norway NO4
    NO5: 'Europe/Oslo',       // Norway NO5
    DE: 'Europe/Berlin',      // Germany
    LU: 'Europe/Luxembourg',  // Luxembourg
    AT: 'Europe/Vienna',      // Austria
    ES: 'Europe/Madrid',      // Spain
    PT: 'Europe/Lisbon',      // Portugal
  };

  // Return the corresponding timezone or fallback to a default (e.g., Europe/Vilnius)
  return timezoneMapping[area] || 'Europe/Vilnius';
}

export function fnc_todayKey(config: PlatformConfig) {
  const timezone = defaultAreaTimezone(config);
  return DateTime.local().setZone(timezone).toFormat('yyyy-MM-dd');
}

export function fnc_tomorrowKey(config: PlatformConfig) {
  const timezone = defaultAreaTimezone(config);
  return DateTime.local().plus({ day: 1 }).setZone(timezone).toFormat('yyyy-MM-dd');
}

export function fnc_currentHour(config: PlatformConfig) {
  const timezone = defaultAreaTimezone(config);
  return DateTime.local().setZone(timezone).hour;
}
