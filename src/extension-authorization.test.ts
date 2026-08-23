import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import bashGuard from "../extensions/bashguard/index.ts";

type Handler = (event: any, ctx: any) => Promise<unknown>;

async function fixture(t: test.TestContext, options: { hasUI?: boolean; approved?: boolean; confirmError?: Error; sessionId?: string } = {}) {
  const dataRoot = await mkdtemp(join(tmpdir(), "bashguard-authorization-"));
  const project = await mkdtemp(join(tmpdir(), "bashguard-authorization-project-"));
  const previousDataRoot = process.env.BASHGUARD_DATA_DIR;
  process.env.BASHGUARD_DATA_DIR = dataRoot;
  t.after(async () => {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
    if (previousDataRoot === undefined) delete process.env.BASHGUARD_DATA_DIR;
    else process.env.BASHGUARD_DATA_DIR = previousDataRoot;
  });

  const handlers = new Map<string, Handler>();
  const confirmations: Array<{ title: string; body: string }> = [];
  const notifications: Array<{ message: string; level: string }> = [];
  const pi = {
    on(name: string, handler: Handler) { handlers.set(name, handler); },
    registerCommand() {},
  };
  const ctx = {
    cwd: project,
    hasUI: options.hasUI ?? true,
    sessionManager: { sessionId: options.sessionId ?? "authorization-session", getLeafId: () => undefined },
    ui: {
      async confirm(title: string, body: string) {
        confirmations.push({ title, body });
        if (options.confirmError) throw options.confirmError;
        return options.approved ?? true;
      },
      notify(message: string, level: string) { notifications.push({ message, level }); },
      setStatus() {},
    },
  };
  bashGuard(pi as any);
  await handlers.get("session_start")?.({ type: "session_start" }, ctx);
  const eventsFile = join(dataRoot, options.sessionId ?? "authorization-session", "events.jsonl");
  const events = async () => (await readFile(eventsFile, "utf8"))
    .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type: string; toolCallId?: string; payload: Record<string, unknown> });
  return { handlers, ctx, confirmations, notifications, events, eventsFile, dataRoot, project };
}

const dangerousCall = {
  toolCallId: "call-danger",
  toolName: "bash",
  input: { command: "rm -rf build" },
};

test("active recorder owner allows safe calls without approval evidence", async (t) => {
  const f = await fixture(t);
  const result = await f.handlers.get("tool_call")?.({ ...dangerousCall, input: { command: "npm test" } }, f.ctx);
  assert.equal(result, undefined);
  assert.deepEqual(f.confirmations, []);
  assert.deepEqual((await f.events()).filter((event) => event.toolCallId === "call-danger").map((event) => event.type), ["tool.requested"]);
});

test("Run once permits the call and records decision evidence after the tool request", async (t) => {
  const f = await fixture(t, { approved: true });
  assert.equal(await f.handlers.get("tool_call")?.(dangerousCall, f.ctx), undefined);
  assert.equal(f.confirmations.length, 1);
  assert.match(f.confirmations[0]!.body, /rm -rf build/);
  assert.deepEqual((await f.events()).filter((event) => event.toolCallId === "call-danger").map((event) => event.type), [
    "tool.requested",
    "command.evaluated",
    "command.approval_requested",
    "command.approved",
  ]);
});

test("decline, unavailable UI, and confirmation errors return Pi blocking results", async (t) => {
  const declined = await fixture(t, { approved: false, sessionId: "declined-session" });
  assert.deepEqual(await declined.handlers.get("tool_call")?.(dangerousCall, declined.ctx), {
    block: true,
    reason: "BashGuard blocked recursive forced deletion because approval was declined.",
  });
  assert.deepEqual((await declined.events()).filter((event) => event.toolCallId === "call-danger").map((event) => event.type), [
    "tool.requested", "command.evaluated", "command.approval_requested", "command.declined", "command.blocked",
  ]);

  const unavailable = await fixture(t, { hasUI: false, sessionId: "unavailable-session" });
  assert.match(String((await unavailable.handlers.get("tool_call")?.(dangerousCall, unavailable.ctx) as any)?.reason), /approval UI is unavailable/);
  assert.equal(unavailable.confirmations.length, 0);

  const failed = await fixture(t, { confirmError: new Error("dialog closed"), sessionId: "failed-session" });
  assert.match(String((await failed.handlers.get("tool_call")?.(dangerousCall, failed.ctx) as any)?.reason), /approval UI failed/);
});

test("duplicate recorder lock loser neither prompts nor blocks", async (t) => {
  const owner = await fixture(t, { sessionId: "shared-authorization-session" });
  const duplicateHandlers = new Map<string, Handler>();
  const duplicateConfirmations: string[] = [];
  bashGuard({
    on(name: string, handler: Handler) { duplicateHandlers.set(name, handler); },
    registerCommand() {},
  } as any);
  const duplicateCtx = {
    ...owner.ctx,
    ui: {
      ...owner.ctx.ui,
      async confirm() { duplicateConfirmations.push("prompted"); return false; },
    },
  };
  await duplicateHandlers.get("session_start")?.({ type: "session_start" }, duplicateCtx);
  assert.equal(await duplicateHandlers.get("tool_call")?.(dangerousCall, duplicateCtx), undefined);
  assert.deepEqual(duplicateConfirmations, []);
});
