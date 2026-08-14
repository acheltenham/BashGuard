import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { unlinkSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import stringWidth from "string-width";

import {
  runAttach,
  type AttachRunnerRuntime,
  type BashGuardEvent,
  type ParsedCommandArgs,
  type SessionSelectionResult,
} from "./cli.ts";
import { footerClearSequence, type LiveFooterModel } from "./live-footer.ts";
import { portablePtyUnavailableReason, runPortablePty, waitForExit } from "./test-process.ts";

const ANSI_FOOTER = /\u001b\[(?:1A|2K)/u;

function event(sequence: number, id: string, type: string, overrides: Partial<BashGuardEvent> = {}): BashGuardEvent {
  return {
    schemaVersion: 1,
    id,
    sequence,
    timestamp: new Date(Date.now() + sequence).toISOString(),
    type,
    evidence: "observed",
    sessionId: "live-footer-session",
    capture: { missing: [], redacted: [], truncated: [] },
    ...overrides,
  };
}

async function fixture(t: test.TestContext, active = true) {
  const root = await mkdtemp(join(tmpdir(), "bashguard-live-footer-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const sessionId = "live-footer-session";
  const directory = join(root, sessionId);
  const eventsFile = join(directory, "events.jsonl");
  await mkdir(directory, { recursive: true });
  const initial = [
    event(1, "start", "session.started"),
    event(2, "history", "bash.user_requested", { payload: { command: "echo history" } }),
  ];
  await writeFile(eventsFile, `${initial.map((item) => JSON.stringify(item)).join("\n")}\n`);
  const metadata = { sessionId, cwd: "/tmp/live", repository: "live", processId: active ? process.pid : 999_999_999 };
  await writeFile(join(directory, "session.json"), `${JSON.stringify(metadata)}\n`);
  const selection: SessionSelectionResult = {
    selector: sessionId,
    session: { metadata, directory, eventsFile, modifiedAt: Date.now(), active },
  };
  return { eventsFile, initial, selection };
}

function ttyOutput(): PassThrough & { isTTY: true; columns: number } {
  return Object.assign(new PassThrough(), { isTTY: true as const, columns: 80 });
}

function collect(output: PassThrough): { text: () => string } {
  let value = "";
  output.on("data", (chunk) => { value += chunk.toString(); });
  return { text: () => value };
}

type ProcessResult = { stdout: Buffer; stderr: Buffer; exitCode: number | null };

async function runCompletedAttach(dataRoot: string, sessionId: string, noLiveFooter: boolean): Promise<ProcessResult> {
  const runner = [
    'import { parseCommandArgs, runAttach } from "./src/cli.ts";',
    'const output = { isTTY: true, columns: 80, write: (chunk) => process.stdout.write(chunk) };',
    'await runAttach(parseCommandArgs(process.argv.slice(1)), { output, now: () => Date.parse("2026-08-13T12:00:10.000Z") });',
  ].join("\n");
  const args = [
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    runner,
    "attach",
    `--session-id=${sessionId}`,
    ...(noLiveFooter ? ["--no-live-footer"] : []),
  ];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, BASHGUARD_DATA_DIR: dataRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => { stdout.push(chunk); });
  child.stderr.on("data", (chunk: Buffer) => { stderr.push(chunk); });
  const diagnostics = (): { stdout: string; stderr: string } => ({
    stdout: Buffer.concat(stdout).toString(),
    stderr: Buffer.concat(stderr).toString(),
  });
  const exitCode = await waitForExit(child, diagnostics);
  return { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode };
}

async function waitForCondition(input: {
  description: string;
  condition: () => boolean;
  diagnostics: () => unknown;
  abort: AbortController;
  timeoutMs?: number;
}): Promise<void> {
  const deadline = Date.now() + (input.timeoutMs ?? 1_000);
  while (Date.now() < deadline) {
    if (input.condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  input.abort.abort();
  throw new Error(`Timed out waiting for ${input.description}; captured=${JSON.stringify(input.diagnostics())}`);
}

async function settleAttach<T>(
  promise: Promise<T>,
  abort: AbortController,
  diagnostics: () => unknown = () => ({}),
  timeoutMs = 1_000,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(new Error(`Timed out waiting for attach settlement; captured=${JSON.stringify(diagnostics())}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function startActiveAttach(
  t: test.TestContext,
  options: ParsedCommandArgs,
  runtime: AttachRunnerRuntime,
): { abort: AbortController; attached: Promise<BashGuardEvent[]> } {
  const abort = new AbortController();
  const running = runAttach(options, { ...runtime, signal: abort.signal });
  const attached = settleAttach(running, abort);
  t.after(async () => {
    abort.abort();
    await settleAttach(running, abort);
  });
  return { abort, attached };
}

async function waitForText(read: () => string, needle: string, abort: AbortController): Promise<void> {
  await waitForCondition({
    description: JSON.stringify(needle),
    condition: () => read().includes(needle),
    diagnostics: () => ({ output: read() }),
    abort,
  });
}

test("active supported TTY prints header, bounded history, and guidance before the sticky footer", async (t) => {
  const { eventsFile, selection } = await fixture(t);
  const output = ttyOutput();
  const captured = collect(output);
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector, attachHistory: 1 }, {
    selection,
    output,
    term: "xterm-256color",
    pollMs: 5,
  });

  await waitForText(captured.text, "ACTIVE ·", abort);
  const startup = captured.text();
  assert.doesNotMatch(startup, /Live status\n/u);
  assert.ok(startup.indexOf("BashGuard · live") < startup.indexOf("echo history"));
  assert.ok(startup.indexOf("echo history") < startup.indexOf("Following live events"));
  assert.ok(startup.indexOf("Following live events") < startup.indexOf("ACTIVE ·"));
  assert.match(startup, /capture ok .* 2 ev/u);

  await appendFile(eventsFile, `${JSON.stringify(event(3, "stop", "session.shutdown"))}\n`);
  await attached;
});

test("live batches retain normalized append order once and update request/completion and nonnarrated status", async (t) => {
  const { eventsFile, initial, selection } = await fixture(t);
  const output = ttyOutput();
  const captured = collect(output);
  const snapshots: BashGuardEvent[][] = [];
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector, attachHistory: 0 }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
    onSnapshot(events) { snapshots.push(events); },
  });
  await waitForText(captured.text, "2 ev", abort);

  // Neither malformed complete JSON nor an incomplete valid line is evidence.
  const request = event(4, "request", "tool.requested", {
    toolCallId: "call-1",
    toolName: "bash",
    payload: { input: { command: "printf live" } },
    capture: undefined,
  });
  await appendFile(eventsFile, `not-json\n${JSON.stringify(request).slice(0, 30)}`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.doesNotMatch(captured.text(), /awaiting completion evidence/u);
  assert.doesNotMatch(captured.text(), /4 ev/u);

  await appendFile(eventsFile, `${JSON.stringify(request).slice(30)}\n${JSON.stringify(event(5, "quiet", "message.started"))}\n`);
  await waitForText(captured.text, "awaiting completion evidence", abort);
  await waitForText(captured.text, "4 ev", abort);

  const completion = event(6, "completion", "tool.completed", {
    toolCallId: "call-1",
    toolName: "bash",
    payload: { details: { exitCode: 0 } },
  });
  await appendFile(eventsFile, `${JSON.stringify(completion)}\n${JSON.stringify(event(7, "stop", "session.shutdown"))}\n`);
  const finalEvents = await attached;
  const text = captured.text();
  assert.match(text, /printf live/u, "history 0 must still follow new narrated events");
  assert.match(text, /Command complete · exit 0/u);
  assert.match(text, /recorded/u);
  assert.deepEqual(finalEvents.map((item) => item.id), [...initial.map((item) => item.id), "request", "quiet", "completion", "stop"]);
  assert.deepEqual(finalEvents.find((item) => item.id === "request")?.capture, { missing: [], redacted: [], truncated: [] });
  assert.ok(snapshots.some((items) => items.at(-1)?.id === "quiet"), "nonnarrated accepted events rebuild status");
  assert.equal(new Set(finalEvents.map((item) => item.id)).size, finalEvents.length);
});

test("attach awaits injected controller timeline writes and one batch status rebuild", async (t) => {
  const { eventsFile, selection } = await fixture(t);
  const output = ttyOutput();
  const calls: string[] = [];
  let lastRenderedCount: number | undefined;
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector, attachHistory: 0 }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
    createController() {
      return {
        failed: false,
        async writeTimeline(payload: string) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          calls.push(`timeline:${payload.includes("Pi session ended") ? "shutdown" : "request"}`);
        },
        async render(model: LiveFooterModel) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          if (model.eventCount !== lastRenderedCount) {
            lastRenderedCount = model.eventCount;
            calls.push(`render:${model.eventCount}`);
          }
        },
      };
    },
  });
  await waitForCondition({ description: "initial render", condition: () => calls.includes("render:2"), diagnostics: () => ({ calls }), abort });
  await appendFile(eventsFile, `${JSON.stringify(event(3, "request-await", "tool.requested", { toolCallId: "await", toolName: "bash" }))}\n${JSON.stringify(event(4, "quiet-await", "message.started"))}\n`);
  await waitForCondition({ description: "four-event render", condition: () => calls.includes("render:4"), diagnostics: () => ({ calls }), abort });
  await appendFile(eventsFile, `${JSON.stringify(event(5, "stop-await", "session.shutdown"))}\n`);
  await attached;
  assert.deepEqual(calls.filter((call) => call !== "render:2"), [
    "timeline:request",
    "render:4",
    "timeline:shutdown",
    "render:5",
  ]);
});

test("idle polling requests an awaited freshness model only at the one-second policy", async (t) => {
  const { eventsFile, selection } = await fixture(t);
  const output = ttyOutput();
  let currentTime = Date.now();
  const renderedFreshness: string[] = [];
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector }, {
    selection,
    output,
    term: "xterm",
    pollMs: 2,
    now: () => currentTime,
    createController() {
      return {
        failed: false,
        async writeTimeline() {},
        async render(model: LiveFooterModel) {
          await new Promise((resolve) => setTimeout(resolve, 1));
          renderedFreshness.push(model.freshness);
        },
      };
    },
  });
  await waitForCondition({ description: "initial freshness", condition: () => renderedFreshness.length > 0, diagnostics: () => ({ renderedFreshness }), abort });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(renderedFreshness.length, 1);
  currentTime += 999;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(renderedFreshness.length, 1);
  currentTime += 1;
  await waitForCondition({ description: "refreshed freshness", condition: () => renderedFreshness.length >= 2, diagnostics: () => ({ renderedFreshness }), abort });
  assert.equal(renderedFreshness[1], "1s ago");

  await appendFile(eventsFile, `${JSON.stringify(event(3, "stop-refresh", "session.shutdown"))}\n`);
  await attached;
});

test("accepted controller failure visibly degrades without losing or duplicating event evidence", async (t) => {
  const { eventsFile, selection } = await fixture(t);
  const output = ttyOutput();
  const captured = collect(output);
  let failed = false;
  const acceptedPayloads: string[] = [];
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector, attachHistory: 0 }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
    createController() {
      return {
        get failed() { return failed; },
        async render() {},
        async writeTimeline(payload) {
          acceptedPayloads.push(payload);
          failed = true;
          throw Object.assign(new Error("accepted footer write failed"), { accepted: true });
        },
      };
    },
  });
  await waitForText(captured.text, "Following live events", abort);
  await appendFile(eventsFile, `${JSON.stringify(event(3, "degrade", "tool.requested", {
    toolCallId: "degrade-call",
    toolName: "bash",
    payload: { input: { command: "printf degrade-once" } },
  }))}\n${JSON.stringify(event(4, "after-degrade", "bash.user_requested", {
    payload: { command: "echo retained-after-accepted-failure" },
  }))}\n`);
  await waitForText(captured.text, "Live footer unavailable", abort);
  await appendFile(eventsFile, `${JSON.stringify(event(5, "stop-degrade", "session.shutdown"))}\n`);
  const finalEvents = await attached;
  assert.deepEqual(finalEvents.map((item) => item.id), ["start", "history", "degrade", "after-degrade", "stop-degrade"]);
  assert.equal(acceptedPayloads.filter((payload) => payload.includes("printf degrade-once")).length, 1);
  assert.equal(captured.text().match(/retained-after-accepted-failure/gu)?.length, 1);
  assert.equal(captured.text().match(/(?:^|\n)\s*4\s+after-de/gu)?.length, 1, "the unattempted accepted event is replayed once");
  assert.match(captured.text(), /Events\s+4/u);
});

test("plain active fallbacks retain startup status and emit no footer ANSI", async (t) => {
  for (const mode of ["nonTTY", "disabled", "dumb"] as const) {
    await t.test(mode, async (t) => {
      const { eventsFile, selection } = await fixture(t);
      const output = mode === "nonTTY" ? new PassThrough() : ttyOutput();
      const captured = collect(output);
      const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector, noLiveFooter: mode === "disabled" }, {
        selection,
        output,
        term: mode === "dumb" ? "DuMb" : "xterm",
        pollMs: 5,
      });
      await waitForText(captured.text, "Following live events", abort);
      await appendFile(eventsFile, `${JSON.stringify(event(3, `stop-${mode}`, "session.shutdown"))}\n`);
      await attached;
      assert.match(captured.text(), /Live status\n/u);
      assert.match(captured.text(), /State\s+active/u);
      assert.doesNotMatch(captured.text(), ANSI_FOOTER);
    });
  }
});

test("sticky startup and replay use the first event ID occurrence exactly once", async (t) => {
  const { eventsFile, initial, selection } = await fixture(t);
  const duplicateHistory = event(20, "history", "bash.user_requested", { payload: { command: "echo duplicate-startup" } });
  await writeFile(eventsFile, `${[...initial, duplicateHistory].map((item) => JSON.stringify(item)).join("\n")}\n`);
  const output = ttyOutput();
  const captured = collect(output);
  const snapshots: Array<{ ids: string[]; count: number; activity: string }> = [];
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector, allHistory: true }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
    onSnapshot(events, status) {
      snapshots.push({ ids: events.map((item) => item.id), count: status.eventCount, activity: status.activity });
    },
  });

  await waitForText(captured.text, "2 ev", abort);
  assert.equal(captured.text().match(/(?:^|\n)\s*2\s+history\s+/gu)?.length, 1);
  assert.doesNotMatch(captured.text(), /echo duplicate-startup/u);
  assert.deepEqual(snapshots[0], { ids: ["start", "history"], count: 2, activity: "You ran · echo history" });

  const replay = event(21, "history", "bash.user_requested", { payload: { command: "echo duplicate-live" } });
  await appendFile(eventsFile, `${JSON.stringify(replay)}\n${JSON.stringify(event(22, "quiet-dedupe", "message.started"))}\n`);
  await waitForText(captured.text, "3 ev", abort);
  assert.doesNotMatch(captured.text(), /echo duplicate-live/u);
  assert.deepEqual(snapshots.at(-1)?.ids, ["start", "history", "quiet-dedupe"]);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.count), [2, 3]);

  await appendFile(eventsFile, `${JSON.stringify(event(23, "stop-dedupe", "session.shutdown"))}\n`);
  const finalEvents = await attached;
  assert.deepEqual(finalEvents.map((item) => item.id), ["start", "history", "quiet-dedupe", "stop-dedupe"]);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.count), [2, 3, 4]);
});

test("sticky dedupe does not collapse distinct events with empty IDs", async (t) => {
  const { eventsFile, initial, selection } = await fixture(t);
  await writeFile(eventsFile, `${[...initial, event(3, "", "message.started"), event(4, "", "message.ended")].map((item) => JSON.stringify(item)).join("\n")}\n`);
  const output = ttyOutput();
  const captured = collect(output);
  const snapshots: BashGuardEvent[][] = [];
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector, attachHistory: 0 }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
    onSnapshot(events) { snapshots.push([...events]); },
  });

  await waitForText(captured.text, "4 ev", abort);
  assert.equal(snapshots[0]?.filter((item) => item.id === "").length, 2);
  await appendFile(eventsFile, `${JSON.stringify(event(5, "", "message.started"))}\n${JSON.stringify(event(6, "", "message.ended"))}\n${JSON.stringify(event(7, "stop-empty-ids", "session.shutdown"))}\n`);
  const finalEvents = await attached;
  assert.equal(finalEvents.filter((item) => item.id === "").length, 4);
  assert.equal(finalEvents.length, 7);
  assert.equal(snapshots.at(-1)?.length, 7);
});

test("plain attach preserves duplicate startup history and counts", async (t) => {
  const { eventsFile, initial, selection } = await fixture(t);
  const duplicateHistory = event(20, "history", "bash.user_requested", { payload: { command: "echo duplicate-plain" } });
  await writeFile(eventsFile, `${[...initial, duplicateHistory].map((item) => JSON.stringify(item)).join("\n")}\n`);
  const output = new PassThrough();
  const captured = collect(output);
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector, allHistory: true }, {
    selection,
    output,
    pollMs: 5,
  });

  await waitForText(captured.text, "Following live events", abort);
  assert.match(captured.text(), /Events\s+3/u);
  assert.match(captured.text(), /echo history/u);
  assert.match(captured.text(), /echo duplicate-plain/u);
  await appendFile(eventsFile, `${JSON.stringify(event(21, "stop-plain-duplicate", "session.shutdown"))}\n`);
  assert.equal((await attached).length, 4);
});

test("stdout resize redraws real wide, medium, and narrow line counts once and removes its listener", async (t) => {
  const { eventsFile, selection } = await fixture(t);
  const output = ttyOutput();
  const captured = collect(output);
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
  });

  await waitForText(captured.text, "ACTIVE ·", abort);
  assert.equal(output.listenerCount("resize"), 1);
  output.columns = 60;
  output.emit("resize");
  await waitForText(captured.text, footerClearSequence(4), abort);
  assert.match(captured.text().slice(captured.text().indexOf(footerClearSequence(4))), new RegExp(`─{60}`));
  assert.equal(captured.text().split(footerClearSequence(4)).length - 1, 1);

  output.columns = 30;
  output.emit("resize");
  await waitForText(captured.text, footerClearSequence(5), abort);
  assert.match(captured.text().slice(captured.text().indexOf(footerClearSequence(5))), /ACTIVE ·/u);
  assert.equal(captured.text().split(footerClearSequence(5)).length - 1, 1);

  await appendFile(eventsFile, `${JSON.stringify(event(3, "stop-resize", "session.shutdown"))}\n`);
  await attached;
  assert.equal(output.listenerCount("resize"), 0);
});

test("rapid resize widths coalesce behind a blocked timeline write and finish at the latest width", async (t) => {
  const { eventsFile, selection } = await fixture(t);
  const output = ttyOutput();
  const calls: string[] = [];
  let releaseWrite!: () => void;
  const blockedWrite = new Promise<void>((resolve) => { releaseWrite = resolve; });
  let timelineStarted = false;
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector, attachHistory: 0 }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
    createController() {
      return {
        failed: false,
        async render(model) { calls.push(`render:${model.eventCount}:${output.columns}`); },
        async writeTimeline() {
          timelineStarted = true;
          await blockedWrite;
        },
        async resize() { calls.push(`resize:${output.columns}`); },
      };
    },
  });
  await waitForCondition({ description: "initial footer render", condition: () => calls.includes("render:2:80"), diagnostics: () => ({ calls }), abort });
  await appendFile(eventsFile, `${JSON.stringify(event(3, "blocked-resize", "bash.user_requested", { payload: { command: "echo blocked" } }))}\n`);
  await waitForCondition({ description: "blocked timeline write", condition: () => timelineStarted, diagnostics: () => ({ calls }), abort });
  output.columns = 50;
  output.emit("resize");
  output.columns = 30;
  output.emit("resize");
  releaseWrite();
  await waitForCondition({ description: "latest resize", condition: () => calls.includes("resize:30"), diagnostics: () => ({ calls }), abort });
  assert.deepEqual(calls.filter((call) => call.startsWith("resize:")), ["resize:30"]);
  assert.ok(calls.includes("render:3:30"), JSON.stringify(calls));
  await appendFile(eventsFile, `${JSON.stringify(event(4, "stop-blocked-resize", "session.shutdown"))}\n`);
  await attached;
});

test("resize backpressure retains a newer dirty width and reruns", async (t) => {
  const { eventsFile, selection } = await fixture(t);
  const output = ttyOutput();
  const widths: number[] = [];
  let releaseResize!: () => void;
  const blockedResize = new Promise<void>((resolve) => { releaseResize = resolve; });
  let firstResizeStarted = false;
  let initialized = false;
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
    createController() {
      return {
        failed: false,
        async render() { initialized = true; },
        async writeTimeline() {},
        async resize() {
          widths.push(output.columns);
          if (!firstResizeStarted) {
            firstResizeStarted = true;
            await blockedResize;
          }
        },
      };
    },
  });
  await waitForCondition({ description: "initial render before resize", condition: () => initialized, diagnostics: () => ({ widths }), abort });
  output.columns = 50;
  output.emit("resize");
  await waitForCondition({ description: "first blocked resize", condition: () => firstResizeStarted, diagnostics: () => ({ widths }), abort });
  output.columns = 30;
  output.emit("resize");
  releaseResize();
  await waitForCondition({ description: "rerender at newest width", condition: () => widths.at(-1) === 30, diagnostics: () => ({ widths }), abort });
  assert.deepEqual(widths, [50, 30]);
  await appendFile(eventsFile, `${JSON.stringify(event(3, "stop-resize-backpressure", "session.shutdown"))}\n`);
  await attached;
});

test("concurrent resize and accepted timeline failure degrade atomically once", async (t) => {
  const { eventsFile, selection } = await fixture(t);
  const output = ttyOutput();
  const captured = collect(output);
  let rejectWrite!: (error: Error) => void;
  const blockedWrite = new Promise<void>((_, reject) => { rejectWrite = reject; });
  let timelineStarted = false;
  let failed = false;
  let resizeCalls = 0;
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector, attachHistory: 0 }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
    createController() {
      return {
        get failed() { return failed; },
        async render() {},
        async writeTimeline() {
          timelineStarted = true;
          await blockedWrite;
        },
        async resize() { resizeCalls += 1; },
      };
    },
  });
  await waitForText(captured.text, "Following live events", abort);
  await appendFile(eventsFile, `${JSON.stringify(event(3, "timeline-race", "bash.user_requested", { payload: { command: "echo race" } }))}\n`);
  await waitForCondition({ description: "racing timeline write", condition: () => timelineStarted, diagnostics: () => ({ resizeCalls }), abort });
  output.columns = 50;
  output.emit("resize");
  output.columns = 30;
  output.emit("resize");
  failed = true;
  rejectWrite(Object.assign(new Error("accepted concurrent failure"), { accepted: true }));
  await waitForText(captured.text, "Live footer unavailable", abort);
  assert.equal(captured.text().match(/Live footer unavailable/gu)?.length, 1);
  assert.equal(captured.text().match(/Live status\n/gu)?.length, 1);
  assert.equal(resizeCalls, 0);
  await appendFile(eventsFile, `${JSON.stringify(event(4, "stop-timeline-race", "session.shutdown"))}\n`);
  await attached;
  assert.equal(captured.text().match(/Live footer unavailable/gu)?.length, 1);
});

test("recorded shutdown clears sticky output and prints exactly one final grounded ordinary block", async (t) => {
  const { eventsFile, selection } = await fixture(t);
  const output = ttyOutput();
  const captured = collect(output);
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
  });
  await waitForText(captured.text, "ACTIVE ·", abort);
  await appendFile(eventsFile, `${JSON.stringify(event(3, "recorded-stop", "session.shutdown"))}\n`);
  await attached;

  const text = captured.text();
  assert.equal(text.match(/Session status\n/gu)?.length, 1);
  assert.equal(text.match(/State\s+complete/gu)?.length, 1);
  assert.ok(text.includes(`${footerClearSequence(4)}\r\nSession status\n`), JSON.stringify(text));
  assert.doesNotMatch(text, /State\s+active[^]*Session status\n[^]*State\s+active/u);
});

test("recorded shutdown finalizes from the accepted snapshot when confirmation stat fails", async (t) => {
  const { eventsFile, selection } = await fixture(t);
  const output = ttyOutput();
  const captured = collect(output);
  const signals = new EventEmitter();
  const abort = new AbortController();
  let removed = false;
  const running = runAttach({ command: "attach", sessionId: selection.selector }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
    signal: abort.signal,
    signalSource: signals,
    onSnapshot(events) {
      if (!removed && events.some((item) => item.type === "session.shutdown")) {
        removed = true;
        unlinkSync(eventsFile);
      }
    },
  });
  const attached = settleAttach(running, abort, () => ({ output: captured.text(), removed }));
  t.after(async () => {
    abort.abort();
    await settleAttach(running, abort);
  });

  await waitForText(captured.text, "ACTIVE ·", abort);
  assert.equal(signals.listenerCount("SIGINT"), 1);
  await appendFile(eventsFile, `${JSON.stringify(event(3, "removed-stop", "session.shutdown"))}\n`);
  await attached;
  const text = captured.text();
  assert.equal(text.match(/Session status\n/gu)?.length, 1);
  assert.equal(text.match(/State\s+complete/gu)?.length, 1);
  assert.ok(text.includes(`${footerClearSequence(4)}\r\nSession status\n`), JSON.stringify(text));
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(output.listenerCount("resize"), 0);
});

test("accepted shutdown rereads replacement metadata after a failed confirmation stat", async (t) => {
  const { eventsFile, selection } = await fixture(t);
  const replacementPid = 424_242;
  const output = ttyOutput();
  const captured = collect(output);
  let metadataReads = 0;
  let failConfirmation = false;
  const replacementMetadata = { ...selection.session.metadata, processId: replacementPid };
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector, attachHistory: 0 }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
    isProcessAlive(pid) { return pid === process.pid || pid === replacementPid; },
    async statEventsFile() {
      if (failConfirmation) {
        failConfirmation = false;
        throw Object.assign(new Error("controlled missing stream"), { code: "ENOENT" });
      }
      return await stat(eventsFile);
    },
    async readSessionMetadata() {
      metadataReads += 1;
      if (metadataReads === 1) {
        failConfirmation = true;
        return selection.session.metadata;
      }
      if (metadataReads === 2) {
        await appendFile(eventsFile, `${JSON.stringify(event(1, "raced-replacement-start", "session.started"))}\n`);
        return replacementMetadata;
      }
      return replacementMetadata;
    },
  });
  await waitForText(captured.text, "ACTIVE ·", abort);
  await appendFile(eventsFile, `${JSON.stringify(event(3, "old-raced-stop", "session.shutdown"))}\n`);
  await waitForText(captured.text, "raced-re", abort);
  assert.equal(metadataReads >= 2, true);
  await appendFile(eventsFile, `${JSON.stringify(event(2, "raced-replacement-stop", "session.shutdown"))}\n`);
  const finalEvents = await attached;
  assert.ok(finalEvents.some((item) => item.id === "raced-replacement-start"));
  assert.equal(captured.text().match(/Session status\n/gu)?.length, 1);
});

test("a pre-shutdown stat failure adopts a live replacement and keeps following", async (t) => {
  const { eventsFile, selection } = await fixture(t);
  const replacementPid = 515_151;
  const output = ttyOutput();
  let statCalls = 0;
  let metadataReads = 0;
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
    isProcessAlive(pid) { return pid === replacementPid; },
    async statEventsFile() {
      statCalls += 1;
      if (statCalls === 1) throw Object.assign(new Error("transient missing stream"), { code: "ENOENT" });
      return await stat(eventsFile);
    },
    async readSessionMetadata() {
      metadataReads += 1;
      return { ...selection.session.metadata, processId: replacementPid };
    },
  });
  await waitForCondition({ description: "replacement adoption", condition: () => metadataReads === 1, diagnostics: () => ({ statCalls, metadataReads }), abort });
  await appendFile(eventsFile, `${JSON.stringify(event(3, "adopted-replacement-stop", "session.shutdown"))}\n`);
  const finalEvents = await attached;
  assert.ok(statCalls > 1);
  assert.equal(finalEvents.at(-1)?.id, "adopted-replacement-stop");
});

test("PID death plus a missing events file settles without an unbounded poll", async (t) => {
  const { selection } = await fixture(t);
  const output = ttyOutput();
  const captured = collect(output);
  let statCalls = 0;
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
    isProcessAlive: () => false,
    async statEventsFile() {
      statCalls += 1;
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    async readSessionMetadata() { return selection.session.metadata; },
  });
  await waitForText(captured.text, "ACTIVE ·", abort);
  await attached;
  assert.equal(statCalls, 1);
  assert.equal(captured.text().match(/Session status\n/gu)?.length, 1);
  assert.match(captured.text(), /State\s+complete/u);
});

test("PID death without shutdown finalizes honestly from process evidence", async (t) => {
  const { selection } = await fixture(t);
  const output = ttyOutput();
  const captured = collect(output);
  let alive = true;
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
    isProcessAlive: () => alive,
  });
  await waitForText(captured.text, "ACTIVE ·", abort);
  alive = false;
  await attached;

  assert.equal(captured.text().match(/Session status\n/gu)?.length, 1);
  assert.match(captured.text(), /State\s+complete/u);
  assert.match(captured.text(), /Last activity\s+You ran · echo history/u);
  assert.doesNotMatch(captured.text(), /completion recorded|Command complete/u);
});

test("injected SIGINT clears the footer, sets conventional status, stops the loop, and removes handlers", async (t) => {
  const { selection } = await fixture(t);
  const output = ttyOutput();
  const captured = collect(output);
  const signals = new EventEmitter();
  let exitCode: number | undefined;
  const abort = new AbortController();
  const running = runAttach({ command: "attach", sessionId: selection.selector }, {
    selection,
    output,
    term: "xterm",
    pollMs: 60_000,
    signal: abort.signal,
    signalSource: signals,
    setExitCode(code) { exitCode = code; },
  });
  const attached = settleAttach(running, abort, () => ({ output: captured.text(), exitCode }));
  t.after(async () => {
    abort.abort();
    await settleAttach(running, abort);
  });
  await waitForText(captured.text, "ACTIVE ·", abort);
  assert.equal(signals.listenerCount("SIGINT"), 1);
  signals.emit("SIGINT");
  await attached;

  assert.equal(exitCode, 130);
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(output.listenerCount("resize"), 0);
  assert.ok(captured.text().endsWith(`${footerClearSequence(4)}\r\n`));
  assert.doesNotMatch(captured.text(), /Session status|Error:|at runAttach/u);
});

test("unexpected errors clear the footer before propagating and remove lifecycle listeners", async (t) => {
  const { eventsFile, selection } = await fixture(t);
  const output = ttyOutput();
  const captured = collect(output);
  const signals = new EventEmitter();
  let snapshots = 0;
  const abort = new AbortController();
  const running = runAttach({ command: "attach", sessionId: selection.selector }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
    signal: abort.signal,
    signalSource: signals,
    onSnapshot() {
      snapshots += 1;
      if (snapshots > 1) throw new Error("snapshot exploded");
    },
  });
  const attached = settleAttach(running, abort, () => ({ output: captured.text(), snapshots }));
  t.after(async () => {
    abort.abort();
    await settleAttach(running, abort).catch(() => undefined);
  });
  await waitForText(captured.text, "ACTIVE ·", abort);
  await appendFile(eventsFile, `${JSON.stringify(event(3, "explode", "message.started"))}\n`);
  await assert.rejects(attached, /snapshot exploded/);
  assert.ok(captured.text().endsWith(`${footerClearSequence(4)}\r\n`));
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(output.listenerCount("resize"), 0);
});

test("EPIPE degradation performs no recursive output or cleanup", async (t) => {
  const { selection } = await fixture(t);
  const output = ttyOutput();
  const captured = collect(output);
  const error = Object.assign(new Error("broken pipe"), { code: "EPIPE" });
  let cleanupCalls = 0;
  const abort = new AbortController();
  const running = runAttach({ command: "attach", sessionId: selection.selector }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
    signal: abort.signal,
    createController() {
      return {
        failed: true,
        async render() { throw error; },
        async writeTimeline() { throw error; },
        async cleanup() { cleanupCalls += 1; },
      };
    },
  });
  t.after(async () => {
    abort.abort();
    await settleAttach(running, abort);
  });
  await settleAttach(running, abort);
  assert.equal(cleanupCalls, 0);
  assert.doesNotMatch(captured.text(), /Live footer unavailable|broken pipe|Error:/u);
  assert.equal(output.listenerCount("resize"), 0);
});

test("aborting active attach exits promptly and clears the rendered footer", async (t) => {
  const { selection } = await fixture(t);
  const output = ttyOutput();
  const captured = collect(output);
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector }, {
    selection,
    output,
    term: "xterm",
    pollMs: 60_000,
  });

  await waitForText(captured.text, "ACTIVE ·", abort);
  abort.abort();
  await attached;
  assert.ok(captured.text().endsWith(`${footerClearSequence(4)}\r\n`), JSON.stringify(captured.text()));
});

test("sticky attach follows recorder replacement with repeated sequences and ordered async writes", async (t) => {
  const { eventsFile, selection } = await fixture(t);
  const replacement = spawn(process.execPath, ["--eval", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  t.after(() => { replacement.kill(); });
  assert.ok(replacement.pid);
  const output = ttyOutput();
  const calls: string[] = [];
  let settled = false;
  const { abort, attached } = startActiveAttach(t, { command: "attach", sessionId: selection.selector, attachHistory: 0 }, {
    selection,
    output,
    term: "xterm",
    pollMs: 10,
    createController() {
      return {
        failed: false,
        async writeTimeline(payload) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          calls.push(`timeline:${payload}`);
        },
        async render(model) {
          await new Promise((resolve) => setTimeout(resolve, 2));
          calls.push(`render:${model.eventCount}:${model.state}`);
        },
      };
    },
  });
  void attached.then(() => { settled = true; });
  await waitForCondition({ description: "replacement test initial render", condition: () => calls.includes("render:2:ACTIVE"), diagnostics: () => ({ calls }), abort });

  const oldShutdown = event(3, "old-shutdown", "session.shutdown");
  await appendFile(eventsFile, `${JSON.stringify(oldShutdown)}\n`);
  await writeFile(join(selection.session.directory, "session.json"), `${JSON.stringify({
    ...selection.session.metadata,
    processId: replacement.pid,
    startedAt: new Date(Date.parse(oldShutdown.timestamp) + 1_000).toISOString(),
  })}\n`);
  const replacementStart = event(1, "replacement-start", "session.started");
  const replay = event(2, "history", "bash.user_requested", { payload: { command: "echo replay-must-not-render" } });
  const replacementRequest = event(2, "replacement-request", "tool.requested", {
    toolCallId: "replacement-call",
    toolName: "bash",
    payload: { input: { command: "printf replacement-live" } },
  });
  await appendFile(eventsFile, `${[replacementStart, replay, replacementRequest].map((item) => JSON.stringify(item)).join("\n")}\n`);

  await waitForCondition({
    description: "replacement request and five-event render",
    condition: () => calls.some((call) => call.includes("printf replacement-live")) && calls.includes("render:5:ACTIVE"),
    diagnostics: () => ({ calls, settled }),
    abort,
  });
  assert.equal(settled, false, JSON.stringify(calls));
  assert.equal(calls.filter((call) => call.includes("replay-must-not-render")).length, 0);
  const renderIndex = calls.indexOf("render:5:ACTIVE");
  assert.ok(calls.slice(0, renderIndex).some((call) => call.includes("Pi session ended")));
  assert.ok(calls.slice(0, renderIndex).some((call) => call.includes("Pi session started")));
  assert.ok(calls.slice(0, renderIndex).some((call) => call.includes("printf replacement-live")));

  await appendFile(eventsFile, `${JSON.stringify(event(3, "replacement-stop", "session.shutdown"))}\n`);
  const finalEvents = await attached;
  assert.deepEqual(finalEvents.map((item) => item.id), [
    "start", "history", "old-shutdown", "replacement-start", "replacement-request", "replacement-stop",
  ]);
});

test("completed attach preserves plain static output in a TTY", async (t) => {
  const { selection } = await fixture(t, false);
  const output = ttyOutput();
  const captured = collect(output);
  await runAttach({ command: "attach", sessionId: selection.selector }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
  });
  assert.match(captured.text(), /^BashGuard · completed\n/u);
  assert.match(captured.text(), /Session status\n/u);
  assert.match(captured.text(), /State\s+complete/u);
  assert.doesNotMatch(captured.text(), ANSI_FOOTER);
});

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function stripAnsiControls(value: string): string {
  return value.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/gu, "");
}

function stripTerminalControls(value: string): string {
  return stripAnsiControls(value).replace(/\r/gu, "");
}

type ParsedPtyFooter = { start: number; end: number; separator: string; content: string[] };

function parseSeparatedPtyFooters(raw: string, width: number): ParsedPtyFooter[] {
  const pattern = new RegExp(`(?<!─)(─{${width}})(?!─)\\r+\\n([^\\u001b]*)`, "gu");
  return [...raw.matchAll(pattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    separator: match[1],
    content: match[2]
      .split(/\r+\n/gu)
      .map((line) => line.replace(/\r+$/u, ""))
      .filter((line) => line.length > 0),
  }));
}

function outputOccurrenceTimes(
  chunks: readonly { afterMs: number; stream: "stdout" | "stderr"; text: string }[],
  needle: string,
): { index: number; afterMs: number }[] {
  const ordered = chunks.filter((chunk) => chunk.stream === "stdout");
  const combined = ordered.map((chunk) => chunk.text).join("");
  const chunkEnds: { end: number; afterMs: number }[] = [];
  let end = 0;
  for (const chunk of ordered) {
    end += chunk.text.length;
    chunkEnds.push({ end, afterMs: chunk.afterMs });
  }

  const occurrences: { index: number; afterMs: number }[] = [];
  for (let index = combined.indexOf(needle); index >= 0; index = combined.indexOf(needle, index + needle.length)) {
    const completion = index + needle.length;
    occurrences.push({ index, afterMs: chunkEnds.find((chunk) => chunk.end >= completion)?.afterMs ?? -1 });
  }
  return occurrences;
}

async function writePtyEvent(path: string, value: BashGuardEvent): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

function requirePortablePty(t: test.TestContext): boolean {
  const unavailable = portablePtyUnavailableReason();
  if (!unavailable) return true;
  t.skip(unavailable);
  return false;
}

test("real PTY live footer updates, resizes, stays bounded, and finalizes ordinarily", async (t) => {
  if (!requirePortablePty(t)) return;
  const { eventsFile, selection } = await fixture(t);
  const requestPath = `${eventsFile}.request`;
  const completionPath = `${eventsFile}.completion`;
  const shutdownPath = `${eventsFile}.shutdown`;
  const callId = "pty-live-call";
  await writePtyEvent(requestPath, event(3, "pty-request", "tool.requested", {
    toolName: "bash",
    toolCallId: callId,
    payload: { toolCallId: callId, input: { command: "printf pty-live-update" } },
  }));
  await writePtyEvent(completionPath, event(4, "pty-completion", "tool.completed", {
    toolName: "bash",
    toolCallId: callId,
    payload: { toolCallId: callId, isError: false, details: { exitCode: 0 } },
  }));
  await writePtyEvent(shutdownPath, event(5, "pty-shutdown", "session.shutdown"));

  const bin = join(process.cwd(), "bin", "bashguard");
  const result = await runPortablePty({
    timeoutMs: 12_000,
    env: { BASHGUARD_DATA_DIR: join(selection.session.directory, ".."), TERM: "xterm-256color" },
    scenario: [
      "stty columns 80 rows 24",
      `${shellQuote(bin)} attach --session-id=${shellQuote(selection.selector)} &`,
      "attach_pid=$!",
      "sleep 2.2",
      `cat ${shellQuote(requestPath)} >> ${shellQuote(eventsFile)}`,
      "sleep 0.7",
      "stty columns 50 < /dev/tty",
      "kill -WINCH \"$attach_pid\"",
      "sleep 0.5",
      `cat ${shellQuote(completionPath)} >> ${shellQuote(eventsFile)}`,
      "sleep 0.7",
      "stty columns 35 < /dev/tty",
      "kill -WINCH \"$attach_pid\"",
      "sleep 0.5",
      `cat ${shellQuote(shutdownPath)} >> ${shellQuote(eventsFile)}`,
      "wait \"$attach_pid\"",
    ].join("\n"),
  });
  assert.equal(result.exitCode, 0, `raw=${JSON.stringify(result.raw)}\ntranscript=${JSON.stringify(result.transcript)}`);
  assert.ok(result.transcript.length > 0, "system script must capture a PTY transcript");

  const plain = stripTerminalControls(result.raw);
  assert.match(result.raw, /\u001b\[(?:1A|2K)/u, "real TTY should use sticky-footer controls");

  const requestTimeline = / 3  pty-requ  \d{2}:\d{2}:\d{2}  Running · printf pty-live-update/u.exec(result.raw);
  const completionTimeline = / 4  pty-comp  \d{2}:\d{2}:\d{2}  Command complete · exit 0/u.exec(result.raw);
  assert.ok(requestTimeline?.index !== undefined, "prefixed request timeline line must exist");
  assert.ok(completionTimeline?.index !== undefined, "prefixed completion timeline line must exist");

  const wideFooters = parseSeparatedPtyFooters(result.raw, 80);
  assert.ok(wideFooters.length >= 2, `missing 80-column footer renders: ${JSON.stringify(result.raw)}`);
  for (const footer of wideFooters) {
    assert.equal(footer.separator.length, 80);
    assert.equal(footer.content.length, 3, `80-column footer must have separator + 3 content lines: ${JSON.stringify(footer)}`);
    assert.ok(footer.content.every((line) => stringWidth(line) <= 80), JSON.stringify(footer));
  }
  const requestFooter = wideFooters.find((footer) => footer.start > requestTimeline.index
    && footer.content.includes("ACTIVE · Running · printf pty-live-update"));
  assert.ok(requestFooter, "request timeline line must precede its subsequent activity footer render");
  assert.ok(requestTimeline.index < requestFooter.start);

  const wideSeparator = "─".repeat(80);
  const wideTimes = outputOccurrenceTimes(result.outputChunks, wideSeparator);
  const requestChunkTime = outputOccurrenceTimes(result.outputChunks, requestTimeline[0])[0];
  const idleWideTimes = requestChunkTime === undefined
    ? []
    : wideTimes.filter((render) => render.index < requestChunkTime.index);
  assert.ok(idleWideTimes.length >= 2, `expected an idle freshness redraw: ${JSON.stringify(idleWideTimes)}`);
  assert.ok(
    idleWideTimes[1].afterMs - idleWideTimes[0].afterMs >= 750,
    `idle redraw was too fast: ${JSON.stringify(idleWideTimes)}`,
  );
  assert.ok(idleWideTimes.length <= 4, `idle footer wrote too often (possible 250ms spam): ${JSON.stringify(idleWideTimes)}`);

  const mediumFooters = parseSeparatedPtyFooters(result.raw, 50);
  assert.ok(mediumFooters.length > 0, "resize must render a 50-column footer");
  for (const footer of mediumFooters) {
    assert.ok(footer.content.length >= 1 && footer.content.length <= 4, `unexpected medium footer lines: ${JSON.stringify(footer)}`);
    assert.ok(
      [footer.separator, ...footer.content].every((line) => stringWidth(line) <= 50),
      `50-column footer overflowed: ${JSON.stringify(footer)}`,
    );
  }
  const completionFooter = mediumFooters.find((footer) => footer.start > completionTimeline.index
    && footer.content.includes("ACTIVE · Command complete · exit 0"));
  assert.ok(completionFooter, "completion timeline line must precede its subsequent activity footer render");
  assert.ok(completionTimeline.index < completionFooter.start);

  const lastMediumEnd = mediumFooters.at(-1)?.end ?? -1;
  const shutdownTimelineIndex = result.raw.search(/ 5  pty-shut  \d{2}:\d{2}:\d{2}  Pi session ended/u);
  assert.ok(lastMediumEnd >= 0 && shutdownTimelineIndex > lastMediumEnd, "narrow resize boundaries must exist");
  const narrowResizeRegion = result.raw.slice(lastMediumEnd, shutdownTimelineIndex);
  assert.doesNotMatch(narrowResizeRegion, /─/u, "35-column layout has no separator");
  const narrowRenderLines = stripAnsiControls(narrowResizeRegion)
    .split(/\r+\n?/gu)
    .filter((line) => line.length > 0);
  assert.ok(narrowRenderLines.length > 0, `missing 35-column resize render: ${JSON.stringify(narrowResizeRegion)}`);
  assert.ok(
    narrowRenderLines.every((line) => line === "ACTIVE · Command complete · exit 0"),
    `each 35-column render must contain exactly one status line: ${JSON.stringify(narrowResizeRegion)}`,
  );
  assert.ok(narrowRenderLines.every((line) => stringWidth(line) <= 35), `35-column footer overflowed: ${JSON.stringify(narrowRenderLines)}`);

  const finalStatus = plain.lastIndexOf("Session status");
  assert.ok(finalStatus > plain.lastIndexOf("ACTIVE"), "final ordinary status must replace the temporary footer");
  assert.match(plain.slice(finalStatus), /State\s+complete/u);
  assert.equal(plain.slice(finalStatus).match(/Session status/gu)?.length, 1);
  assert.doesNotMatch(result.raw, /\u001b\[\?(?:25l|47h|1047h|1049h)/u);
});

test("real PTY Ctrl+C clears the footer without terminal-mode leakage or a dangling fragment", async (t) => {
  if (!requirePortablePty(t)) return;
  const { selection } = await fixture(t);
  const bin = join(process.cwd(), "bin", "bashguard");
  const result = await runPortablePty({
    timeoutMs: 7_000,
    env: { BASHGUARD_DATA_DIR: join(selection.session.directory, ".."), TERM: "xterm" },
    scenario: [
      "stty columns 80 rows 24",
      `exec ${shellQuote(bin)} attach --session-id=${shellQuote(selection.selector)}`,
    ].join("\n"),
    send: [{ afterMs: 1_200, text: "\u0003" }],
  });
  const footerRenders = parseSeparatedPtyFooters(result.raw, 80);
  const finalRender = footerRenders.at(-1);
  assert.ok(finalRender, `expected a final footer render: ${JSON.stringify(result.raw)}`);
  const finalClearPattern = /\u001b\[2K(?:\u001b\[1A\r\u001b\[2K){3}/gu;
  const finalClear = [...result.raw.matchAll(finalClearPattern)]
    .find((match) => match.index >= finalRender.end);
  assert.ok(finalClear, `footer clear must follow the final render: ${JSON.stringify(result.raw)}`);
  const afterFinalClear = result.raw.slice(finalClear.index + finalClear[0].length);
  assert.match(afterFinalClear, /^\r{1,2}\n/u, `footer clear must be followed by a normal CRLF: ${JSON.stringify(afterFinalClear)}`);
  assert.doesNotMatch(
    stripTerminalControls(afterFinalClear),
    /ACTIVE|─{3}|awaiting completion evidence|capture ok|recorded/u,
    `footer content appeared after final clear: ${JSON.stringify(afterFinalClear)}`,
  );
  assert.doesNotMatch(result.raw, /\u001b\[\?(?:25l|47h|1047h|1049h)/u);
  assert.ok(/(?:\r?\n)+$/u.test(result.transcript), `expected normal final newline: ${JSON.stringify(result.transcript)}`);
  assert.ok([0, 2, 130].includes(result.exitCode ?? -1), `unexpected Ctrl+C wrapper status ${result.exitCode}; ${JSON.stringify(result.raw)}`);
});

test("real PTY --no-live-footer and redirected stdout remain static and footer-ANSI-free", async (t) => {
  if (!requirePortablePty(t)) return;
  const bin = join(process.cwd(), "bin", "bashguard");

  for (const redirected of [false, true]) {
    const { eventsFile, selection } = await fixture(t);
    const shutdownPath = `${eventsFile}.plain-shutdown`;
    const outputPath = `${eventsFile}.redirected-output`;
    await writePtyEvent(shutdownPath, event(3, `pty-plain-shutdown-${redirected}`, "session.shutdown"));
    const redirect = redirected ? ` > ${shellQuote(outputPath)}` : "";
    const optOut = redirected ? "" : " --no-live-footer";
    const result = await runPortablePty({
      timeoutMs: 7_000,
      env: { BASHGUARD_DATA_DIR: join(selection.session.directory, ".."), TERM: "xterm" },
      scenario: [
        "stty columns 80 rows 24",
        `(sleep 0.8; cat ${shellQuote(shutdownPath)} >> ${shellQuote(eventsFile)}) &`,
        `${shellQuote(bin)} attach --session-id=${shellQuote(selection.selector)}${optOut}${redirect}`,
        ...(redirected ? [`cat ${shellQuote(outputPath)}`] : []),
      ].join("\n"),
    });
    assert.equal(result.exitCode, 0, JSON.stringify(result.raw));
    const plain = stripTerminalControls(result.raw);
    assert.match(plain, /Live status/u);
    assert.match(plain, /State\s+active/u);
    assert.doesNotMatch(result.raw, /\u001b\[(?:1A|2K)/u, redirected ? "redirected stdout" : "--no-live-footer");
  }
});

test("completed attach output is byte-identical with the live footer enabled or disabled", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "bashguard-completed-footer-parity-"));
  t.after(async () => rm(dataRoot, { recursive: true, force: true }));
  const sessionId = "completed-footer-parity-session";
  const directory = join(dataRoot, sessionId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "session.json"), `${JSON.stringify({
    schemaVersion: 1,
    sessionId,
    cwd: "/tmp/completed-footer-parity",
    repository: "completed-footer-parity",
    processId: 999_999_999,
  })}\n`);
  const completedEvents = [
    event(1, "parity-start", "session.started", { sessionId, timestamp: "2026-08-13T12:00:00.000Z" }),
    event(2, "parity-command", "bash.user_requested", {
      sessionId,
      timestamp: "2026-08-13T12:00:01.000Z",
      payload: { command: "printf deterministic-completed-output" },
    }),
    event(3, "parity-stop", "session.shutdown", { sessionId, timestamp: "2026-08-13T12:00:02.000Z" }),
  ];
  await writeFile(join(directory, "events.jsonl"), `${completedEvents.map((item) => JSON.stringify(item)).join("\n")}\n`);

  const [normal, disabled] = await Promise.all([
    runCompletedAttach(dataRoot, sessionId, false),
    runCompletedAttach(dataRoot, sessionId, true),
  ]);

  assert.equal(normal.exitCode, 0, normal.stderr.toString());
  assert.equal(disabled.exitCode, normal.exitCode);
  assert.deepEqual(disabled.stderr, normal.stderr);
  assert.deepEqual(disabled.stdout, normal.stdout);
  assert.doesNotMatch(normal.stdout.toString(), /\u001b\[[0-?]*[ -/]*[@-~]/u);
});
