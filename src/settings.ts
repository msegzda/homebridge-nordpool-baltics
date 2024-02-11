/* eslint @typescript-eslint/no-var-requires: "off" */
const pkg = require('../package.json');

export const PLATFORM_NAME = 'Nordpool';
export const PLUGIN_NAME = pkg.name;
export const PLATFORM_MANUFACTURER = pkg.author.name;
export const PLATFORM_VERSION = pkg.version;