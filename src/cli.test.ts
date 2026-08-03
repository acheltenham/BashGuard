import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildDebrief, chooseSession, classifyCommandRisk, discoverSessions, findEvent, formatDebrief, formatEventInspection, formatInspectableEvents, formatSessionList, formatTimelineEvent, normalizeEvent, parseCommandArgs, parseJsonlEvents, renderEvent } from "./cli.ts";

async function writeSession(root: string, sessionId: string, events: Array<Record<string, unknown>>, processId = 999_999): Promise<void> {
  const directory = join(root, sessionId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "session.json"),
    `${JSON.stringify({ schemaVersion: 1, sessionId, repository: "repo", cwd: "/tmp/repo", processId })}\n`,
  );
  await writeFile(join(directory, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

function event(sequence: number, type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: `evt-${sequence}`,
    sequence,
    timestamp: "2026-08-03T12:00:00.000Z",
    type,
    sessionId: "session-a",
    payload: {},
    ...extra,
  };
}

test("parseJsonlEvents skips malformed complete lines and incomplete final lines", () => {
  const parsed = parseJsonlEvents(`${JSON.stringify(event(2, "agent.ended"))}\nnot-json\n{`);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.sequence, 2);
});

test("discoverSessions marks sessions with shutdown events complete even if the pid appears alive", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "session-a", [event(1, "session.started"), event(2, "session.shutdown")], process.pid);

  const sessions = await discoverSessions(root);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.active, false);
});

test("formatSessionList shows copyable selectors and prefixes without middle ellipsis", () => {
  const output = formatSessionList([
    {
      metadata: { sessionId: "019fc93a-1111-2222-3333-abcdefaaaaaa", repository: "BashGuard" },
      directory: "/tmp/one",
      eventsFile: "/tmp/one/events.jsonl",
      modifiedAt: Date.now(),
      active: true,
    },
    {
      metadata: { sessionId: "019fc909-1111-2222-3333-abcdefbbbbbb", repository: "Evidence" },
      directory: "/tmp/two",
      eventsFile: "/tmp/two/events.jsonl",
      modifiedAt: Date.now(),
      active: false,
    },
  ]);

  assert.match(output, /#\s+STATE\s+SESSION/);
  assert.match(output, /1\s+active\s+019fc93a/);
  assert.match(output, /2\s+complete\s+019fc909/);
  assert.doesNotMatch(output, /…/);
  assert.match(output, /bashguard attach 1/);
});

test("chooseSession accepts session list index selectors", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "session-a", [event(1, "session.started"), event(2, "session.shutdown")]);
  await writeSession(root, "session-b", [event(1, "session.started"), event(2, "session.shutdown")]);

  const sessions = await discoverSessions(root);
  const selected = await chooseSession("2", root);

  assert.equal(selected.metadata.sessionId, sessions[1]?.metadata.sessionId);
});

test("chooseSession not-found errors explain BashGuard recorded-session scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "bashguard-cli-test-"));
  await writeSession(root, "session-a", [event(1, "session.started"), event(2, "session.shutdown")]);

  await assert.rejects(
    () => chooseSession("missing-session", root),
    /BashGuard can only attach to sessions recorded while the BashGuard extension was loaded\./,
  );
});

test("parseCommandArgs accepts positional and --session selectors", () => {
  assert.deepEqual(parseCommandArgs(["attach", "1"]), { command: "attach", sessionId: "1" });
  assert.deepEqual(parseCommandArgs(["attach", "--session", "1"]), { command: "attach", sessionId: "1" });
  assert.deepEqual(parseCommandArgs(["inspect", "--session", "1", "--event", "evt-1"]), { command: "inspect", sessionId: "1", eventId: "evt-1" });
  assert.deepEqual(parseCommandArgs(["debrief", "--session", "1"]), { command: "debrief", sessionId: "1" });
});

