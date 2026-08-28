import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import bashGuard from "../extensions/bashguard/index.ts";

type Handler = (event: any, ctx: any) => Promise<unknown>;

type RecordedEvent = { type: string; toolCallId?: string; payload: Record<string, unknown> };

async function fixture(
  t: test.TestContext,
  options: { hasUI?: boolean; approved?: boolean; confirmError?: Error; sessionId?: string } = {},
) {
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
    .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as RecordedEvent);
  return { handlers, ctx, confirmations, notifications, events, eventsFile, dataRoot, project };
}

function gitResetCommand(project: string): string {
  return `git -C ${project} reset --hard`;
}

function gitCleanCommand(project: string): string {
  return `git -C ${project} clean -fd`;
}

function destructiveGitCall(toolCallId: string, command: string) {
  return {
    toolCallId,
    toolName: "bash",
    input: { command },
  };
}

function eventTypes(events: RecordedEvent[], toolCallId: string): string[] {
  return events.filter((event) => event.toolCallId === toolCallId).map((event) => event.type);
}

const dangerousCall = {
  toolCallId: "call-danger",
  toolName: "bash",
  input: { command: "rm -rf build" },
};

test("active recorder owner allows safe calls without approval evidence", async (t) => {
  const f = await fixture(t);
  const result = await f.handlers.get("tool_call")?.({ ...dangerousCall, input: { command: "npm test", authorization: "Bearer secret" } }, f.ctx);
  assert.equal(result, undefined);
  assert.deepEqual(f.confirmations, []);
  const events = (await f.events()).filter((event) => event.toolCallId === "call-danger");
  assert.deepEqual(events.map((event) => event.type), ["tool.requested"]);
  assert.equal((events[0]?.payload.input as Record<string, unknown>).authorization, "[REDACTED]");
});

test("active owner Run once permits git reset --hard and records decision evidence after tool.requested", async (t) => {
  const f = await fixture(t, { approved: true });
  const command = gitResetCommand(f.project);
  assert.equal(await f.handlers.get("tool_call")?.(destructiveGitCall("call-git-reset", command), f.ctx), undefined);
  assert.equal(f.confirmations.length, 1);
  assert.match(f.confirmations[0]!.body, /git -C .* reset --hard/);

  const events = await f.events();
  assert.deepEqual(eventTypes(events, "call-git-reset"), [
    "tool.requested",
    "command.evaluated",
    "command.approval_requested",
    "command.approved",
  ]);

  const approved = events.find((event) => event.type === "command.approved" && event.toolCallId === "call-git-reset");
  assert.ok(approved);
  assert.equal(approved?.payload.outcome, "allow");
  assert.equal(approved?.payload.decisionSource, "bashguard_authorization");
  assert.equal(approved?.payload.authorization, "run_once");
  assert.equal(approved?.payload.matchedCheck, "git-reset-hard");
});

test("active owner decline for git clean -fd returns accurate Git block and records evaluated/requested/declined/blocked", async (t) => {
  const f = await fixture(t, { approved: false, sessionId: "declined-session" });
  const command = gitCleanCommand(f.project);
  assert.deepEqual(await f.handlers.get("tool_call")?.(destructiveGitCall("call-git-clean", command), f.ctx), {
    block: true,
    reason: "BashGuard blocked this destructive Git operation because approval was declined.",
  });

  const events = await f.events();
  assert.deepEqual(eventTypes(events, "call-git-clean"), [
    "tool.requested",
    "command.evaluated",
    "command.approval_requested",
    "command.declined",
    "command.blocked",
  ]);

  const declined = events.find((event) => event.type === "command.declined" && event.toolCallId === "call-git-clean");
  const blocked = events.find((event) => event.type === "command.blocked" && event.toolCallId === "call-git-clean");
  assert.equal(declined?.payload.cause, "declined");
  assert.equal(blocked?.payload.cause, "declined");
  assert.equal(blocked?.payload.reason, "BashGuard blocked this destructive Git operation because approval was declined.");
});

test("command matching reset and clean gets exactly one prompt listing both and structured matchedChecks in JSONL", async (t) => {
  const f = await fixture(t, { approved: true, sessionId: "matched-checks-session" });
  const command = `${gitResetCommand(f.project)} && ${gitCleanCommand(f.project)}`;
  assert.equal(await f.handlers.get("tool_call")?.(destructiveGitCall("call-git-both", command), f.ctx), undefined);
  assert.equal(f.confirmations.length, 1);

  const prompt = f.confirmations[0]!;
  assert.match(prompt.body, /- git-reset-hard/);
  assert.match(prompt.body, /- git-clean-forced/);
  assert.equal((prompt.body.match(/- git-reset-hard/g) ?? []).length, 1);
  assert.equal((prompt.body.match(/- git-clean-forced/g) ?? []).length, 1);
  assert.equal((prompt.body.match(/^- -C /gm) ?? []).length, 1);

  const events = await f.events();
  const evaluated = events.find((event) => event.type === "command.evaluated" && event.toolCallId === "call-git-both");
  assert.ok(evaluated);
  const matchedChecks = evaluated?.payload.matchedChecks as Array<{
    id: string;
    version: number;
    provider: string;
    literalEvidence: Array<{ kind: string; option: string; value: string }>;
  }>;
  assert.deepEqual(matchedChecks.map((check) => [check.id, check.version, check.provider]), [
    ["git-reset-hard", 1, "bashguard_builtin"],
    ["git-clean-forced", 1, "bashguard_builtin"],
  ]);
  assert.deepEqual(matchedChecks[0]?.literalEvidence, [
    { kind: "git_target_option", option: "-C", value: f.project },
    { kind: "git_target_option", option: "-C", value: f.project },
  ]);
  assert.deepEqual(matchedChecks[1]?.literalEvidence, [
    { kind: "git_target_option", option: "-C", value: f.project },
    { kind: "git_target_option", option: "-C", value: f.project },
  ]);
});

test("duplicate recorder lock loser neither prompts nor blocks a destructive Git call", async (t) => {
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
  assert.equal(await duplicateHandlers.get("tool_call")?.(destructiveGitCall("duplicate-git-call", gitResetCommand(owner.project)), duplicateCtx), undefined);
  assert.deepEqual(duplicateConfirmations, []);
  assert.deepEqual((await owner.events()).filter((event) => event.toolCallId === "duplicate-git-call").map((event) => event.type), []);

  assert.equal(await owner.handlers.get("tool_call")?.(destructiveGitCall("owner-git-call", gitResetCommand(owner.project)), owner.ctx), undefined);
  assert.equal(owner.confirmations.length, 1);
  assert.match(owner.confirmations[0]!.body, /git -C .* reset --hard/);
  assert.deepEqual(eventTypes(await owner.events(), "owner-git-call"), [
    "tool.requested",
    "command.evaluated",
    "command.approval_requested",
    "command.approved",
  ]);
});
