import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { waitForExit } from "./test-process.ts";

const cliArgs = ["--experimental-strip-types", "src/cli.ts"];

type StoredSession = {
  id: string;
  active?: boolean;
  modifiedAt?: number;
  command?: string;
};

function event(sessionId: string, sequence: number, type: string, payload: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: `${sessionId}-event-${sequence}`,
    sequence,
    timestamp: `2026-08-13T12:00:0${sequence}.000Z`,
    type,
    evidence: "observed",
    sessionId,
    cwd: "/tmp/session-selection",
    payload,
    capture: { missing: [], redacted: [], truncated: [] },
  };
}

async function writeSession(root: string, session: StoredSession): Promise<void> {
  const directory = join(root, session.id);
  const eventsFile = join(directory, "events.jsonl");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "session.json"), `${JSON.stringify({
    schemaVersion: 1,
    sessionId: session.id,
    repository: "picker-integration",
    name: session.id,
    processId: session.active ? process.pid : undefined,
  })}\n`);
  const events = [
    event(session.id, 1, "session.started"),
    event(session.id, 2, "bash.user_requested", { command: session.command ?? `echo ${session.id}` }),
    {
      ...event(session.id, 3, "tool.requested", { toolCallId: `${session.id}-call`, input: { command: "rm -rf /tmp/bashguard-picker-fixture" } }),
      toolName: "bash",
      toolCallId: `${session.id}-call`,
    },
    ...(session.active ? [] : [event(session.id, 4, "session.shutdown")]),
  ];
  await writeFile(eventsFile, `${events.map((item) => JSON.stringify(item)).join("\n")}\n`);
  if (session.modifiedAt !== undefined) {
    const timestamp = new Date(session.modifiedAt);
    await utimes(eventsFile, timestamp, timestamp);
  }
}