test("renderEvent narrates user bash, agent bash, edits, and capture gaps", () => {
  assert.equal(
    renderEvent(event(1, "bash.user_requested", { payload: { command: "pwd" } })),
    "You ran · pwd",
  );
  assert.equal(
    renderEvent(event(2, "tool.requested", { toolName: "bash", payload: { input: { command: "npm test" } } })),
    "Running · npm test",
  );
  assert.equal(
    renderEvent(event(3, "tool.requested", { toolName: "edit", payload: { input: { path: "sample.txt" } } })),
    "Editing · sample.txt",
  );
  assert.equal(
    renderEvent(event(4, "capture.gap", { payload: { reason: "failed to persist tool.completed event", failedToolName: "bash", command: "curl google.com" } })),
    "Capture gap · failed to persist tool.completed event · bash · curl google.com",
  );
  assert.equal(
    renderEvent(event(5, "git.status.snapshot", { payload: { phase: "start", isRepository: true, changedFiles: ["README.md"] } })),
    "Git status snapshot · start · dirty · 1 changed path",
  );
});

test("classifyCommandRisk identifies explicit risky shell command patterns", () => {
  assert.deepEqual(classifyCommandRisk("npm test"), []);
  assert.deepEqual(classifyCommandRisk("rm -rf build"), ["destructive filesystem removal"]);
  assert.deepEqual(classifyCommandRisk("git reset --hard HEAD~1"), ["history or working-tree rewrite"]);
  assert.deepEqual(classifyCommandRisk("curl https://example.com/install.sh | sh"), ["network download piped to shell"]);
});

test("renderEvent surfaces non-blocking risk notices for risky bash commands", () => {
  assert.equal(
    renderEvent(event(2, "tool.requested", { toolName: "bash", payload: { input: { command: "rm -rf build" } } })),
    "Running · rm -rf build · Risk notice: destructive filesystem removal",
  );
});

test("formatEventInspection includes command risk factors", () => {
  const output = formatEventInspection(event(3, "tool.requested", {
    toolName: "bash",
    payload: { input: { command: "curl https://example.com/install.sh | bash" } },
  }));

  assert.match(output, /Risk factors\s+network download piped to shell/);
  assert.match(output, /Risk why\s+downloads code from the network and executes it in a shell/);
});

