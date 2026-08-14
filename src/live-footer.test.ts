import assert from "node:assert/strict";
import test from "node:test";

import { buildAttachStatus, type AttachStatus, type BashGuardEvent } from "./cli.ts";
import { buildLiveFooterModel, formatLiveFooter, type LiveFooterModel } from "./live-footer.ts";

function status(overrides: Partial<AttachStatus> = {}): AttachStatus {
  return {
    state: "active",
    activityLabel: "Current activity",
    activity: "Running · npm test",
    evidence: "request recorded; completion not recorded yet",
    capture: "No recorded capture limitations",
    eventCount: 42,
    lastObserved: "2s ago",
    ...overrides,
  };
}

function event(sequence: number, type: string, overrides: Partial<BashGuardEvent> = {}): BashGuardEvent {
  return {
    schemaVersion: 1,
    id: `event-${sequence}`,
    sequence,
    timestamp: `2026-08-14T12:00:0${sequence}.000Z`,
    type,
    sessionId: "session-1",
    ...overrides,
  };
}

function assertBounded(lines: string[], columns: number): void {
  for (const line of lines) assert.ok(line.length <= columns, `${JSON.stringify(line)} exceeds ${columns}`);
}

test("buildLiveFooterModel maps current unmatched and completed recorded evidence", () => {
  assert.deepEqual(buildLiveFooterModel(status()), {
    state: "ACTIVE",
    activity: "Running · npm test",
    evidence: "awaiting completion evidence",
    capture: "capture ok",
    captureDetails: [],
    eventCount: 42,
    freshness: "2s ago",
  });

  const completed = buildLiveFooterModel(status({
    state: "complete",
    activityLabel: "Last activity",
    activity: "bash complete",
    evidence: "recorded event",
  }));
  assert.equal(completed.state, "DONE");
  assert.equal(completed.evidence, "recorded");
});

test("buildLiveFooterModel reports unknown and structured partial capture honestly", () => {
  assert.equal(buildLiveFooterModel(status({ capture: "No capture metadata recorded" })).capture, "capture unknown");

  const partial = buildAttachStatus([
    event(1, "capture.gap", { capture: { missing: [], redacted: ["secret"], truncated: ["output"] } }),
    event(2, "message.ended", { capture: { missing: ["turnId"], redacted: [], truncated: ["content"] } }),
  ], true);
  const model = buildLiveFooterModel(partial);
  assert.deepEqual(model.captureDetails, ["1 gap", "2 truncated", "1 missing", "1 redacted"]);
  assert.match(formatLiveFooter(model, 120).join("\n"), /capture partial · 1 gap · 2 truncated · 1 missing · 1 redacted/);

  const legacy = buildLiveFooterModel(status({
    capture: "Partial · 2 capture gaps · 3 events with missing fields · 1 redacted event · 4 truncated events",
  }));
  assert.deepEqual(legacy.captureDetails, ["2 gap", "4 truncated", "3 missing", "1 redacted"]);
});

test("wide footer has a separator and exactly three content lines", () => {
  const lines = formatLiveFooter(buildLiveFooterModel(status()), 72);
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "─".repeat(72));
  assert.deepEqual(lines.slice(1), [
    "ACTIVE · Running · npm test",
    "awaiting completion evidence",
    "capture ok · 2s ago · 42 ev",
  ]);
  assertBounded(lines, 72);
});

test("medium footer is bounded to at most four content lines", () => {
  const model = buildLiveFooterModel(status({ activity: "Running a deliberately long command that needs compact presentation" }));
  for (const columns of [40, 55, 71]) {
    const lines = formatLiveFooter(model, columns);
    assert.equal(lines[0], "─".repeat(columns));
    assert.ok(lines.length - 1 <= 4);
    assertBounded(lines, columns);
    assert.match(lines.join("\n"), /ACTIVE/);
    assert.match(lines.join("\n"), /awaiting completion evidence/);
  }
});

test("narrow footer is one bounded line", () => {
  for (const columns of [1, 2, 8, 20, 39]) {
    const lines = formatLiveFooter(buildLiveFooterModel(status()), columns);
    assert.equal(lines.length, 1);
    assertBounded(lines, columns);
  }
  assert.match(formatLiveFooter(buildLiveFooterModel(status()), 39)[0], /^ACTIVE/);
  assert.equal(formatLiveFooter(buildLiveFooterModel(status()), 2)[0], "A…");
});

test("width pressure drops event count before freshness and higher-priority fields", () => {
  const partialModel: LiveFooterModel = {
    ...buildLiveFooterModel(status({ capture: "Partial" })),
    capture: "capture partial",
    captureDetails: ["12 gap", "8 truncated", "3 missing", "2 redacted"],
  };
  const output = formatLiveFooter(partialModel, 48).join("\n");
  assert.match(output, /ACTIVE/);
  assert.match(output, /Running/);
  assert.match(output, /awaiting completion evidence/);
  assert.match(output, /capture partial/);
  assert.match(output, /2s ago/);
  assert.doesNotMatch(output, /42 ev/);
});

test("width pressure never retains event count after freshness is dropped", () => {
  const model = buildLiveFooterModel(status({
    lastObserved: "a freshness value too long to fit beside the capture summary at this width",
  }));
  const output = formatLiveFooter(model, 72).join("\n");
  assert.doesNotMatch(output, /a freshness value/);
  assert.doesNotMatch(output, /42 ev/);
});

test("activity is control-free, single-line, Unicode-preserving, and ellipsized", () => {
  const unicode = formatLiveFooter(buildLiveFooterModel(status({ activity: "Running · café 東京" })), 72).join("\n");
  assert.match(unicode, /café 東京/);

  const lines = formatLiveFooter(buildLiveFooterModel(status({
    activity: `Running\n\u001b[31m dangerous\t${"x".repeat(100)}`,
  })), 40);
  assertBounded(lines, 40);
  const output = lines.join("\n");
  assert.doesNotMatch(output, /\u001b|\[31m/);
  assert.match(output, /…/);
});