async function store(t: test.TestContext, sessions: StoredSession[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bashguard-session-selection-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  for (const session of sessions) await writeSession(root, session);
  return root;
}

function run(root: string, args: string[]) {
  return spawnSync(process.execPath, [...cliArgs, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, BASHGUARD_DATA_DIR: root },
    encoding: "utf8",
    timeout: 5_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function combined(result: ReturnType<typeof run>): string {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

test("selector-less inspect auto-selects one session and renders its events with a copyable selector", async (t) => {
  const id = "inspect-single-019fc93a";
  const root = await store(t, [{ id, command: "echo inspect-auto-selected" }]);

  const result = run(root, ["inspect"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /inspect-auto-selected/);
  assert.match(result.stdout, new RegExp(`bashguard inspect ${id.slice(0, 8)} --event`));
  assert.doesNotMatch(result.stdout, new RegExp(`bashguard inspect ${id} --event`));
  assert.doesNotMatch(result.stdout, /undefined|Select a session/);
});

test("selector-less debrief auto-selects one session and renders a usable summary", async (t) => {
  const id = "debrief-single-019fc909";
  const root = await store(t, [{ id, command: "echo debrief-auto-selected" }]);

  const result = run(root, ["debrief"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Session complete/);
  assert.match(result.stdout, new RegExp(`bashguard inspect ${id.slice(0, 8)} --event`));
  assert.doesNotMatch(result.stdout, new RegExp(`bashguard inspect ${id} --event`));
  assert.doesNotMatch(result.stdout, /undefined|Select a session/);
});

test("selector-less attach auto-selects its only active session and uses its unique prefix in guidance", async (t) => {
  const id = "019fc911-active-session";
  const prefix = "019fc911-a";
  const root = await store(t, [
    { id: "019fc911-completed-session", modifiedAt: Date.now() },
    { id, active: true, modifiedAt: Date.now() - 1_000, command: "echo attach-auto-selected" },
  ]);
  const child = spawn(process.execPath, [...cliArgs, "attach", "--history", "0"], {
    cwd: process.cwd(),
    env: { ...process.env, BASHGUARD_DATA_DIR: root },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });

  for (let attempt = 0; attempt < 100 && !stdout.includes("Following live events"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.match(stdout, /Following live events/);
  assert.match(stdout, new RegExp(`bashguard inspect ${prefix} --event`));
  assert.doesNotMatch(stdout, new RegExp(`bashguard inspect ${id} --event`));
  assert.doesNotMatch(stdout, /undefined|Select a session/);
  await appendFile(join(root, id, "events.jsonl"), `${JSON.stringify(event(id, 4, "session.shutdown"))}\n`);
  assert.equal(await waitForExit(child, () => ({ stdout, stderr })), 0, stderr);
});

test("piped selector-less commands fail without prompting and print stable copyable choices", async (t) => {
  const now = Date.now();
  const root = await store(t, [
    { id: "active-newest-019fc901", active: true, modifiedAt: now },
    { id: "completed-middle-019fc902", modifiedAt: now - 1_000 },
    { id: "active-oldest-019fc903", active: true, modifiedAt: now - 2_000 },
  ]);

  for (const command of ["inspect", "debrief"] as const) {
    const result = run(root, [command]);
    const output = combined(result);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(output, /Select a session/);
    for (const selector of [1, 2, 3]) {
      assert.match(output, new RegExp(`^${selector}\\s+`, "m"));
      assert.match(output, new RegExp(`bashguard ${command} ${selector}`));
    }
  }

  const attach = run(root, ["attach"]);
  const output = combined(attach);
  assert.notEqual(attach.status, 0);
  assert.doesNotMatch(output, /Select a session|completed-middle/);
  assert.match(output, /^1\s+active\s+/m);
  assert.match(output, /^2\s+active\s+/m);
  assert.match(output, /bashguard attach 1/);
  assert.match(output, /bashguard attach 2/);
  assert.doesNotMatch(output, /^3\s+active\s+/m);
});

test("attach choices render prefixes unique against hidden completed sessions", async (t) => {
  const now = Date.now();
  const activeId = "shared-prefix-active";
  const root = await store(t, [
    { id: activeId, active: true, modifiedAt: now },
    { id: "other-active-session", active: true, modifiedAt: now - 1_000 },
    { id: "shared-prefix-completed", modifiedAt: now - 2_000 },
  ]);

  const attach = run(root, ["attach"]);
  const output = combined(attach);
  assert.notEqual(attach.status, 0);
  assert.match(output, /^1\s+active\s+shared-prefix-a\s+/m);
  assert.doesNotMatch(output, /^1\s+active\s+shared-p\s+/m);
  assert.doesNotMatch(output, /shared-prefix-completed/);

  const inspect = run(root, ["inspect", "shared-prefix-a"]);
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.match(inspect.stdout, new RegExp(activeId));
});

test("global session order is active-first and newest-first within each state", async (t) => {
  const now = Date.now();
  const orderedSessions = [
    { selector: 1, id: "newer-active-019fc921", command: "echo newer-active" },
    { selector: 2, id: "older-active-019fc922", command: "echo older-active" },
    { selector: 3, id: "newer-completed-019fc920", command: "echo newer-completed" },
    { selector: 4, id: "older-completed-019fc923", command: "echo older-completed" },
  ] as const;
  const root = await store(t, [
    { id: orderedSessions[2].id, modifiedAt: now, command: orderedSessions[2].command },
    { id: orderedSessions[0].id, active: true, modifiedAt: now - 1_000, command: orderedSessions[0].command },
    { id: orderedSessions[1].id, active: true, modifiedAt: now - 2_000, command: orderedSessions[1].command },
    { id: orderedSessions[3].id, modifiedAt: now - 3_000, command: orderedSessions[3].command },
  ]);

  const sessions = run(root, ["sessions"]);
  assert.equal(sessions.status, 0, sessions.stderr);
  assert.match(sessions.stdout, /^1\s+active\s+newer-ac/m);
  assert.match(sessions.stdout, /^2\s+active\s+older-ac/m);
  assert.match(sessions.stdout, /^3\s+complete\s+newer-co/m);
  assert.match(sessions.stdout, /^4\s+complete\s+older-co/m);

  for (const expected of orderedSessions) {
    const inspect = run(root, ["inspect", String(expected.selector)]);
    assert.equal(inspect.status, 0, inspect.stderr);
    assert.match(inspect.stdout, new RegExp(expected.command));
  }

  const attach = run(root, ["attach"]);
  const output = combined(attach);
  assert.notEqual(attach.status, 0);
  assert.match(output, /^1\s+active\s+newer-ac/m);
  assert.match(output, /^2\s+active\s+older-ac/m);
  assert.match(output, /bashguard attach 1/);
  assert.match(output, /bashguard attach 2/);
  assert.doesNotMatch(output, /^3\s+|^4\s+|newer-completed|older-completed/m);
});

test("explicit numeric selectors bypass selection for attach, inspect, and debrief", async (t) => {
  const now = Date.now();
  const root = await store(t, [
    { id: "explicit-first-019fc921", modifiedAt: now, command: "echo explicit-first" },
    { id: "explicit-second-019fc922", modifiedAt: now - 1_000, command: "echo explicit-second" },
  ]);

  const inspect = run(root, ["inspect", "2"]);
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.match(inspect.stdout, /explicit-second/);
  assert.doesNotMatch(combined(inspect), /Select a session/);

  const debrief = run(root, ["debrief", "2"]);
  assert.equal(debrief.status, 0, debrief.stderr);
  assert.match(debrief.stdout, /Session complete/);
  assert.match(debrief.stdout, /bashguard inspect 2 --event/);

  const attach = run(root, ["attach", "2", "--history", "0"]);
  assert.equal(attach.status, 0, attach.stderr);
  assert.match(attach.stdout, /Session explicit-second-019fc922/);
  assert.match(attach.stdout, /bashguard inspect 2 --event/);
});

test("explicit ID prefixes still resolve without interaction", async (t) => {
  const root = await store(t, [{ id: "prefix-target-019fc931" }]);
  for (const command of ["inspect", "debrief"] as const) {
    const result = run(root, [command, "prefix-target"]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(combined(result), /Select a session/);
  }
});

test("bare --session and option-valued --session fail before selection", async (t) => {
  const root = await store(t, [
    { id: "first-session" },
    { id: "second-session" },
  ]);

  for (const command of ["attach", "inspect", "debrief"] as const) {
    for (const suffix of [["--session"], ["--session", "--activity"]]) {
      const result = run(root, [command, ...suffix]);
      const output = combined(result);
      assert.notEqual(result.status, 0);
      assert.match(output, /`--session` requires a value/);
      assert.doesNotMatch(output, /Select a session|More than one eligible session|No BashGuard sessions/);
    }
  }
});

test("unknown inspect activity wins over non-TTY session ambiguity", async (t) => {
  const root = await store(t, [
    { id: "first-session" },
    { id: "second-session" },
  ]);

  const result = run(root, ["inspect", "--activity", "not-real"]);
  const output = combined(result);

  assert.notEqual(result.status, 0);
  assert.match(output, /Unknown activity: not-real\. Run `bashguard inspect --activity list`\./);
  assert.doesNotMatch(output, /Select a session|More than one eligible session/);
});

test("real PTY selection through bin/bashguard honors a non-default global selector", async (t) => {
  const lookup = spawnSync("/bin/sh", ["-c", "command -v script"], { encoding: "utf8" });
  if (lookup.status !== 0 || !lookup.stdout.trim()) {
    t.skip("system script utility is unavailable");
    return;
  }

  const now = Date.now();
  const root = await store(t, [
    { id: "pty-first-session", modifiedAt: now, command: "echo pty-first" },
    { id: "pty-selected-session", modifiedAt: now - 1_000, command: "echo pty-selected" },
  ]);
  const bin = join(process.cwd(), "bin", "bashguard");
  const script = lookup.stdout.trim();

  for (const command of ["inspect", "debrief"] as const) {
    const result = process.platform === "darwin"
      ? spawnSync("/usr/bin/expect", ["-c", [
        "set timeout 5",
        "spawn -noecho $env(BG_SCRIPT) -q /dev/null $env(BG_BIN) $env(BG_COMMAND)",
        "after 100",
        "send -- \"2\\r\"",
        "expect eof",
        "set status [wait]",
        "exit [lindex $status 3]",
      ].join("\n")], {
        cwd: process.cwd(),
        env: { ...process.env, BASHGUARD_DATA_DIR: root, BG_SCRIPT: script, BG_BIN: bin, BG_COMMAND: command },
        encoding: "utf8",
        timeout: 5_000,
      })
      : spawnSync(script, ["-q", "-c", `\"${bin.replaceAll('"', '\\"')}\" ${command}`, "/dev/null"], {
        cwd: process.cwd(),
        env: { ...process.env, BASHGUARD_DATA_DIR: root },
        encoding: "utf8",
        input: "2\n",
        timeout: 5_000,
      });
    const output = combined(result);
    assert.equal(result.status, 0, output);
    assert.match(output, /Select a session \[1, 2\]:/);
    assert.match(output, /bashguard inspect pty-sele --event/);
    if (command === "inspect") assert.match(output, /pty-selected/);
    else assert.match(output, /Session complete/);
    assert.doesNotMatch(output, /pty-first-event-2/);
  }
});

test("inspect --activity list remains session-independent", async (t) => {
  const root = await store(t, []);

  const result = run(root, ["inspect", "--activity", "list"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^shell\s+Pi Bash commands/m);
  assert.doesNotMatch(combined(result), /Select a session|No BashGuard sessions|eligible session/i);
});

test("usage advertises selector-less and optional-selector forms", async (t) => {
  const root = await store(t, []);
  const result = run(root, []);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /bashguard attach \[session-id\]/);
  assert.match(result.stderr, /bashguard inspect \[session-id\] --event/);
  assert.match(result.stderr, /bashguard debrief \[session-id\]/);
});
