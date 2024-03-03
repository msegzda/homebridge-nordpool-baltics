#!/usr/bin/env node
/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable indent */
/* eslint-disable quotes */

import { execSync } from "child_process";
import console from "console";
import semver from "semver";

console.debug("Running deprecate-old-versions.mjs");

const plugin = "homebridge-nordpool-baltics";

// Fetch versions and deprecation message simultaneously
const dataJSON = execSync(`npm view ${plugin} versions --json`);
let versions = JSON.parse(dataJSON);
versions.sort(semver.rcompare);

versions = versions.slice(3); // not touch 3 highest versions
versions.forEach((ver, i) => {
    try {
        if (i <= 10) {
            execSync(`npm deprecate ${plugin}@"${ver}" 'Version ${ver} is deprecated, please use latest.' > /dev/null 2>&1`);
            console.log(`Deprecated version ${ver}`);
        } else {
            execSync(`npm unpublish ${plugin}@"${ver}" > /dev/null 2>&1`);
            console.log(`Deleted version ${ver}`);
        }
    } catch (e) {
        // do nothing
    }
});