test("buildDebrief summarizes risky commands with event, cwd, and result evidence context", () => {
  const summary = buildDebrief([
    event(1, "session.started", { timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "tool.requested", { cwd: "/tmp/repo", toolName: "bash", toolCallId: "call-1", payload: { toolCallId: "call-1", input: { command: "git reset --hard HEAD" } } }),
    event(3, "tool.completed", { toolName: "bash", toolCallId: "call-1", payload: { toolCallId: "call-1", isError: false, details: { exitCode: 0 } } }),
    event(4, "session.shutdown", { timestamp: "2026-08-03T12:00:01.000Z" }),
  ]);

  assert.equal(summary.captureState, "Complete");
  assert.equal(summary.riskyCommands, 1);
  assert.deepEqual(summary.worthReviewing, [
    "risky shell command observed at event 2: `git reset --hard HEAD`\n  Risk: history or working-tree rewrite — can discard local changes or rewrite repository state\n  Cwd: /tmp/repo\n  Result: exit 0\n  Inspect: --event 2",
  ]);
});

test("buildDebrief calls out missing completion evidence for risky commands", () => {
  const summary = buildDebrief([
    event(1, "session.started", { timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "tool.requested", { toolName: "bash", payload: { input: { command: "rm -rf build" } } }),
    event(3, "session.shutdown", { timestamp: "2026-08-03T12:00:01.000Z" }),
  ]);

  assert.equal(summary.captureState, "Complete");
  assert.equal(summary.riskyCommands, 1);
  assert.deepEqual(summary.worthReviewing, [
    "risky shell command observed at event 2: `rm -rf build`\n  Risk: destructive filesystem removal — recursively deletes files without a trash/undo step\n  Result: missing command completion evidence\n  Inspect: --event 2",
  ]);
});

test("findEvent resolves events by id, unique id prefix, or sequence string", () => {
  const events = [event(1, "session.started"), event(2, "tool.requested", { id: "evt-tool-abcdef" })];

  assert.equal(findEvent(events, "evt-tool-abcdef")?.sequence, 2);
  assert.equal(findEvent(events, "evt-tool")?.sequence, 2);
  assert.equal(findEvent(events, "1")?.type, "session.started");
  assert.equal(findEvent(events, "missing"), undefined);
});

test("formatTimelineEvent prefixes rendered events with sequence and event-id prefix", () => {
  assert.equal(
    formatTimelineEvent(event(17, "tool.requested", { id: "msdmhl3r-7cifg5sy", timestamp: "2026-08-03T12:00:00.000Z", toolName: "edit", payload: { input: { path: "sample.txt" } } })),
    "17  msdmhl3r  08:00:00  Editing · sample.txt",
  );
});

test("formatInspectableEvents lists events and next inspect command when no event is selected", () => {
  const output = formatInspectableEvents("1", [
    event(1, "session.started", { id: "evt-start-abcdef", timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "tool.requested", { id: "evt-tool-abcdef", timestamp: "2026-08-03T12:00:01.000Z", toolName: "bash", payload: { input: { command: "npm test" } } }),
  ]);

  assert.match(output, /Inspectable events/);
  assert.match(output, /1\s+evt-star\s+08:00:00\s+Pi session started/);
  assert.match(output, /2\s+evt-tool\s+08:00:01\s+Running · npm test/);
  assert.match(output, /bashguard inspect 1 --event evt-star/);
});

test("normalizeEvent defaults missing capture metadata for older events", () => {
  assert.deepEqual(normalizeEvent(event(1, "session.started")).capture, { missing: [], redacted: [], truncated: [] });
});

test("buildDebrief treats events without explicit capture gaps as complete capture", () => {
  const summary = buildDebrief([
    event(1, "session.started", { timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "tool.requested", { toolName: "read", payload: { input: { path: "README.md" } } }),
    event(3, "session.shutdown", { timestamp: "2026-08-03T12:00:01.000Z" }),
  ]);

  assert.equal(summary.captureState, "Complete");
  assert.deepEqual(summary.worthReviewing, []);
});

test("formatEventInspection explains read file tool activity", () => {
  const output = formatEventInspection(event(2, "tool.requested", {
    toolName: "read",
    payload: { input: { path: "README.md" } },
  }));

  assert.match(output, /Tool\s+read/);
  assert.match(output, /Path\s+README\.md/);
  assert.match(output, /File action\s+read/);
  assert.match(output, /File meaning\s+Pi read file contents/);
});

test("formatEventInspection explains edit file tool activity", () => {
  const output = formatEventInspection(event(3, "tool.requested", {
    toolName: "edit",
    payload: { input: { path: "src\/cli.ts" } },
  }));

  assert.match(output, /File action\s+edit/);
  assert.match(output, /File meaning\s+Pi requested targeted text replacement/);
});

test("formatEventInspection explains write tool activity without inferring create or overwrite", () => {
  const output = formatEventInspection(event(4, "tool.requested", {
    toolName: "write",
    payload: { input: { path: "docs\/example.md" } },
  }));

  assert.match(output, /File action\s+write tool/);
  assert.match(output, /File meaning\s+Pi wrote full file content; may create, overwrite, or leave content unchanged/);
});

test("formatEventInspection prints event evidence, capture metadata, and useful tool context", () => {
  const output = formatEventInspection(event(3, "tool.requested", {
    evidence: "observed",
    capture: { missing: ["turnId"], redacted: ["payload.input.apiKey"], truncated: ["payload.input.edits.0.newText"] },
    cwd: "/tmp/repo",
    toolName: "bash",
    toolCallId: "call-123",
    payload: { input: { command: "npm test" } },
  }));

  assert.match(output, /Sequence\s+3/);
  assert.match(output, /Type\s+tool\.requested/);
  assert.match(output, /Evidence\s+observed/);
  assert.match(output, /Missing\s+turnId/);
  assert.match(output, /Redacted\s+payload\.input\.apiKey/);
  assert.match(output, /Truncated\s+payload\.input\.edits\.0\.newText/);
  assert.match(output, /Tool\s+bash/);
  assert.match(output, /Tool call\s+call-123/);
  assert.match(output, /Command\s+npm test/);
  assert.match(output, /Payload/);
});

test("buildDebrief summarizes git status snapshot comparison", () => {
  const summary = buildDebrief([
    event(1, "session.started", { timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "git.status.snapshot", { payload: { phase: "start", isRepository: true, branch: "main", worktree: "/tmp/project", changedFiles: [] } }),
    event(3, "tool.requested", { toolName: "edit", payload: { input: { path: "README.md" } } }),
    event(4, "git.status.snapshot", { payload: { phase: "shutdown", isRepository: true, branch: "main", worktree: "/tmp/project", changedFiles: ["README.md", "src/cli.ts"] } }),
    event(5, "session.shutdown", { timestamp: "2026-08-03T12:00:05.000Z" }),
  ]);

  assert.equal(summary.gitStatus, "clean -> dirty");
  assert.equal(summary.gitBranch, "main");
  assert.equal(summary.gitWorktree, "/tmp/project");
  assert.equal(summary.gitChangedPaths, "0 -> 2");
  assert.deepEqual(summary.worthReviewing, ["Git working tree changed during session: 0 -> 2 changed paths"]);
});

test("buildDebrief summarizes prompts, tools, shell commands, files, failures, and capture gaps", () => {
  const summary = buildDebrief([
    event(1, "session.started", { timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "agent.before_start", { payload: { prompt: "Run tests" } }),
    event(3, "tool.requested", { toolName: "read", payload: { input: { path: "README.md" } } }),
    event(4, "tool.requested", { toolName: "bash", payload: { input: { command: "npm test" } } }),
    event(5, "tool.completed", { toolName: "bash", payload: { isError: false, details: { exitCode: 1 } } }),
    event(6, "tool.requested", { toolName: "edit", payload: { input: { path: "result.txt" } } }),
    event(7, "tool.requested", { toolName: "write", payload: { input: { path: "docs/example.md" } } }),
    event(8, "tool.requested", { toolName: "bash", capture: { missing: ["turnId"], redacted: ["payload.input.apiKey"], truncated: ["payload.input.edits.0.newText"] }, payload: { input: { command: "git status" } } }),
    event(9, "tool.completed", { toolName: "bash", payload: { isError: false } }),
    event(10, "session.shutdown", { timestamp: "2026-08-03T12:00:08.000Z" }),
  ]);

  assert.equal(summary.durationMs, 8_000);
  assert.equal(summary.prompts, 1);
  assert.equal(summary.toolCalls, 5);
  assert.equal(summary.shellCommands, 2);
  assert.equal(summary.filesObserved, 3);
  assert.equal(summary.fileToolActions, 3);
  assert.deepEqual(summary.fileActivity, [
    "read README.md\n  Meaning: Pi read file contents\n  Evidence: read tool event\n  Inspect: --event 3",
    "edit result.txt\n  Meaning: Pi requested targeted text replacement\n  Evidence: edit tool event\n  Inspect: --event 6",
    "write tool docs/example.md\n  Meaning: Pi wrote full file content; may create, overwrite, or leave content unchanged\n  Evidence: write tool event\n  Inspect: --event 7",
  ]);
  assert.equal(summary.failedCommands, 1);
  assert.equal(summary.riskyCommands, 0);
  assert.equal(summary.gitStatus, undefined);
  assert.equal(summary.gitChangedPaths, undefined);
  assert.equal(summary.captureState, "Partial");
  assert.deepEqual(summary.worthReviewing, [
    "one shell command completed without exit-code details",
    "one shell command failed",
    "one event has missing capture fields",
    "one event has redacted fields (values hidden; run inspect on related events to see redacted paths)",
    "one event has truncated fields (large values shortened; run inspect to see truncated paths)",
  ]);
});

test("buildDebrief combines failed bash commands that have no exit-code details into one review note", () => {
  const summary = buildDebrief([
    event(1, "session.started", { timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "tool.requested", { toolName: "bash", toolCallId: "call-1", payload: { toolCallId: "call-1", input: { command: "npm test" } } }),
    event(3, "tool.completed", { toolName: "bash", toolCallId: "call-1", payload: { toolCallId: "call-1", isError: true } }),
    event(4, "session.shutdown", { timestamp: "2026-08-03T12:00:01.000Z" }),
  ]);

  assert.equal(summary.failedCommands, 1);
  assert.deepEqual(summary.worthReviewing, ["shell command failed without exit-code details: `npm test`"]);
});

test("buildDebrief extracts bash exit code from command output when details are empty", () => {
  const summary = buildDebrief([
    event(1, "session.started", { timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "tool.requested", { toolName: "bash", toolCallId: "call-1", payload: { toolCallId: "call-1", input: { command: "bashguard debrief session" } } }),
    event(3, "tool.completed", {
      toolName: "bash",
      toolCallId: "call-1",
      payload: {
        toolCallId: "call-1",
        isError: true,
        details: {},
        content: [{ type: "text", text: "/bin/bash: bashguard: command not found\n\n\nCommand exited with code 127" }],
      },
    }),
    event(4, "session.shutdown", { timestamp: "2026-08-03T12:00:01.000Z" }),
  ]);

  assert.equal(summary.failedCommands, 1);
  assert.deepEqual(summary.worthReviewing, ["shell command failed with exit 127: `bashguard debrief session`"]);
});

test("formatDebrief renders a concise aligned completed-session summary", () => {
  const output = formatDebrief({
    durationMs: 8_000,
    prompts: 1,
    toolCalls: 4,
    shellCommands: 2,
    filesObserved: 2,
    fileToolActions: 2,
    failedCommands: 1,
    riskyCommands: 1,
    gitStatus: "clean -> dirty",
    gitBranch: "main",
    gitWorktree: "/tmp/project",
    gitChangedPaths: "0 -> 2",
    captureState: "Partial",
    worthReviewing: ["one shell command failed"],
    fileActivity: [
      "read README.md\n  Meaning: Pi read file contents\n  Evidence: read tool event\n  Inspect: --event 3",
      "write tool docs/example.md\n  Meaning: Pi wrote full file content; may create, overwrite, or leave content unchanged\n  Evidence: write tool event\n  Inspect: --event 7",
    ],
  });

  assert.match(output, /Session complete/);
  assert.match(output, /Duration\s+8s/);
  assert.match(output, /Prompts\s+1/);
  assert.match(output, /Tool calls\s+4/);
  assert.match(output, /Shell commands\s{2,}2/);
  assert.match(output, /Files observed\s{2,}2/);
  assert.match(output, /File tool actions\s{2,}2/);
  assert.match(output, /Failed commands\s{2,}1/);
  assert.match(output, /Risk notices\s{2,}1/);
  assert.match(output, /Git status\s{2,}clean -> dirty/);
  assert.match(output, /Git branch\s{2,}main/);
  assert.match(output, /Git worktree\s{2,}\/tmp\/project/);
  assert.match(output, /Git changed paths\s{2,}0 -> 2/);
  assert.match(output, /Capture state\s{2,}Partial/);
  assert.match(output, /Worth reviewing/);
  assert.match(output, /- one shell command failed/);
  assert.match(output, /File tool activity/);
  assert.match(output, /- read README\.md\n  Meaning: Pi read file contents\n  Evidence: read tool event\n  Inspect: --event 3/);
  assert.match(output, /- write tool docs\/example\.md\n  Meaning: Pi wrote full file content; may create, overwrite, or leave content unchanged\n  Evidence: write tool event\n  Inspect: --event 7/);
});

test("buildDebrief uses plural wording for multiple truncated events", () => {
  const summary = buildDebrief([
    event(1, "tool.completed", { capture: { missing: [], redacted: [], truncated: ["payload.details.patch"] } }),
    event(2, "tool.completed", { capture: { missing: [], redacted: [], truncated: ["payload.details.diff"] } }),
  ]);

  assert.deepEqual(summary.worthReviewing, [
    "2 events have truncated fields (large values shortened; run inspect to see truncated paths)",
  ]);
});

test("buildDebrief reports capture gap events", () => {
  const summary = buildDebrief([
    event(1, "session.started"),
    event(2, "capture.gap", { evidence: "missing", capture: { missing: ["event:tool.completed"], redacted: [], truncated: [] }, payload: { reason: "failed to persist tool.completed event", failedToolName: "bash", command: "curl google.com" } }),
    event(3, "session.shutdown"),
  ]);

  assert.equal(summary.captureState, "Partial");
  assert.deepEqual(summary.worthReviewing, ["one capture gap occurred during recording: bash `curl google.com`"]);
});
