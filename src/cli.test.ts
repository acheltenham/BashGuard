import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildDebrief, discoverSessions, findEvent, formatDebrief, formatEventInspection, normalizeEvent, parseJsonlEvents, renderEvent } from "./cli.ts";

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

test("renderEvent narrates user bash distinctly from agent bash", () => {
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
});

test("findEvent resolves events by id or sequence string", () => {
  const events = [event(1, "session.started"), event(2, "tool.requested", { id: "evt-tool" })];

  assert.equal(findEvent(events, "evt-tool")?.sequence, 2);
  assert.equal(findEvent(events, "1")?.type, "session.started");
  assert.equal(findEvent(events, "missing"), undefined);
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

test("buildDebrief summarizes prompts, tools, shell commands, files, failures, and capture gaps", () => {
  const summary = buildDebrief([
    event(1, "session.started", { timestamp: "2026-08-03T12:00:00.000Z" }),
    event(2, "agent.before_start", { payload: { prompt: "Run tests" } }),
    event(3, "tool.requested", { toolName: "read", payload: { input: { path: "README.md" } } }),
    event(4, "tool.requested", { toolName: "bash", payload: { input: { command: "npm test" } } }),
    event(5, "tool.completed", { toolName: "bash", payload: { isError: false, details: { exitCode: 1 } } }),
    event(6, "tool.requested", { toolName: "edit", payload: { input: { path: "result.txt" } } }),
    event(7, "tool.requested", { toolName: "bash", capture: { missing: ["turnId"], redacted: ["payload.input.apiKey"], truncated: ["payload.input.edits.0.newText"] }, payload: { input: { command: "git status" } } }),
    event(8, "tool.completed", { toolName: "bash", payload: { isError: false } }),
    event(9, "session.shutdown", { timestamp: "2026-08-03T12:00:08.000Z" }),
  ]);

  assert.equal(summary.durationMs, 8_000);
  assert.equal(summary.prompts, 1);
  assert.equal(summary.toolCalls, 4);
  assert.equal(summary.shellCommands, 2);
  assert.equal(summary.filesObserved, 2);
  assert.equal(summary.failedCommands, 1);
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
    failedCommands: 1,
    captureState: "Partial",
    worthReviewing: ["one shell command failed"],
  });

  assert.match(output, /Session complete/);
  assert.match(output, /Duration\s+8s/);
  assert.match(output, /Prompts\s+1/);
  assert.match(output, /Tool calls\s+4/);
  assert.match(output, /Shell commands\s{2,}2/);
  assert.match(output, /Files observed\s{2,}2/);
  assert.match(output, /Failed commands\s{2,}1/);
  assert.match(output, /Capture state\s{2,}Partial/);
  assert.match(output, /Worth reviewing/);
  assert.match(output, /- one shell command failed/);
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
