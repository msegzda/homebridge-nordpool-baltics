#!/usr/bin/env node
import { readFileSync } from "fs";

// Only validate JSON files that are part of the published package
const files = ["package.json", "config.schema.json"];

let failed = false;
for (const file of files) {
    try {
        JSON.parse(
            readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
        );
    } catch (e) {
        console.error(`INVALID JSON: ${file}: ${e.message}`);
        failed = true;
    }
}

if (failed) {
    process.exit(1);
}
