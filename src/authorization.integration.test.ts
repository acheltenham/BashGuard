import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import bashGuard from "../extensions/bashguard/index.ts";

type Handler = (event: any, ctx: any) => Promise<unknown>;

function runCli(root: string, args: string[]) {
  return spawnSync(process.execPath, ["--experimental-strip-types", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, BASHGUARD_DATA_DIR: root, TZ: "UTC" },
    encoding: "utf8",
  });
}

test("extension decision JSONL is readable through risk filters, inspect, browser projections, and debrief", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-authorization-integration-"));
  const project = await mkdtemp(join(tmpdir(), "bashguard-authorization-project-"));
  const target = join(project, "disposable-target");
  await mkdir(target);
  await writeFile(join(target, "sentinel.txt"), "preserve me\n");
  const previousRoot = process.env.BASHGUARD_DATA_DIR;
  process.env.BASHGUARD_DATA_DIR = root;
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
    if (previousRoot === undefined) delete process.env.BASHGUARD_DATA_DIR;
    else process.env.BASHGUARD_DATA_DIR = previousRoot;
  });

  const handlers = new Map<string, Handler>();
  bashGuard({
    on(name: string, handler: Handler) { handlers.set(name, handler); },
    registerCommand() {},
  } as any);
  const ctx = {
    cwd: project,
    hasUI: false,
    sessionManager: { sessionId: "authorization-integration", getLeafId: () => undefined },
    ui: {
      async confirm() { throw new Error("confirm must not run without UI"); },
      notify() {},
      setStatus() {},
    },
  };
  await handlers.get("session_start")?.({ type: "session_start" }, ctx);
  const decision = await handlers.get("tool_call")?.({
    toolCallId: "call-integration",
    toolName: "bash",
    input: { command: `rm -rf ${target}` },
  }, ctx);
  assert.deepEqual(decision, {
    block: true,
    reason: "BashGuard blocked recursive forced deletion because approval UI is unavailable.",
  });
  await access(join(target, "sentinel.txt"));
  await handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, ctx);

  const eventPath = join(root, "authorization-integration", "events.jsonl");
  const events = (await readFile(eventPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { id: string; type: string });
  const blocked = events.find((event) => event.type === "command.blocked");
  assert.ok(blocked);

  const filtered = runCli(root, ["inspect", "--session-id=authorization-integration", "--activity", "risk", "--all"]);
  assert.equal(filtered.status, 0, filtered.stderr);
  assert.match(filtered.stdout, /Approval required · BashGuard-observed command/);
  assert.match(filtered.stdout, /Blocked by BashGuard authorization/);

  const inspected = runCli(root, ["inspect", "--session-id=authorization-integration", "--event", blocked.id]);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.match(inspected.stdout, /Evidence source\s+bashguard_tool_call_input/);
  assert.match(inspected.stdout, /Block cause\s+approval_unavailable/);
  assert.match(inspected.stdout, /Reason\s+BashGuard blocked recursive forced deletion because approval UI is unavailable/);

  const debrief = runCli(root, ["debrief", "--session-id=authorization-integration"]);
  assert.equal(debrief.status, 0, debrief.stderr);
  assert.match(debrief.stdout, /Approval requests\s+0|Blocked commands\s+1/);
  assert.match(debrief.stdout, /Blocked commands\s+1/);
  assert.match(debrief.stdout, /Pi was instructed to block this tool call/);
  assert.match(debrief.stdout, /blocked before execution by recorded authorization decision/);
});
