#!/usr/bin/env node

import { appendFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const root = process.env.BASHGUARD_SPIKE_ROOT;
const probeFile = process.env.BASHGUARD_SPIKE_PROBE_FILE;
const runId = process.env.BASHGUARD_SPIKE_RUN_ID;
const scenario = process.env.BASHGUARD_SPIKE_SCENARIO;
const extensionOrderText = process.env.BASHGUARD_SPIKE_EXTENSION_ORDER;
if (!root || !probeFile || !runId || !scenario || !extensionOrderText) throw new Error("Missing command resolution runtime fixture environment");

const resolvedRoot = resolve(root);
const resolvedProbe = resolve(probeFile);
const offset = relative(resolvedRoot, resolvedProbe);
if (offset.startsWith("..") || isAbsolute(offset)) throw new Error("Runtime fixture probe path is outside temporary root");

let stdin = "";
for await (const chunk of process.stdin) {
  stdin += chunk.toString("utf8");
  if (Buffer.byteLength(stdin) > 65_536) throw new Error("Runtime fixture stdin exceeded 64KB");
}

const sentinelNames = [
  "BASHGUARD_SPIKE_MUTATED",
  "BASHGUARD_SPIKE_SPAWN",
  "BASHGUARD_SPIKE_PREFIX",
  "BASHGUARD_SPIKE_LOADED",
];
const sentinels = {};
for (const name of sentinelNames) {
  if (process.env[name] !== undefined) sentinels[name] = process.env[name];
}

appendFileSync(resolvedProbe, `${JSON.stringify({
  runId,
  scenario,
  stage: "runtime_fixture",
  extensionOrder: JSON.parse(extensionOrderText),
  timestamp: new Date().toISOString(),
  token: process.argv[2],
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  stdin,
  sentinels,
})}\n`, { encoding: "utf8", mode: 0o600 });
