import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBrowserModel, transitionBrowser } from "./browse-model.ts";
import { renderBrowserFrame } from "./browse-view.ts";
import { formatEventInspection, formatTimelineEvent, renderEvent } from "./cli.ts";
import bashGuard from "../extensions/bashguard/index.ts";

type Handler = (event: any, ctx: any) => Promise<unknown>;
type RecordedEvent = { id: string; type: string; sequence: number; toolCallId?: string; payload: Record<string, unknown> };

function runCli(root: string, args: string[]) {
  return spawnSync(process.execPath, ["--experimental-strip-types", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, BASHGUARD_DATA_DIR: root, TZ: "UTC" },
    encoding: "utf8",
  });
}

function runGit(cwd: string, args: string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function assertGitOk(result: ReturnType<typeof runGit>, message: string) {
  assert.equal(result.status, 0, `${message}\n${result.stdout}${result.stderr}`);
}

function loadEvents(eventsFile: string): Promise<RecordedEvent[]> {
  return readFile(eventsFile, "utf8").then((text) => text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as RecordedEvent));
}

function eventTypes(events: RecordedEvent[], toolCallId: string): string[] {
  return events.filter((event) => event.toolCallId === toolCallId).map((event) => event.type);
}

function browserDependencies() {
  return {
    activities: ["shell", "file", "git", "risk", "capture", "prompt", "tool", "lifecycle"],
    isNarrated(event: { id: string; type: string; sequence: number; payload?: Record<string, unknown> }) {
      return formatTimelineEvent(event as never) !== undefined;
    },
    matchesActivity() {
      return true;
    },
    matchesSearch(event: { id: string; type: string; sequence: number; payload?: Record<string, unknown> }, query: string) {
      return JSON.stringify(event).toLowerCase().includes(query.toLowerCase());
    },
  };
}

async function setupDisposableGitRepo(project: string) {
  assertGitOk(runGit(project, ["init"]), "git init failed");
  assertGitOk(runGit(project, ["config", "user.name", "BashGuard Test"]), "git config user.name failed");
  assertGitOk(runGit(project, ["config", "user.email", "bashguard@example.com"]), "git config user.email failed");

  await writeFile(join(project, "tracked.txt"), "tracked sentinel\n");
  assertGitOk(runGit(project, ["add", "tracked.txt"]), "git add failed");
  assertGitOk(runGit(project, ["commit", "-m", "initial commit"]), "git commit failed");

  await writeFile(join(project, "tracked.txt"), "modified tracked sentinel\n");
  await mkdir(join(project, "untracked-sentinel"));
  await writeFile(join(project, "untracked-sentinel", "sentinel.txt"), "untracked sentinel\n");
}

