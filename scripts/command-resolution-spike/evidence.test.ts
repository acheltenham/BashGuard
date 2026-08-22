import assert from "node:assert/strict";
import test from "node:test";

import { parseBashGuardJsonl, parseProbeJsonl } from "./evidence.ts";

function probe(stage: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    runId: "run-1",
    scenario: "simple",
    stage,
    extensionOrder: ["early", "bashguard", "late"],
    timestamp: "2026-08-22T12:00:00.000Z",
    ...extra,
  });
}

test("parseProbeJsonl preserves valid append order and reports malformed or incomplete data", () => {
  const text = [
    probe("early_tool_call", { toolCallId: "call-1", command: "echo one" }),
    "not-json",
    probe("late_tool_call", { toolCallId: "call-1", command: "echo two" }),
    probe("unknown_stage"),
    "{",
  ].join("\n");

  const parsed = parseProbeJsonl(text);

  assert.deepEqual(parsed.records.map((record) => record.stage), ["early_tool_call", "late_tool_call"]);
  assert.match(parsed.diagnostics.join("\n"), /malformed probe JSONL line 2/);
  assert.match(parsed.diagnostics.join("\n"), /unknown probe stage on line 4/);
  assert.match(parsed.diagnostics.join("\n"), /incomplete final probe JSONL line 5/);
});

test("parseProbeJsonl rejects runtime environment keys outside the sentinel allowlist", () => {
  const parsed = parseProbeJsonl(`${probe("runtime_fixture", {
    token: "simple-token",
    sentinels: { BASHGUARD_SPIKE_MUTATED: "1", SECRET_TOKEN: "not-allowed" },
  })}\n`);

  assert.deepEqual(parsed.records, []);
  assert.match(parsed.diagnostics.join("\n"), /non-allowlisted sentinel SECRET_TOKEN/);
});

test("parseBashGuardJsonl extracts relevant events without reordering", () => {
  const event = (sequence: number, type: string, extra: Record<string, unknown> = {}) => JSON.stringify({
    schemaVersion: 1,
    id: `evt-${sequence}`,
    sequence,
    timestamp: "2026-08-22T12:00:00.000Z",
    type,
    sessionId: "session-1",
    payload: {},
    ...extra,
  });
  const parsed = parseBashGuardJsonl([
    event(1, "session.started"),
    event(2, "message.started"),
    event(3, "tool.requested", { toolCallId: "call-1", toolName: "bash", payload: { input: { command: "echo one" } } }),
    event(4, "tool.completed", { toolCallId: "call-1", toolName: "bash" }),
    event(5, "session.shutdown"),
    "{",
  ].join("\n"));

  assert.deepEqual(parsed.events.map((entry) => entry.type), ["session.started", "tool.requested", "tool.completed", "session.shutdown"]);
  assert.match(parsed.diagnostics.join("\n"), /incomplete final BashGuard JSONL line 6/);
});
