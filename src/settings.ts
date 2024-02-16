import { Service } from 'homebridge';
/* eslint @typescript-eslint/no-var-requires: "off" */
const pkg = require('../package.json');

export const PLATFORM_NAME = 'Nordpool';
export const PLUGIN_NAME = pkg.name;
export const PLATFORM_MANUFACTURER = pkg.author.name;
export const PLATFORM_VERSION = pkg.version;

export interface SensorType { [key: string]: Service | null }

export interface PriceData {
    day: string;
    hour: number;
    price: number;
}

export const defaultPricing = {
  today: [] as Array<PriceData>, // all prices of today
  currently: 0.0001, // default light sensor value cannot be 0
  cheapestHour: [] as Array<number>, // can be more than 1
  cheapest4Hours: [] as Array<number>, // can be more than 4
  cheapest5Hours: [] as Array<number>, // can be more than 5
  cheapest5HoursConsec: [] as Array<number>,
  cheapest6Hours: [] as Array<number>, // can be more than 6
  cheapest7Hours: [] as Array<number>, // can be more than 7
  cheapest8Hours: [] as Array<number>, // can be more than 8
  priciestHour: [] as Array<number>, // can be more than one
  median: 0 as number,
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

// same timezone applies to all Nordpool zones: LT, LV, EE, FI
export const defaultAreaTimezone = 'Europe/Vilnius';