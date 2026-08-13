import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import { waitForExit } from "./test-process.ts";

test("waitForExit handles an already-exited child", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(7)"], { stdio: "ignore" });
  assert.equal(await waitForExit(child, () => ({ stdout: "", stderr: "" })), 7);
  assert.equal(await waitForExit(child, () => ({ stdout: "", stderr: "" })), 7);
});

test("waitForExit kills a hung child and reports captured output", async (t) => {
  const child = spawn(process.execPath, ["-e", "console.log('started'); console.error('waiting'); setInterval(() => {}, 1000)"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });

  for (let attempt = 0; attempt < 100 && (!stdout.includes("started") || !stderr.includes("waiting")); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.match(stdout, /started/);
  assert.match(stderr, /waiting/);
  await assert.rejects(
    waitForExit(child, () => ({ stdout, stderr }), 50),
    /Timed out after 50ms[\s\S]*stdout:\nstarted[\s\S]*stderr:\nwaiting/,
  );
  assert.equal(child.killed, true);
});
