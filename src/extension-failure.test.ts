import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import bashGuard from "../extensions/bashguard/index.ts";

test("an unwritable event stream notifies Pi without rejecting the tool event", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "bashguard-extension-failure-"));
  const project = await mkdtemp(join(tmpdir(), "bashguard-extension-project-"));
  const previousDataRoot = process.env.BASHGUARD_DATA_DIR;
  process.env.BASHGUARD_DATA_DIR = dataRoot;

  try {
    const handlers = new Map<string, (event: any, ctx: any) => Promise<void>>();
    const notifications: Array<{ message: string; level: string }> = [];
    const pi = {
      on(name: string, handler: (event: any, ctx: any) => Promise<void>) {
        handlers.set(name, handler);
      },
      registerCommand() {},
    };
    const approvals = [true, false];
    const ctx = {
      cwd: project,
      hasUI: true,
      sessionManager: { sessionId: "failure-session", getLeafId: () => undefined },
      ui: {
        async confirm() { return approvals.shift() ?? false; },
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
        setStatus() {},
      },
    };

    bashGuard(pi as any);
    await handlers.get("session_start")?.({ type: "session_start" }, ctx);
    notifications.length = 0;

    const sessionDirectory = join(dataRoot, "failure-session");
    const eventsFile = join(sessionDirectory, "events.jsonl");
    await rename(eventsFile, join(sessionDirectory, "events.before-failure.jsonl"));
    await mkdir(eventsFile);

    const approved = await handlers.get("tool_call")?.({
      toolCallId: "call-approved",
      toolName: "bash",
      input: { command: "rm -rf disposable-approved-target" },
    }, ctx);
    assert.equal(approved, undefined, "capture failure must not reverse Run once");

    const declined = await handlers.get("tool_call")?.({
      toolCallId: "call-declined",
      toolName: "bash",
      input: { command: "rm -rf disposable-declined-target" },
    }, ctx);
    assert.deepEqual(declined, {
      block: true,
      reason: "BashGuard blocked recursive forced deletion because approval was declined.",
    });
    assert.ok(notifications.some(({ message, level }) => level === "error" && message.startsWith("BashGuard capture failed:")));
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
    if (previousDataRoot === undefined) delete process.env.BASHGUARD_DATA_DIR;
    else process.env.BASHGUARD_DATA_DIR = previousDataRoot;
  }
});
