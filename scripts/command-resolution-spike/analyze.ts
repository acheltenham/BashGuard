import { assertPathWithinRoot, type SpikeScenario } from "./model.ts";
import type { BashGuardSpikeEvent, ProbeRecord, ProbeStage, SpikeSentinel } from "./evidence.ts";

export type AnalyzeScenarioInput = {
  scenario: SpikeScenario;
  fixtureRoot: string;
  probeRecords: ProbeRecord[];
  bashguardEvents: BashGuardSpikeEvent[];
  diagnostics?: string[];
  observedPaths?: string[];
};

export type ScenarioAnalysis = {
  scenario: string;
  status: "passed" | "invalid" | "failed";
  toolCallId?: string;
  requested?: string;
  bashguardRecorded?: string;
  postHook?: string;
  spawnHookInput?: string;
  spawnHookOutput?: string;
  runtime: ProbeRecord[];
  findings: string[];
  diagnostics: string[];
};

const MUTATION_PREFIX = "export BASHGUARD_SPIKE_MUTATED=1; ";
const SPAWN_PREFIX = "export BASHGUARD_SPIKE_SPAWN=1; ";
const ALL_SENTINELS: SpikeSentinel[] = [
  "BASHGUARD_SPIKE_MUTATED",
  "BASHGUARD_SPIKE_SPAWN",
  "BASHGUARD_SPIKE_PREFIX",
  "BASHGUARD_SPIKE_LOADED",
];

function oneStage(records: ProbeRecord[], stage: ProbeStage, diagnostics: string[], required: boolean): ProbeRecord | undefined {
  const matches = records.filter((record) => record.stage === stage);
  if (matches.length > 1) diagnostics.push(`duplicate ${stage} evidence`);
  if (required && matches.length === 0) diagnostics.push(`missing ${stage} evidence`);
  return matches[0];
}

function commandFromRequest(event: BashGuardSpikeEvent | undefined): string | undefined {
  const input = event?.payload?.input;
  return typeof input === "object" && input !== null && typeof (input as Record<string, unknown>).command === "string"
    ? (input as Record<string, unknown>).command as string
    : undefined;
}

function expectedSentinels(scenario: SpikeScenario): Partial<Record<SpikeSentinel, string>> {
  const expected: Partial<Record<SpikeSentinel, string>> = {};
  if (scenario.expectedMutation) expected.BASHGUARD_SPIKE_MUTATED = "1";
  if (scenario.expectedSpawnWrap) expected.BASHGUARD_SPIKE_SPAWN = "1";
  if (scenario.name === "prefix-env") expected.BASHGUARD_SPIKE_PREFIX = "prefix-value";
  if (scenario.name === "environment-load") expected.BASHGUARD_SPIKE_LOADED = "loaded-value";
  return expected;
}

