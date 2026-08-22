import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { portablePtyUnavailableReason, runPortablePty } from "./test-process.ts";

async function fixture(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bashguard-browser-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const directory = join(root, "session-a");
  await mkdir(directory);
  await writeFile(join(directory, "session.json"), `${JSON.stringify({ schemaVersion: 1, sessionId: "session-a", repository: "browser-fixture" })}\n`);
  const events = [
    { schemaVersion: 1, id: "start-event", sequence: 1, timestamp: "2026-08-22T12:00:00.000Z", type: "session.started", sessionId: "session-a", payload: {}, capture: { missing: [], redacted: [], truncated: [] } },
    { schemaVersion: 1, id: "shell-event", sequence: 2, timestamp: "2026-08-22T12:00:01.000Z", type: "tool.requested", sessionId: "session-a", toolName: "bash", payload: { input: { command: "npm test" } }, capture: { missing: [], redacted: [], truncated: [] } },
  ];
  await writeFile(join(directory, "events.jsonl"), `${events.map(JSON.stringify).join("\n")}\n`);
  return root;
}

function run(root: string, args: string[]) {
  return spawnSync(process.execPath, ["--experimental-strip-types", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, BASHGUARD_DATA_DIR: root, TERM: "xterm-256color", TZ: "UTC" },
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

test("explicit browse on redirected streams fails visibly without ANSI and offers durable plain commands", async (t) => {
  const root = await fixture(t);
  const result = run(root, ["inspect", "--session-id=session-a", "--browse"]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /\u001b\[/);
  assert.match(result.stderr, /`--browse` requires an interactive terminal/);
  assert.match(result.stderr, /bashguard inspect --session-id=session-a/);
  assert.match(result.stderr, /bashguard inspect --session-id=session-a --event <sequence-or-event-id-prefix>/);
});

test("real PTY browser navigates, searches, filters, reloads, and restores the terminal", async (t) => {
  const unavailable = portablePtyUnavailableReason();
  if (unavailable) return t.skip(unavailable);
  const root = await fixture(t);
  const running = runPortablePty({
    scenario: [
      "stty cols 100 rows 14",
      `BASHGUARD_DATA_DIR=${JSON.stringify(root)} TERM=xterm-256color ${JSON.stringify(process.execPath)} --experimental-strip-types src/cli.ts inspect --session-id=session-a --browse`,
    ].join("\n"),
    timeoutMs: 8_000,
    sendAfterOutput: "BashGuard · browse",
    send: [
      { afterMs: 200, text: "\u001b[B" },
      { afterMs: 300, text: "/npm\r" },
      { afterMs: 400, text: "na??" },
      { afterMs: 650, text: "rG" },
      { afterMs: 850, text: "q" },
    ],
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 650));
  await appendFile(join(root, "session-a", "events.jsonl"), `${JSON.stringify({
    schemaVersion: 1,
    id: "reload-event",
    sequence: 3,
    timestamp: "2026-08-22T12:00:02.000Z",
    type: "tool.completed",
    sessionId: "session-a",
    toolName: "bash",
    payload: { content: "tests passed" },
    capture: { missing: [], redacted: [], truncated: [] },
  })}\n`);
  const result = await running;
  assert.equal(result.exitCode, 0);
  assert.match(result.transcript, /\u001b\[\?1049h\u001b\[\?25l/);
  assert.match(result.transcript, / │ /);
  assert.match(result.transcript, /\/npm\//);
  assert.match(result.transcript, /reload-event/);
  assert.match(result.transcript, /\u001b\[\?25h\u001b\[\?1049l/);
  assert.match(result.transcript, /Inspect selected event:\r?\n  bashguard inspect --session-id=session-a --event reload-event/);
});

test("real PTY browser redraws from split to single pane after resize", async (t) => {
  const unavailable = portablePtyUnavailableReason();
  if (unavailable) return t.skip(unavailable);
  const root = await fixture(t);
  const result = await runPortablePty({
    scenario: [
      "stty cols 100 rows 14",
      "(while ! stty -a < /dev/tty | grep -q -- '-icanon'; do sleep 0.05; done; sleep 0.2; stty cols 79 rows 10 < /dev/tty) &",
      `BASHGUARD_DATA_DIR=${JSON.stringify(root)} TERM=xterm-256color ${JSON.stringify(process.execPath)} --experimental-strip-types src/cli.ts inspect --session-id=session-a --browse`,
    ].join("\n"),
    timeoutMs: 8_000,
    sendAfterOutput: "BashGuard · browse",
    send: [{ afterMs: 700, text: "q" }],
  });
  assert.equal(result.exitCode, 0);
  const frames = result.transcript.split("\u001b[H\u001b[2J").slice(1);
  assert.ok(frames.some((frame) => frame.includes(" │ ")), "expected an initial split-pane frame");
  assert.ok(frames.some((frame) => !frame.includes(" │ ") && frame.includes("▸")), "expected a resized single-pane frame");
  assert.match(result.transcript, /\u001b\[\?25h\u001b\[\?1049l/);
});

test("real PTY narrow browser replaces list with detail and Ctrl+C restores terminal state", async (t) => {
  const unavailable = portablePtyUnavailableReason();
  if (unavailable) return t.skip(unavailable);
  const root = await fixture(t);
  const result = await runPortablePty({
    scenario: [
      "stty cols 79 rows 10",
      `BASHGUARD_DATA_DIR=${JSON.stringify(root)} TERM=xterm-256color ${JSON.stringify(process.execPath)} --experimental-strip-types src/cli.ts inspect --session-id=session-a --browse`,
    ].join("\n"),
    timeoutMs: 8_000,
    sendAfterOutput: "BashGuard · browse",
    send: [
      { afterMs: 200, text: "\r" },
      { afterMs: 400, text: "\u0003" },
    ],
  });
  assert.equal(result.exitCode, 130);
  assert.match(result.transcript, /Event ID/);
  assert.match(result.transcript, /\u001b\[\?25h\u001b\[\?1049l/);
  assert.match(result.transcript, /Inspect selected event:/);
});

test("plain inspect output remains ANSI-free and unchanged when browse is not requested", async (t) => {
  const root = await fixture(t);
  const result = run(root, ["inspect", "--session-id=session-a"]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.doesNotMatch(result.stdout, /\u001b\[/);
  assert.equal(result.stdout, [
    "Inspectable events",
    "",
    " 1  start-ev  12:00:00  Pi session started",
    " 2  shell-ev  12:00:01  Running · npm test",
    "",
    "Inspect by sequence or event ID prefix:",
    "  bashguard inspect --session-id=session-a --event 1",
    "  bashguard inspect --session-id=session-a --event start-ev",
    "",
  ].join("\n"));
});
