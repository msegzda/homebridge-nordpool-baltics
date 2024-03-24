import { Service } from 'homebridge';
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
    priciestHour: number[];
    median: number;
    median2days: number;
  }

export const defaultPricing: Pricing = {
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
  priciestHour: null,
  hourlyTickerSwitch: null,
};

export const defaultPricesCache = new Cache({ ns: 'homebridge-nordpool-baltics', ttl: 172800 });

// same timezone applies to all Nordpool zones: LT, LV, EE, FI
export const defaultAreaTimezone = 'Europe/Vilnius';

export function fnc_todayKey() {
  return DateTime.local().setZone(defaultAreaTimezone).toFormat('yyyy-MM-dd');
}
export function fnc_tomorrowKey() {
  return DateTime.local().plus({ day: 1 }).setZone(defaultAreaTimezone).toFormat('yyyy-MM-dd');
}
export function fnc_currentHour() {
  return DateTime.local().setZone(defaultAreaTimezone).hour;
}
