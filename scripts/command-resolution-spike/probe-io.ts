import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

import { assertPathWithinRoot } from "./model.ts";
import type { ProbeRecord, ProbeStage, SpikeSentinel } from "./evidence.ts";

export type ProbeContext = {
  root: string;
  probeFile: string;
  runId: string;
  scenario: string;
  extensionOrder: string[];
};

const SENTINELS = new Set<SpikeSentinel>([
  "BASHGUARD_SPIKE_MUTATED",
  "BASHGUARD_SPIKE_SPAWN",
  "BASHGUARD_SPIKE_PREFIX",
  "BASHGUARD_SPIKE_LOADED",
]);

export function loadProbeContext(env: Record<string, string | undefined> = process.env): ProbeContext {
  const required = [
    "BASHGUARD_SPIKE_ROOT",
    "BASHGUARD_SPIKE_PROBE_FILE",
    "BASHGUARD_SPIKE_RUN_ID",
    "BASHGUARD_SPIKE_SCENARIO",
    "BASHGUARD_SPIKE_EXTENSION_ORDER",
  ] as const;
  for (const key of required) {
    if (!env[key]) throw new Error(`Missing command resolution probe environment: ${key}`);
  }
  let extensionOrder: unknown;
  try {
    extensionOrder = JSON.parse(env.BASHGUARD_SPIKE_EXTENSION_ORDER!);
  } catch {
    throw new Error("Invalid command resolution probe extension order");
  }
  if (!Array.isArray(extensionOrder) || !extensionOrder.every((value) => typeof value === "string")) {
    throw new Error("Invalid command resolution probe extension order");
  }
  const root = resolve(env.BASHGUARD_SPIKE_ROOT!);
  const probeFile = resolve(env.BASHGUARD_SPIKE_PROBE_FILE!);
  assertPathWithinRoot(root, probeFile);
  return {
    root,
    probeFile,
    runId: env.BASHGUARD_SPIKE_RUN_ID!,
    scenario: env.BASHGUARD_SPIKE_SCENARIO!,
    extensionOrder,
  };
}

export function appendProbeRecord(
  context: ProbeContext,
  stage: ProbeStage,
  data: Partial<Omit<ProbeRecord, "runId" | "scenario" | "stage" | "extensionOrder" | "timestamp">> = {},
): void {
  if (data.sentinels) {
    for (const key of Object.keys(data.sentinels)) {
      if (!SENTINELS.has(key as SpikeSentinel)) throw new Error(`non-allowlisted sentinel ${key}`);
    }
  }
  assertPathWithinRoot(context.root, context.probeFile);
  const record: ProbeRecord = {
    runId: context.runId,
    scenario: context.scenario,
    stage,
    extensionOrder: context.extensionOrder,
    timestamp: new Date().toISOString(),
    ...data,
  };
  appendFileSync(context.probeFile, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}
