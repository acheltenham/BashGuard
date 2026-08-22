import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { analyzeScenario, formatSanitizedMatrix } from "./analyze.ts";
import type { BashGuardSpikeEvent, ProbeRecord } from "./evidence.ts";
import { buildScenarioDefinitions, type SpikeScenario } from "./model.ts";

const root = resolve("/tmp/command-resolution-analysis");
const scenarios = buildScenarioDefinitions(root);
const mutationPrefix = "export BASHGUARD_SPIKE_MUTATED=1; ";
const spawnPrefix = "export BASHGUARD_SPIKE_SPAWN=1; ";

function scenario(name: string): SpikeScenario {
  return scenarios.find((entry) => entry.name === name)!;
}

function record(entry: Partial<ProbeRecord> & Pick<ProbeRecord, "stage">): ProbeRecord {
  return {
    runId: "run-1",
    scenario: "simple",
    extensionOrder: ["early", "bashguard", "late"],
    timestamp: "2026-08-22T12:00:00.000Z",
    ...entry,
  };
}

function events(command: string, toolCallId = "call-1"): BashGuardSpikeEvent[] {
  const base = { sessionId: "session-1", timestamp: "2026-08-22T12:00:00.000Z" };
  return [
    { ...base, id: "start", sequence: 1, type: "session.started" },
    { ...base, id: "request", sequence: 2, type: "tool.requested", toolCallId, toolName: "bash", payload: { input: { command } } },
    { ...base, id: "complete", sequence: 3, type: "tool.completed", toolCallId, toolName: "bash" },
    { ...base, id: "shutdown", sequence: 4, type: "session.shutdown" },
  ];
}

function runtime(target: SpikeScenario, sentinels: ProbeRecord["sentinels"] = {}, label = target.name): ProbeRecord {
  return record({ stage: "runtime_fixture", scenario: target.name, token: target.token, argv: [target.token, label], cwd: target.cwd, sentinels });
}

test("analyzeScenario proves BashGuard-before-mutator ordering", () => {
  const target = scenario("bashguard-before-mutator");
  const mutated = mutationPrefix + target.command;
  const result = analyzeScenario({
    scenario: target,
    fixtureRoot: root,
    probeRecords: [
      record({ stage: "early_tool_call", scenario: target.name, toolCallId: "call-1", command: target.command }),
      record({ stage: "late_tool_call", scenario: target.name, toolCallId: "call-1", command: mutated }),
      runtime(target, { BASHGUARD_SPIKE_MUTATED: "1" }),
    ],
    bashguardEvents: events(target.command),
  });

  assert.equal(result.status, "passed");
  assert.equal(result.requested, target.command);
  assert.equal(result.bashguardRecorded, target.command);
  assert.equal(result.postHook, mutated);
  assert.match(result.findings.join("\n"), /BashGuard recorded the pre-mutation command/);
});

test("analyzeScenario proves mutator-before-BashGuard ordering", () => {
  const target = scenario("mutator-before-bashguard");
  const mutated = mutationPrefix + target.command;
  const result = analyzeScenario({
    scenario: target,
    fixtureRoot: root,
    probeRecords: [
      record({ stage: "early_tool_call", scenario: target.name, toolCallId: "call-1", command: target.command }),
      record({ stage: "late_tool_call", scenario: target.name, toolCallId: "call-1", command: mutated }),
      runtime(target, { BASHGUARD_SPIKE_MUTATED: "1" }),
    ],
    bashguardEvents: events(mutated),
  });

  assert.equal(result.status, "passed");
  assert.equal(result.bashguardRecorded, mutated);
  assert.match(result.findings.join("\n"), /BashGuard recorded the post-mutation command/);
});

test("analyzeScenario keeps replacement-tool wrapping distinct from tool_call evidence", () => {
  const target = scenario("replacement-spawn-hook");
  const wrapped = spawnPrefix + target.command;
  const result = analyzeScenario({
    scenario: target,
    fixtureRoot: root,
    probeRecords: [
      record({ stage: "early_tool_call", scenario: target.name, toolCallId: "call-1", command: target.command }),
      record({ stage: "late_tool_call", scenario: target.name, toolCallId: "call-1", command: target.command }),
      record({ stage: "spawn_hook_input", scenario: target.name, command: target.command, cwd: target.cwd }),
      record({ stage: "spawn_hook_output", scenario: target.name, command: wrapped, cwd: target.cwd }),
      runtime(target, { BASHGUARD_SPIKE_SPAWN: "1" }),
    ],
    bashguardEvents: events(target.command),
  });

  assert.equal(result.status, "passed");
  assert.equal(result.spawnHookOutput, wrapped);
  assert.match(result.findings.join("\n"), /internal wrapper was not visible to tool_call observers/);
});

test("analyzeScenario reports invalid and failed evidence instead of inferring", () => {
  const target = scenario("simple");
  const mismatch = analyzeScenario({
    scenario: target,
    fixtureRoot: root,
    probeRecords: [record({ stage: "early_tool_call", toolCallId: "call-1", command: "echo different" })],
    bashguardEvents: events(target.command),
  });
  assert.equal(mismatch.status, "invalid");
  assert.match(mismatch.diagnostics.join("\n"), /model command mismatch/);

  const duplicate = analyzeScenario({
    scenario: target,
    fixtureRoot: root,
    probeRecords: [
      record({ stage: "early_tool_call", toolCallId: "call-1", command: target.command }),
      record({ stage: "early_tool_call", toolCallId: "call-1", command: target.command }),
      record({ stage: "late_tool_call", toolCallId: "call-1", command: target.command }),
      runtime(target),
    ],
    bashguardEvents: events(target.command).filter((entry) => entry.type !== "session.shutdown"),
  });
  assert.equal(duplicate.status, "failed");
  assert.match(duplicate.diagnostics.join("\n"), /duplicate early_tool_call/);
  assert.match(duplicate.diagnostics.join("\n"), /missing session.shutdown/);
});

test("formatSanitizedMatrix marks unavailable execution layers as missing", () => {
  const target = scenario("simple");
  const result = analyzeScenario({
    scenario: target,
    fixtureRoot: root,
    probeRecords: [
      record({ stage: "early_tool_call", toolCallId: "call-1", command: target.command }),
      record({ stage: "late_tool_call", toolCallId: "call-1", command: target.command }),
      runtime(target),
    ],
    bashguardEvents: events(target.command),
  });

  const matrix = formatSanitizedMatrix([result]);
  assert.match(matrix, /\| simple \| passed \| same as requested \| same as requested \| missing \| 1 \|/);
  assert.doesNotMatch(matrix, new RegExp(root.replaceAll("/", "\\/")));
});
