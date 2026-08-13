import { open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

export type RecorderLockOwner = {
  ownerId: string;
  processId: number;
  source: string;
  acquiredAt: string;
};

export type RecorderLockResult =
  | { acquired: true; ownerId: string }
  | { acquired: false; owner?: RecorderLockOwner };

const LOCK_FILE = "recorder.lock";

function makeOwnerId(): string {
  return `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function processIsAlive(processId: number): boolean {
  if (!Number.isInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

async function readOwner(path: string): Promise<RecorderLockOwner | undefined> {
  try {
    const owner = JSON.parse(await readFile(path, "utf8")) as RecorderLockOwner;
    return typeof owner.ownerId === "string" && typeof owner.processId === "number" && typeof owner.source === "string"
      ? owner
      : undefined;
  } catch {
    return undefined;
  }
}

export async function acquireRecorderLock(directory: string, source: string): Promise<RecorderLockResult> {
  const path = join(directory, LOCK_FILE);
  const owner: RecorderLockOwner = {
    ownerId: makeOwnerId(),
    processId: process.pid,
    source,
    acquiredAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`, "utf8");
      } finally {
        await handle.close();
      }
      return { acquired: true, ownerId: owner.ownerId };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readOwner(path);
      if (existing && processIsAlive(existing.processId)) return { acquired: false, owner: existing };
      try {
        await unlink(path);
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") return { acquired: false, owner: existing };
      }
    }
  }

  return { acquired: false, owner: await readOwner(path) };
}

export async function releaseRecorderLock(directory: string, ownerId: string): Promise<void> {
  const path = join(directory, LOCK_FILE);
  const owner = await readOwner(path);
  if (owner?.ownerId !== ownerId) return;
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
