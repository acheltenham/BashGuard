import assert from "node:assert/strict";
import test from "node:test";
import stringWidth from "string-width";

import { buildAttachStatus, type AttachStatus, type BashGuardEvent } from "./cli.ts";
import {
  ANSI_CLEAR_LINE,
  ANSI_CURSOR_UP,
  buildLiveFooterModel,
  createLiveFooterController,
  formatLiveFooter,
  type LiveFooterModel,
} from "./live-footer.ts";

function status(overrides: Partial<AttachStatus> = {}): AttachStatus {
  return {
    state: "active",
    activityLabel: "Current activity",
    activity: "Running · npm test",
    evidence: "request recorded; completion not recorded yet",
    capture: "No recorded capture limitations",
    captureSummary: { state: "ok", gaps: 0, missing: 0, redacted: 0, truncated: 0 },
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
  for (const line of lines) {
    assert.ok(stringWidth(line) <= columns, `${JSON.stringify(line)} occupies ${stringWidth(line)} cells, exceeding ${columns}`);
  }
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
  assert.equal(buildLiveFooterModel(status({
    capture: "No capture metadata recorded",
    captureSummary: { state: "unknown", gaps: 0, missing: 0, redacted: 0, truncated: 0 },
  })).capture, "capture unknown");

  const partial = buildAttachStatus([
    event(1, "capture.gap", { capture: { missing: [], redacted: ["secret"], truncated: ["output"] } }),
    event(2, "message.ended", { capture: { missing: ["turnId"], redacted: [], truncated: ["content"] } }),
  ], true);
  const model = buildLiveFooterModel(partial);
  assert.deepEqual(model.captureDetails, ["1 gap", "2 truncated", "1 missing", "1 redacted"]);
  assert.match(formatLiveFooter(model, 120).join("\n"), /capture partial · 1 gap · 2 truncated · 1 missing · 1 redacted/);

  const structured = buildLiveFooterModel(status({
    capture: "prose is not parsed",
    captureSummary: { state: "partial", gaps: 2, missing: 3, redacted: 1, truncated: 4 },
  }));
  assert.deepEqual(structured.captureDetails, ["2 gaps", "4 truncated", "3 missing", "1 redacted"]);
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

test("narrow footer keeps the complete state whenever it fits", () => {
  const active = buildLiveFooterModel(status());
  const done = buildLiveFooterModel(status({ state: "complete" }));
  const activeExpected = ["ACT…", "ACTI…", "ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE · …", "ACTIVE · R…", "ACTIVE · Ru…"];
  const doneExpected = ["DONE", "DONE", "DONE", "DONE", "DONE · …", "DONE · R…", "DONE · Ru…", "DONE · Run…", "DONE · Runn…"];

  for (const [index, columns] of Array.from({ length: 9 }, (_, offset) => offset + 4).entries()) {
    assert.equal(formatLiveFooter(active, columns)[0], activeExpected[index]);
    assert.equal(formatLiveFooter(done, columns)[0], doneExpected[index]);
  }

  assert.equal(formatLiveFooter(active, 2)[0], "A…");
  assert.match(formatLiveFooter(active, 39)[0], /^ACTIVE/);
});

test("narrow footer retains ellipsized ASCII, CJK, and emoji activity after the full state", () => {
  const samples = [
    { activity: "Running a deliberately long command that remains visible", visible: /Running/ },
    { activity: "東京東京東京東京東京東京東京東京東京東京東京東京", visible: /東京/ },
    { activity: "👩‍👩‍👧‍👦".repeat(24), visible: /👩‍👩‍👧‍👦/ },
  ];

  for (const columns of [20, 30, 39]) {
    for (const sample of samples) {
      const [line] = formatLiveFooter(buildLiveFooterModel(status({ activity: sample.activity })), columns);
      assert.match(line, /^ACTIVE · /);
      assert.match(line, sample.visible);
      assert.match(line, /…$/);
      assert.doesNotMatch(line, /(?:\u200d|\p{M})…$/u);
      assert.ok(stringWidth(line) <= columns, `${JSON.stringify(line)} exceeds ${columns} cells`);
    }
  }
});

test("columns normalize to a finite positive integer with a minimum of one", () => {
  const model = buildLiveFooterModel(status());
  for (const columns of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -20]) {
    const lines = formatLiveFooter(model, columns);
    assert.deepEqual(lines, ["…"]);
  }
  assert.deepEqual(formatLiveFooter(model, 8.9), formatLiveFooter(model, 8));
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

test("wide width pressure reserves freshness before optional capture details and event count", () => {
  const model: LiveFooterModel = {
    ...buildLiveFooterModel(status()),
    capture: "capture partial",
    captureDetails: ["12 gaps", "8 truncated", "3 missing", "2 redacted"],
    freshness: "12 seconds ago",
  };
  const output = formatLiveFooter(model, 72).join("\n");
  assert.match(output, /capture partial/);
  assert.match(output, /12 seconds ago/);
  assert.doesNotMatch(output, /2 redacted/);
  assert.doesNotMatch(output, /42 ev/);
});

test("ordinary ASCII footer formatting is unchanged", () => {
  assert.deepEqual(formatLiveFooter(buildLiveFooterModel(status()), 72), [
    "─".repeat(72),
    "ACTIVE · Running · npm test",
    "awaiting completion evidence",
    "capture ok · 2s ago · 42 ev",
  ]);
  assert.equal(formatLiveFooter(buildLiveFooterModel(status()), 39)[0], "ACTIVE · Running · npm test");
});

test("CJK, emoji, ZWJ emoji, and combining accents obey display-cell budgets", () => {
  const samples = [
    "編集中 東京東京東京東京東京東京東京東京東京東京",
    "Running 😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀",
    `Family ${"👩‍👩‍👧‍👦".repeat(16)}`,
    `Combining ${("e\u0301").repeat(40)}`,
  ];

  for (const activity of samples) {
    const model = buildLiveFooterModel(status({ activity }));
    for (const columns of [72, 50, 39, 18, 8, 3, 2, 1]) {
      assertBounded(formatLiveFooter(model, columns), columns);
    }
  }
});

test("truncation preserves grapheme clusters and fits the ellipsis cell", () => {
  const family = "👩‍👩‍👧‍👦";
  const zwjLine = formatLiveFooter(buildLiveFooterModel(status({ activity: family.repeat(20) })), 40)[1];
  assert.equal(zwjLine, `ACTIVE · ${family.repeat(15)}…`);
  assert.doesNotMatch(zwjLine, /(?:\u200d|\p{M})…$/u);

  const combiningLine = formatLiveFooter(buildLiveFooterModel(status({ activity: ("e\u0301").repeat(40) })), 41)[1];
  assert.doesNotMatch(combiningLine, /(?<!\u0301)…$/u);
  assert.match(combiningLine, /e\u0301…$/u);

  assert.deepEqual(formatLiveFooter(buildLiveFooterModel(status()), 1), ["…"]);
});

test("activity controls are sanitized before display-width measurement", () => {
  const lines = formatLiveFooter(buildLiveFooterModel(status({
    activity: `東京\n\u001b[31m危険\t${"界".repeat(40)}`,
  })), 40);
  assertBounded(lines, 40);
  const output = lines.join("\n");
  for (const line of lines) assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f]|\[31m/u);
  assert.match(output, /東京 危険/);
  assert.match(output, /…/);
});

class RecordingWritable {
  chunks: string[] = [];
  error: unknown;

  write(chunk: string): boolean {
    if (this.error !== undefined) throw this.error;
    this.chunks.push(chunk);
    return false; // Backpressure does not change synchronous terminal ordering.
  }

  take(): string {
    const output = this.chunks.join("");
    this.chunks = [];
    return output;
  }
}

function footerModel(overrides: Partial<LiveFooterModel> = {}): LiveFooterModel {
  return {
    state: "ACTIVE",
    activity: "Running tests",
    evidence: "recorded",
    capture: "capture ok",
    captureDetails: [],
    eventCount: 1,
    freshness: "now",
    ...overrides,
  };
}

function controllerFixture() {
  const output = new RecordingWritable();
  let time = 10_000;
  let columns = 80;
  const controller = createLiveFooterController({
    output,
    formatter: (model, width) => [`${model.state} ${width}`, model.activity],
    clock: () => time,
    width: () => columns,
  });
  return {
    controller,
    output,
    setTime(value: number) { time = value; },
    setWidth(value: number) { columns = value; },
  };
}

test("controller first render writes exact lines without a trailing newline and tracks state", () => {
  const { controller, output } = controllerFixture();
  const model = footerModel();
  controller.render(model);

  assert.equal(output.take(), "ACTIVE 80\nRunning tests");
  assert.equal(controller.renderedLineCount, 2);
  assert.equal(controller.lastRenderTime, 10_000);
  assert.equal(controller.lastRenderWidth, 80);
  assert.deepEqual(controller.model, model);
});

test("controller clearing emits exact ANSI for one and multiple tracked lines", () => {
  // Use a one-line formatter for this case.
  const oneLineOutput = new RecordingWritable();
  const oneLine = createLiveFooterController({
    output: oneLineOutput,
    formatter: (model) => [model.state],
    clock: () => 0,
    width: () => 80,
  });
  oneLine.render(footerModel());
  oneLineOutput.take();
  oneLine.cleanup();
  assert.equal(oneLineOutput.take(), `${ANSI_CLEAR_LINE}\n`);

  const many = controllerFixture();
  many.controller.render(footerModel());
  many.output.take();
  many.controller.cleanup();
  assert.equal(many.output.take(), `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}\n`);
});

test("controller writeTimeline clears, writes one payload newline, then redraws", () => {
  const { controller, output } = controllerFixture();
  controller.render(footerModel());
  output.take();

  controller.writeTimeline("17 event happened");
  assert.equal(
    output.take(),
    `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}17 event happened\nACTIVE 80\nRunning tests`,
  );
  assert.equal(controller.renderedLineCount, 2);
});

test("controller redraws changed models immediately and throttles unchanged freshness redraws", () => {
  const fixture = controllerFixture();
  fixture.controller.render(footerModel());
  fixture.output.take();

  fixture.setTime(10_100);
  fixture.controller.render(footerModel({ activity: "Changed" }));
  assert.equal(fixture.output.take(), `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}ACTIVE 80\nChanged`);

  fixture.setTime(10_999);
  fixture.controller.render(footerModel({ activity: "Changed" }));
  assert.equal(fixture.output.take(), "");

  fixture.setTime(11_100);
  fixture.controller.render(footerModel({ activity: "Changed" }));
  assert.equal(fixture.output.take(), `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}ACTIVE 80\nChanged`);

  fixture.setTime(12_100);
  fixture.controller.render(footerModel({ activity: "Changed", freshness: "2s ago" }));
  assert.equal(fixture.output.take(), `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}ACTIVE 80\nChanged`);
});

test("controller resize forces one redraw at the changed width", () => {
  const fixture = controllerFixture();
  fixture.controller.render(footerModel());
  fixture.output.take();

  fixture.setWidth(50);
  fixture.controller.resize();
  assert.equal(fixture.output.take(), `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}ACTIVE 50\nRunning tests`);
  fixture.controller.resize();
  assert.equal(fixture.output.take(), "");
});

test("controller cleanup clears, leaves one normal newline, and is idempotent", () => {
  const { controller, output } = controllerFixture();
  controller.render(footerModel());
  output.take();

  controller.cleanup();
  controller.cleanup();
  assert.equal(output.take(), `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}\n`);
  assert.equal(controller.renderedLineCount, 0);
});

test("controller propagates writes including identifiable EPIPE and ignores backpressure", () => {
  const ordinary = controllerFixture();
  ordinary.output.error = new Error("write failed");
  assert.throws(() => ordinary.controller.render(footerModel()), /write failed/);

  const epiped = controllerFixture();
  const error = Object.assign(new Error("broken pipe"), { code: "EPIPE" });
  epiped.output.error = error;
  assert.throws(() => epiped.controller.render(footerModel()), (thrown) => thrown === error && (thrown as NodeJS.ErrnoException).code === "EPIPE");
});

test("controller emits no alternate-screen or cursor-hide sequences", () => {
  const fixture = controllerFixture();
  fixture.controller.render(footerModel());
  fixture.controller.writeTimeline("event");
  fixture.controller.cleanup();
  const output = fixture.output.take();
  assert.doesNotMatch(output, /\u001b\[\?(?:1049|25)[hl]/u);
});