test("extension writer output survives reader commands for recursive forced deletion of a disposable target", async (t) => {
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
  const toolCallId = "call-recursive-delete";
  const decision = await handlers.get("tool_call")?.({
    toolCallId,
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
  const events = await loadEvents(eventPath);
  const blocked = events.find((event) => event.type === "command.blocked");
  assert.ok(blocked);
  assert.deepEqual(eventTypes(events, toolCallId), ["tool.requested", "command.evaluated", "command.blocked"]);

  const filtered = runCli(root, ["inspect", "--session-id=authorization-integration", "--activity", "risk", "--all"]);
  assert.equal(filtered.status, 0, filtered.stderr);
  assert.match(filtered.stdout, /Approval required · BashGuard-observed command/);
  assert.match(filtered.stdout, /Blocked by BashGuard authorization/);

  const inspected = runCli(root, ["inspect", "--session-id=authorization-integration", "--event", blocked.id]);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.match(inspected.stdout, /Evidence source\s+bashguard_tool_call_input/);
  assert.match(inspected.stdout, /Block cause\s+approval_unavailable/);
  assert.match(inspected.stdout, /Reason\s+BashGuard blocked recursive forced deletion because approval UI is unavailable\./);

  const debrief = runCli(root, ["debrief", "--session-id=authorization-integration"]);
  assert.equal(debrief.status, 0, debrief.stderr);
  assert.match(debrief.stdout, /Blocked commands\s+1/);
  assert.match(debrief.stdout, /Pi was instructed to block this tool call/);
  assert.match(debrief.stdout, /blocked before execution by recorded authorization decision/);
});

test("extension writer output survives reader commands for a blocked disposable Git reset-and-clean", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-authorization-integration-"));
  const project = await mkdtemp(join(tmpdir(), "bashguard-authorization-project-"));
  const previousRoot = process.env.BASHGUARD_DATA_DIR;
  process.env.BASHGUARD_DATA_DIR = root;
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
    if (previousRoot === undefined) delete process.env.BASHGUARD_DATA_DIR;
    else process.env.BASHGUARD_DATA_DIR = previousRoot;
  });

  await setupDisposableGitRepo(project);
  assert.match(runGit(project, ["status", "--porcelain"]).stdout, /M tracked\.txt/);
  assert.match(runGit(project, ["status", "--porcelain"]).stdout, /\?\? untracked-sentinel\//);

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
  const observedCommand = `git -C ${project} reset --hard && git -C ${project} clean -fd`;
  const toolCallId = "call-destructive-git";
  const decision = await handlers.get("tool_call")?.({
    toolCallId,
    toolName: "bash",
    input: { command: observedCommand },
  }, ctx);
  assert.deepEqual(decision, {
    block: true,
    reason: "BashGuard blocked this destructive Git operation because approval UI is unavailable.",
  });

  assert.match(await readFile(join(project, "tracked.txt"), "utf8"), /modified tracked sentinel/);
  await access(join(project, "untracked-sentinel", "sentinel.txt"));
  assert.match(runGit(project, ["status", "--porcelain"]).stdout, /M tracked\.txt/);
  assert.match(runGit(project, ["status", "--porcelain"]).stdout, /\?\? untracked-sentinel\//);

  await handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, ctx);

  const eventsFile = join(root, "authorization-integration", "events.jsonl");
  const events = await loadEvents(eventsFile);
  const blocked = events.find((event) => event.type === "command.blocked" && event.toolCallId === toolCallId);
  assert.ok(blocked);
  assert.deepEqual(eventTypes(events, toolCallId), ["tool.requested", "command.evaluated", "command.blocked"]);
  assert.equal(blocked?.payload.cause, "approval_unavailable");
  assert.equal(blocked?.payload.reason, "BashGuard blocked this destructive Git operation because approval UI is unavailable.");
  assert.equal(blocked?.payload.decisionSource, "bashguard_authorization");
  assert.equal(blocked?.payload.matchedCheck, "git-reset-hard");
  assert.deepEqual((blocked?.payload.matchedChecks as Array<{ id: string }>).map((check) => check.id), ["git-reset-hard", "git-clean-forced"]);

  const filtered = runCli(root, ["inspect", "--session-id=authorization-integration", "--activity", "risk", "--all"]);
  assert.equal(filtered.status, 0, filtered.stderr);
  assert.match(filtered.stdout, /Approval required · BashGuard-observed command/);
  assert.match(filtered.stdout, /Blocked by BashGuard authorization/);

  const inspected = runCli(root, ["inspect", "--session-id=authorization-integration", "--event", blocked.id]);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.match(inspected.stdout, /Matched checks/);
  assert.match(inspected.stdout, /Rule ID\s+git-reset-hard/);
  assert.match(inspected.stdout, /Rule ID\s+git-clean-forced/);
  assert.match(inspected.stdout, /Version\s+1/);
  assert.match(inspected.stdout, /Provider\s+bashguard_builtin/);
  assert.match(inspected.stdout, /Risk\s+history or working-tree rewrite/);
  assert.match(inspected.stdout, /Impact\s+may discard tracked working-tree and index changes\./);
  assert.match(inspected.stdout, /Impact\s+may permanently delete untracked files and, when requested, directories\./);
  assert.match(inspected.stdout, /Block cause\s+approval_unavailable/);
  assert.match(inspected.stdout, /Limitations\s+Later extension handlers may mutate this tool call after BashGuard observes it\./);
  assert.match(inspected.stdout, /Replacement tools may add internal wrappers that BashGuard does not observe here\./);
  assert.match(inspected.stdout, /Shell runtime expansion and child-process behavior may differ from this command text\./);

  const browserEvents = events.map((event) => ({
    id: event.id,
    sequence: event.sequence,
    type: event.type,
    timestamp: new Date(0).toISOString(),
    payload: event.payload,
  }));
  let model = createBrowserModel(browserEvents, browserDependencies());
  model = transitionBrowser(model, { type: "set-search", query: blocked.id }, browserDependencies()).model;
  assert.equal(model.selectedId, blocked.id);
  model = transitionBrowser(model, { type: "enter" }, browserDependencies()).model;
  const browserFrame = renderBrowserFrame(
    model,
    { width: 79, height: 40 },
    browserDependencies(),
    {
      timeline: (event) => formatTimelineEvent(event as never) ?? `${event.sequence} ${event.id} ${event.type}`,
      narrative: (event) => renderEvent(event as never) ?? event.type,
      detail: (event) => formatEventInspection(event as never).trimEnd(),
    },
    { sessionId: "authorization-integration", repository: project, snapshotTime: "12:00:00" },
  );
  const browserText = browserFrame.join("\n");
  assert.match(browserText, /Event detail/);
  assert.match(browserText, /Block cause\s+approval_unavailable/);
  assert.match(browserText, /Matched checks/);
  assert.match(browserText, /Provider\s+bashguard_builtin/);

  const debrief = runCli(root, ["debrief", "--session-id=authorization-integration"]);
  assert.equal(debrief.status, 0, debrief.stderr);
  assert.match(debrief.stdout, /Blocked commands\s+1/);
  assert.match(debrief.stdout, /event \d+ · blocked · `git -C .* reset --hard && git -C .* clean -fd`/);
  assert.match(debrief.stdout, /checks: git-reset-hard, git-clean-forced/);
  assert.match(debrief.stdout, /Inspect: --event \d+/);
  assert.match(debrief.stdout, /Pi was instructed to block this tool call/);
  assert.match(debrief.stdout, /blocked before execution by recorded authorization decision/);
  assert.doesNotMatch(debrief.stdout, /missing command completion evidence/);
});
