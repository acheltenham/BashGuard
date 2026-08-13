import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

async function runBaseline(): Promise<any> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "scripts/milestone-0-baseline.ts", "--samples", "3", "--json"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`baseline exited ${code}: ${stderr}`));
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`invalid baseline JSON: ${stdout}\n${stderr}`, { cause: error }));
      }
    });
  });
}

test("Milestone 0 baseline measures live attach latency and storage overhead", async () => {
  const result = await runBaseline();

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.latency.sampleCount, 3);
  assert.equal(result.latency.samplesMs.length, 3);
  assert.ok(result.latency.samplesMs.every((value: unknown) => typeof value === "number" && value >= 0));
  assert.ok(result.latency.initialAttachMs >= 0);
  assert.equal(result.storage.eventCount, 7);
  assert.ok(result.storage.eventsBytes > 0);
  assert.ok(result.storage.metadataBytes > 0);
  assert.ok(result.storage.bytesPerEvent > 0);
  assert.deepEqual(Object.keys(result.storage.eventBytes), [
    "session.started",
    "tool.requested:shell",
    "tool.completed:shell",
    "tool.requested:edit",
    "tool.completed:edit",
    "tool.completed:truncated",
    "git.status.snapshot",
  ]);
});
