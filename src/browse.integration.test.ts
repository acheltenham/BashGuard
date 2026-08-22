import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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