export function analyzeScenario(input: AnalyzeScenarioInput): ScenarioAnalysis {
  const records = input.probeRecords.filter((record) => record.scenario === input.scenario.name);
  const diagnostics = [...(input.diagnostics ?? [])];
  const findings: string[] = [];
  const early = oneStage(records, "early_tool_call", diagnostics, true);
  const late = oneStage(records, "late_tool_call", diagnostics, true);
  const spawnInput = oneStage(records, "spawn_hook_input", diagnostics, input.scenario.expectedSpawnWrap);
  const spawnOutput = oneStage(records, "spawn_hook_output", diagnostics, input.scenario.expectedSpawnWrap);
  const runtime = records.filter((record) => record.stage === "runtime_fixture");
  const requested = early?.command;
  const toolCallId = early?.toolCallId;

  let invalid = false;
  if (requested !== undefined && requested !== input.scenario.command) {
    diagnostics.push("model command mismatch: early tool_call input differed from the expected command");
    invalid = true;
  }
  if (!toolCallId) diagnostics.push("missing toolCallId on early tool_call evidence");
  if (late?.toolCallId !== toolCallId) diagnostics.push("late tool_call toolCallId did not match early evidence");

  const requests = input.bashguardEvents.filter((event) => event.type === "tool.requested" && event.toolName === "bash" && event.toolCallId === toolCallId);
  if (requests.length === 0) diagnostics.push("missing BashGuard tool.requested evidence");
  if (requests.length > 1) diagnostics.push("ambiguous BashGuard tool.requested evidence");
  const bashguardRecorded = commandFromRequest(requests[0]);
  if (requests[0] && bashguardRecorded === undefined) diagnostics.push("BashGuard tool.requested evidence had no command");
  if (!input.bashguardEvents.some((event) => event.type === "tool.completed" && event.toolCallId === toolCallId)) {
    diagnostics.push("missing BashGuard tool.completed evidence");
  }
  if (!input.bashguardEvents.some((event) => event.type === "session.shutdown")) diagnostics.push("missing session.shutdown evidence");

  if (runtime.length !== input.scenario.expectedRuntimeRecords) {
    diagnostics.push(`expected ${input.scenario.expectedRuntimeRecords} runtime_fixture record(s), found ${runtime.length}`);
  }
  const sentinels = expectedSentinels(input.scenario);
  for (const record of runtime) {
    if (record.token !== input.scenario.token) diagnostics.push("runtime fixture scenario token mismatch");
    if (record.cwd) {
      try {
        assertPathWithinRoot(input.fixtureRoot, record.cwd);
      } catch (error) {
        diagnostics.push(error instanceof Error ? error.message : String(error));
      }
    }
    for (const sentinel of ALL_SENTINELS) {
      const expected = sentinels[sentinel];
      const actual = record.sentinels?.[sentinel];
      if (expected !== undefined && actual !== expected) diagnostics.push(`missing or incorrect runtime sentinel ${sentinel}`);
      if (expected === undefined && actual !== undefined) diagnostics.push(`unexpected runtime sentinel ${sentinel}`);
    }
  }
  for (const path of input.observedPaths ?? []) {
    try {
      assertPathWithinRoot(input.fixtureRoot, path);
    } catch (error) {
      diagnostics.push(error instanceof Error ? error.message : String(error));
    }
  }

  const expectedPostHook = input.scenario.expectedMutation ? MUTATION_PREFIX + input.scenario.command : input.scenario.command;
  if (late?.command !== undefined && late.command !== expectedPostHook) diagnostics.push("late tool_call command did not match expected hook result");
  if (input.scenario.expectedSpawnWrap) {
    if (spawnInput?.command !== expectedPostHook) diagnostics.push("spawn hook input did not match post-hook command");
    if (spawnOutput?.command !== SPAWN_PREFIX + expectedPostHook) diagnostics.push("spawn hook output did not contain the expected wrapper");
  }

  if (input.scenario.name === "bashguard-before-mutator" && bashguardRecorded === input.scenario.command && late?.command === expectedPostHook) {
    findings.push("BashGuard recorded the pre-mutation command because its handler ran first.");
  }
  if (input.scenario.name === "mutator-before-bashguard" && bashguardRecorded === expectedPostHook) {
    findings.push("BashGuard recorded the post-mutation command because the mutator handler ran first.");
  }
  if (input.scenario.expectedSpawnWrap && spawnOutput?.command !== late?.command) {
    findings.push("The replacement tool's internal wrapper was not visible to tool_call observers.");
  }

  return {
    scenario: input.scenario.name,
    status: invalid ? "invalid" : diagnostics.length > 0 ? "failed" : "passed",
    toolCallId,
    requested,
    bashguardRecorded,
    postHook: late?.command,
    spawnHookInput: spawnInput?.command,
    spawnHookOutput: spawnOutput?.command,
    runtime,
    findings,
    diagnostics,
  };
}

function relation(value: string | undefined, requested: string | undefined): string {
  if (value === undefined) return "missing";
  return value === requested ? "same as requested" : "changed";
}

export function formatSanitizedMatrix(results: ScenarioAnalysis[]): string {
  const lines = [
    "| Scenario | Status | BashGuard recorded | Post-hook | Spawn output | Runtime records |",
    "|---|---|---|---|---|---:|",
  ];
  for (const result of results) {
    lines.push(`| ${result.scenario} | ${result.status} | ${relation(result.bashguardRecorded, result.requested)} | ${relation(result.postHook, result.requested)} | ${result.spawnHookOutput === undefined ? "missing" : "wrapped after tool_call"} | ${result.runtime.length} |`);
  }
  return lines.join("\n");
}
