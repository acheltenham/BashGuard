import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverSessions, parseJsonlEvents, renderEvent } from "./cli.ts";

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
});
