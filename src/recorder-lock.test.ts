import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { acquireRecorderLock, releaseRecorderLock } from "../extensions/bashguard/recorder-lock.ts";

test("only one extension instance owns a session recorder lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bashguard-recorder-lock-"));
  const first = await acquireRecorderLock(directory, "/packages/first/bashguard.ts");
  const second = await acquireRecorderLock(directory, "/packages/second/bashguard.ts");

  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  assert.equal(second.owner?.source, "/packages/first/bashguard.ts");
  assert.equal(second.owner?.processId, process.pid);

  const persisted = JSON.parse(await readFile(join(directory, "recorder.lock"), "utf8"));
  assert.equal(persisted.ownerId, first.ownerId);
  assert.equal(persisted.source, "/packages/first/bashguard.ts");
});

test("only the owner can release a recorder lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bashguard-recorder-lock-"));
  const first = await acquireRecorderLock(directory, "/packages/first/bashguard.ts");
  assert.equal(first.acquired, true);

  await releaseRecorderLock(directory, "not-the-owner");
  const blocked = await acquireRecorderLock(directory, "/packages/second/bashguard.ts");
  assert.equal(blocked.acquired, false);

  await releaseRecorderLock(directory, first.ownerId);
  const replacement = await acquireRecorderLock(directory, "/packages/second/bashguard.ts");
  assert.equal(replacement.acquired, true);
});
