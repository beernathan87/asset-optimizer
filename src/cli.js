#!/usr/bin/env node
import { parseArgs } from "node:util";
import { run } from "./run.js";
import { PRESETS } from "./presets.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    preset: { type: "string", short: "p", default: "general" },
    out: { type: "string", short: "o" },
    "keep-format": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || !positionals[0]) {
  console.log(`asset-optimizer <folder> [--preset ${Object.keys(PRESETS).join("|")}] [--out DIR] [--keep-format] [--dry-run] [--json]

Audits every PNG/JPEG/WebP and audio file under <folder>, writes optimized image copies to --out
(default <folder>/.optimized, mirroring the tree) and a report (report.md + report.json) that
explains what was wasteful and what the right target is.
  --keep-format   never change file formats (e.g. keep PNG instead of WebP)
  --dry-run       audit only, write nothing
  --json          print the JSON report to stdout instead of markdown`);
  process.exit(values.help ? 0 : 1);
}

let n = 0;
const report = await run(positionals[0], {
  preset: values.preset, outDir: values.out, keepFormat: values["keep-format"], dryRun: values["dry-run"],
  onProgress: (item) => { if (!values.json) process.stderr.write(`\r${++n} files...`); },
});
if (!values.json) process.stderr.write("\r");
console.log(values.json ? JSON.stringify(report, null, 2) : report.markdown);
