import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  runAttach,
  type AttachRunnerRuntime,
  type BashGuardEvent,
  type ParsedCommandArgs,
  type SessionSelectionResult,
} from "./cli.ts";
import { footerClearSequence, type LiveFooterModel } from "./live-footer.ts";
import { waitForExit } from "./test-process.ts";

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

function startActiveAttach(
  t: test.TestContext,
  options: ParsedCommandArgs,
  runtime: AttachRunnerRuntime,
): { abort: AbortController; attached: Promise<BashGuardEvent[]> } {
  const abort = new AbortController();
  const attached = runAttach(options, { ...runtime, signal: abort.signal });
  t.after(async () => {
    abort.abort();
    await attached;
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
  }))}\n`);
  await waitForText(captured.text, "Live footer unavailable", abort);
  await appendFile(eventsFile, `${JSON.stringify(event(4, "stop-degrade", "session.shutdown"))}\n`);
  const finalEvents = await attached;
  assert.deepEqual(finalEvents.map((item) => item.id), ["start", "history", "degrade", "stop-degrade"]);
  assert.equal(captured.text().match(/printf degrade-once/gu)?.length, 1);
  assert.match(captured.text(), /Events\s+3/u);
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
