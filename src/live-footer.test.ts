import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { Writable } from "node:stream";
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

type WritePlan = boolean | Error | {
  returns: boolean;
  callbackError?: Error;
  asynchronous?: boolean;
  emitError?: boolean;
};

class RecordingWritable extends EventEmitter {
  chunks: string[] = [];
  plans: WritePlan[] = [];

  write(chunk: string, callback: (error?: Error) => void): boolean {
    const plan = this.plans.shift() ?? true;
    if (plan instanceof Error) throw plan;
    this.chunks.push(chunk);
    const returns = typeof plan === "boolean" ? plan : plan.returns;
    const complete = () => {
      const error = typeof plan === "boolean" ? undefined : plan.callbackError;
      callback(error);
      if (error !== undefined && plan.emitError) this.emit("error", error);
    };
    if (typeof plan !== "boolean" && plan.asynchronous) queueMicrotask(complete);
    else complete();
    return returns;
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

function controllerFixture(formatter = (model: LiveFooterModel, width: number) => [`${model.state} ${width}`, model.activity]) {
  const output = new RecordingWritable();
  let time = 10_000;
  let columns = 80;
  const controller = createLiveFooterController({
    output,
    formatter,
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

test("controller first render writes one exact CRLF-delimited chunk and tracks state", async () => {
  const { controller, output } = controllerFixture();
  const model = footerModel();
  await controller.render(model);

  assert.deepEqual(output.chunks, ["ACTIVE 80\r\nRunning tests"]);
  assert.equal(controller.renderedLineCount, 2);
  assert.equal(controller.lastRenderTime, 10_000);
  assert.equal(controller.lastRenderWidth, 80);
  assert.deepEqual(controller.model, model);
});

test("controller clearing emits exact ANSI and cleanup CRLF", async () => {
  const oneLine = controllerFixture((model) => [model.state]);
  await oneLine.controller.render(footerModel());
  oneLine.output.take();
  await oneLine.controller.cleanup();
  assert.equal(oneLine.output.take(), `${ANSI_CLEAR_LINE}\r\n`);

  const many = controllerFixture();
  await many.controller.render(footerModel());
  many.output.take();
  await many.controller.cleanup();
  assert.equal(many.output.take(), `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}\r\n`);
});

test("controller writeTimeline normalizes zero or many trailing newlines to one CRLF", async () => {
  for (const [payload, expected] of [
    ["17 event happened", "17 event happened\r\n"],
    ["17 event happened\n", "17 event happened\r\n"],
    ["17 event happened\r\n\r\n", "17 event happened\r\n"],
    ["first\nsecond\n\n", "first\r\nsecond\r\n"],
    ["", "\r\n"],
    ["\n\r\n", "\r\n"],
  ] as const) {
    const { controller, output } = controllerFixture();
    await controller.render(footerModel());
    output.take();

    await controller.writeTimeline(payload);
    assert.deepEqual(output.chunks, [
      `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}`,
      expected,
      "ACTIVE 80\r\nRunning tests",
    ]);
    assert.equal(controller.renderedLineCount, 2);
  }
});

test("backpressure blocks later timeline and redraw writes, then preserves exact call order", async () => {
  const fixture = controllerFixture();
  await fixture.controller.render(footerModel());
  fixture.output.take();
  fixture.output.plans.push(false);

  const timeline = fixture.controller.writeTimeline("event");
  const redraw = fixture.controller.render(footerModel({ activity: "Changed" }));
  await Promise.resolve();
  assert.deepEqual(fixture.output.chunks, [`${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}`]);
  assert.equal(fixture.output.listenerCount("drain"), 1);
  assert.equal(fixture.output.listenerCount("error"), 1);
  assert.equal(fixture.output.listenerCount("close"), 1);

  fixture.output.emit("drain");
  await Promise.all([timeline, redraw]);
  assert.deepEqual(fixture.output.chunks, [
    `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}`,
    "event\r\n",
    "ACTIVE 80\r\nRunning tests",
    `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}`,
    "ACTIVE 80\r\nChanged",
  ]);
  assert.equal(fixture.output.listenerCount("drain"), 0);
  assert.equal(fixture.output.listenerCount("error"), 0);
  assert.equal(fixture.output.listenerCount("close"), 0);
});

test("controller redraws changes, throttles freshness, and resets after a backward clock", async () => {
  const fixture = controllerFixture();
  await fixture.controller.render(footerModel());
  fixture.output.take();

  fixture.setTime(10_100);
  await fixture.controller.render(footerModel({ activity: "Changed" }));
  assert.equal(fixture.output.take(), `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}ACTIVE 80\r\nChanged`);

  fixture.setTime(10_999);
  await fixture.controller.refresh();
  assert.equal(fixture.output.take(), "");

  fixture.setTime(9_000);
  await fixture.controller.refresh();
  assert.equal(fixture.output.take(), `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}ACTIVE 80\r\nChanged`);
  assert.equal(fixture.controller.lastRenderTime, 9_000);

  fixture.setTime(10_000);
  await fixture.controller.refresh();
  assert.equal(fixture.output.take(), `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}ACTIVE 80\r\nChanged`);
});

test("real formatter resize wide to medium to narrow clears the prior line count", async () => {
  const fixture = controllerFixture(formatLiveFooter);
  await fixture.controller.render(footerModel());
  assert.equal(fixture.controller.renderedLineCount, 4);
  fixture.output.take();

  fixture.setWidth(60);
  await fixture.controller.resize();
  assert.equal(fixture.output.chunks[0], footerClearSequenceForTest(4));
  assert.equal(fixture.output.chunks[0].split(ANSI_CURSOR_UP).length - 1, 3);
  assert.equal(fixture.controller.renderedLineCount, 5);
  fixture.output.take();

  fixture.setWidth(30);
  await fixture.controller.resize();
  assert.equal(fixture.output.chunks[0], footerClearSequenceForTest(5));
  assert.equal(fixture.output.chunks[0].split(ANSI_CURSOR_UP).length - 1, 4);
  assert.equal(fixture.controller.renderedLineCount, 1);
});

function footerClearSequenceForTest(lines: number): string {
  return ANSI_CLEAR_LINE + `${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}`.repeat(lines - 1);
}

test("synchronous pre-accept write failures reject but remain safely retryable", async () => {
  const clear = controllerFixture();
  await clear.controller.render(footerModel());
  clear.output.take();
  clear.output.plans.push(new Error("clear failed"));
  await assert.rejects(clear.controller.render(footerModel({ activity: "Changed" })), /clear failed/);
  assert.equal(clear.controller.renderedLineCount, 2);
  await clear.controller.render(footerModel({ activity: "Recovered" }));
  assert.match(clear.output.take(), /Recovered$/u);

  const timeline = controllerFixture();
  await timeline.controller.render(footerModel());
  timeline.output.take();
  timeline.output.plans.push(true, new Error("timeline failed"));
  await assert.rejects(timeline.controller.writeTimeline("event"), /timeline failed/);
  assert.equal(timeline.controller.renderedLineCount, 0);
  await timeline.controller.render(footerModel({ activity: "Recovered" }));
  assert.equal(timeline.output.take(), `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}ACTIVE 80\r\nRecovered`);

  const redraw = controllerFixture();
  await redraw.controller.render(footerModel());
  redraw.output.take();
  redraw.output.plans.push(true, true, new Error("redraw failed"));
  await assert.rejects(redraw.controller.writeTimeline("event"), /redraw failed/);
  assert.equal(redraw.controller.renderedLineCount, 0);
  await redraw.controller.render(footerModel());
  assert.equal(redraw.output.take(), `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}event\r\nACTIVE 80\r\nRunning tests`);
});

test("cleanup is safe before any render and repeated cleanup writes one newline", async () => {
  const fixture = controllerFixture();
  await Promise.all([fixture.controller.cleanup(), fixture.controller.cleanup()]);
  assert.equal(fixture.output.take(), "\r\n");
  await fixture.controller.cleanup();
  assert.equal(fixture.output.take(), "");
});

test("cleanup becomes idempotent only after clear and newline succeed", async () => {
  const fixture = controllerFixture();
  await fixture.controller.render(footerModel());
  fixture.output.take();
  fixture.output.plans.push(new Error("clear failed"));
  await assert.rejects(fixture.controller.cleanup(), /clear failed/);
  assert.equal(fixture.controller.renderedLineCount, 2);

  fixture.output.plans.push(true, new Error("newline failed"));
  await assert.rejects(fixture.controller.cleanup(), /newline failed/);
  assert.equal(fixture.controller.renderedLineCount, 0);
  assert.equal(fixture.output.take(), `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}`);

  await Promise.all([fixture.controller.cleanup(), fixture.controller.cleanup()]);
  assert.equal(fixture.output.take(), "\r\n");
  await fixture.controller.cleanup();
  assert.equal(fixture.output.take(), "");
});

test("accepted asynchronous failure disables the controller and prevents unsafe clearing retries", async () => {
  const fixture = controllerFixture();
  await fixture.controller.render(footerModel());
  fixture.output.take();
  const error = Object.assign(new Error("broken pipe"), { code: "EPIPE" });
  fixture.output.plans.push({ returns: true, callbackError: error, asynchronous: true, emitError: true });

  await assert.rejects(
    fixture.controller.render(footerModel({ activity: "Changed" })),
    (thrown) => thrown === error,
  );
  assert.equal(fixture.controller.failed, true);
  assert.equal(fixture.controller.renderedLineCount, 0);
  const outputAfterFailure = fixture.output.take();
  assert.equal(outputAfterFailure, `${ANSI_CLEAR_LINE}${ANSI_CURSOR_UP}${ANSI_CLEAR_LINE}`);
  assert.equal(fixture.output.listenerCount("error"), 0);
  assert.equal(fixture.output.listenerCount("close"), 0);

  await assert.rejects(fixture.controller.render(footerModel({ activity: "Unsafe retry" })), (thrown) => thrown === error);
  await assert.rejects(fixture.controller.writeTimeline("unsafe event"), (thrown) => thrown === error);
  await assert.rejects(fixture.controller.resize(), (thrown) => thrown === error);
  await fixture.controller.cleanup();
  assert.equal(fixture.output.take(), "");
});

test("real Writable callback EPIPE remains handled through Node's deferred error event", async () => {
  const error = Object.assign(new Error("broken pipe"), { code: "EPIPE" });
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      queueMicrotask(() => callback(error));
    },
  });
  const controller = createLiveFooterController({
    output,
    formatter: (model) => [model.state],
    width: () => 80,
  });

  let rejectionCount = 0;
  const render = controller.render(footerModel()).catch((thrown: unknown) => {
    rejectionCount += 1;
    throw thrown;
  });
  await assert.rejects(render, (thrown) => thrown === error);
  assert.equal(controller.failed, true);
  assert.equal(output.listenerCount("error"), 1);

  await new Promise<void>((resolve) => process.nextTick(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(rejectionCount, 1);
  assert.equal(output.listenerCount("error"), 0);
  assert.equal(output.listenerCount("close"), 0);
  await assert.rejects(controller.render(footerModel({ activity: "Unsafe retry" })), (thrown) => thrown === error);
});

test("callback failure listener cleanup is bounded when a stream emits no error", async () => {
  const fixture = controllerFixture();
  const error = new Error("callback only failure");
  fixture.output.plans.push({ returns: true, callbackError: error, asynchronous: true });

  await assert.rejects(fixture.controller.render(footerModel()), (thrown) => thrown === error);
  assert.equal(fixture.output.listenerCount("error"), 1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fixture.output.listenerCount("error"), 0);
  assert.equal(fixture.output.listenerCount("drain"), 0);
  assert.equal(fixture.output.listenerCount("close"), 0);
});

test("write waits for a successful callback even when write returns true", async () => {
  const fixture = controllerFixture();
  fixture.output.plans.push({ returns: true, asynchronous: true });
  const render = fixture.controller.render(footerModel());
  let completed = false;
  void render.then(() => { completed = true; });
  assert.equal(completed, false);
  await render;
  assert.equal(completed, true);
});

test("backpressure rejects on error or close and preserves EPIPE identity", async () => {
  const epiped = controllerFixture();
  const error = Object.assign(new Error("broken pipe"), { code: "EPIPE" });
  epiped.output.plans.push(false);
  const render = epiped.controller.render(footerModel());
  const epipeRejection = assert.rejects(render, (thrown) => thrown === error && (thrown as NodeJS.ErrnoException).code === "EPIPE");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(epiped.output.listenerCount("error"), 1);
  epiped.output.emit("error", error);
  await epipeRejection;

  const closed = controllerFixture();
  closed.output.plans.push(false);
  const closedRender = closed.controller.render(footerModel());
  const closeRejection = assert.rejects(closedRender, (thrown: unknown) => (thrown as NodeJS.ErrnoException).code === "ERR_STREAM_PREMATURE_CLOSE");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(closed.output.listenerCount("close"), 1);
  closed.output.emit("close");
  await closeRejection;
});

test("controller emits no process listeners, alternate-screen, or cursor-hide sequences", async () => {
  const before = { SIGINT: process.listenerCount("SIGINT"), SIGTERM: process.listenerCount("SIGTERM") };
  const fixture = controllerFixture();
  await fixture.controller.render(footerModel());
  await fixture.controller.writeTimeline("event");
  await fixture.controller.cleanup();
  const output = fixture.output.take();
  assert.deepEqual({ SIGINT: process.listenerCount("SIGINT"), SIGTERM: process.listenerCount("SIGTERM") }, before);
  assert.doesNotMatch(output, /\u001b\[\?(?:1049|25)[hl]/u);
});
