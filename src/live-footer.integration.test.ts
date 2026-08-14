import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  runAttach,
  type BashGuardEvent,
  type SessionSelectionResult,
} from "./cli.ts";
import type { LiveFooterModel } from "./live-footer.ts";
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

async function waitFor(read: () => string, needle: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (read().includes(needle)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${JSON.stringify(needle)} in ${JSON.stringify(read())}`);
}

test("active supported TTY prints header, bounded history, and guidance before the sticky footer", async (t) => {
  const { eventsFile, selection } = await fixture(t);
  const output = ttyOutput();
  const captured = collect(output);
  const attached = runAttach({ command: "attach", sessionId: selection.selector, attachHistory: 1 }, {
    selection,
    output,
    term: "xterm-256color",
    pollMs: 5,
  });

  await waitFor(captured.text, "ACTIVE ·");
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
  const attached = runAttach({ command: "attach", sessionId: selection.selector, attachHistory: 0 }, {
    selection,
    output,
    term: "xterm",
    pollMs: 5,
    onSnapshot(events) { snapshots.push(events); },
  });
  await waitFor(captured.text, "2 ev");

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
  await waitFor(captured.text, "awaiting completion evidence");
  await waitFor(captured.text, "4 ev");

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
  const attached = runAttach({ command: "attach", sessionId: selection.selector, attachHistory: 0 }, {
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
  while (!calls.includes("render:2")) await new Promise((resolve) => setTimeout(resolve, 2));
  await appendFile(eventsFile, `${JSON.stringify(event(3, "request-await", "tool.requested", { toolCallId: "await", toolName: "bash" }))}\n${JSON.stringify(event(4, "quiet-await", "message.started"))}\n`);
  while (!calls.includes("render:4")) await new Promise((resolve) => setTimeout(resolve, 2));
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
  const attached = runAttach({ command: "attach", sessionId: selection.selector }, {
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
  while (renderedFreshness.length === 0) await new Promise((resolve) => setTimeout(resolve, 2));
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(renderedFreshness.length, 1);
  currentTime += 999;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(renderedFreshness.length, 1);
  currentTime += 1;
  while (renderedFreshness.length < 2) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(renderedFreshness[1], "1s ago");

  await appendFile(eventsFile, `${JSON.stringify(event(3, "stop-refresh", "session.shutdown"))}\n`);
  await attached;
});

test("accepted controller failure visibly degrades without losing or duplicating event evidence", async (t) => {
  const { eventsFile, selection } = await fixture(t);
  const output = ttyOutput();
  const captured = collect(output);
  let failed = false;
  const attached = runAttach({ command: "attach", sessionId: selection.selector, attachHistory: 0 }, {
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
  await waitFor(captured.text, "Following live events");
  await appendFile(eventsFile, `${JSON.stringify(event(3, "degrade", "tool.requested", {
    toolCallId: "degrade-call",
    toolName: "bash",
    payload: { input: { command: "printf degrade-once" } },
  }))}\n`);
  await waitFor(captured.text, "Live footer unavailable");
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
      const attached = runAttach({ command: "attach", sessionId: selection.selector, noLiveFooter: mode === "disabled" }, {
        selection,
        output,
        term: mode === "dumb" ? "DuMb" : "xterm",
        pollMs: 5,
      });
      await waitFor(captured.text, "Following live events");
      await appendFile(eventsFile, `${JSON.stringify(event(3, `stop-${mode}`, "session.shutdown"))}\n`);
      await attached;
      assert.match(captured.text(), /Live status\n/u);
      assert.match(captured.text(), /State\s+active/u);
      assert.doesNotMatch(captured.text(), ANSI_FOOTER);
    });
  }
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
