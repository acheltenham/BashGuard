import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import { portablePtyUnavailableReason, runPortablePty, waitForExit } from "./test-process.ts";

test("portable PTY can schedule input after an observed startup marker", async (t) => {
  const unavailable = portablePtyUnavailableReason();
  if (unavailable) return t.skip(unavailable);
  const result = await runPortablePty({
    scenario: "sleep 0.3\nprintf 'READY\\n'\nIFS= read -r answer\nprintf 'GOT:%s\\n' \"$answer\"",
    sendAfterOutput: "READY",
    send: [{ afterMs: 0, text: "q\n" }],
  });
  assert.equal(result.exitCode, 0);
  assert.ok(result.transcript.indexOf("READY") < result.transcript.indexOf("q"));
  assert.match(result.transcript, /GOT:q/);
});

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
