import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function event(sequence: number, id: string, type: string, payload: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id,
    sequence,
    timestamp: "2026-08-13T12:00:00.000Z",
    type,
    evidence: "observed",
    sessionId: "attach-history-session",
    cwd: "/tmp/attach-history",
    payload,
    capture: { missing: [], redacted: [], truncated: [] },
  };
}

test("attach bounds startup history but streams every new narrated event", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "bashguard-attach-history-"));
  t.after(async () => rm(dataRoot, { recursive: true, force: true }));
  const sessionId = "attach-history-session";
  const directory = join(dataRoot, sessionId);
  const eventsFile = join(directory, "events.jsonl");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "session.json"), `${JSON.stringify({
    schemaVersion: 1,
    sessionId,
    cwd: "/tmp/attach-history",
    repository: "attach-history",
    processId: process.pid,
  })}\n`);
  const existing = [
    event(1, "hist0001", "session.started"),
    event(2, "raw00002", "message.started"),
    event(3, "hist0002", "bash.user_requested", { command: "echo historical-one" }),
    event(4, "hist0003", "bash.user_requested", { command: "echo historical-two" }),
    event(5, "hist0004", "bash.user_requested", { command: "echo historical-three" }),
    event(6, "hist0005", "bash.user_requested", { command: "echo historical-four" }),
  ];
  await writeFile(eventsFile, `${existing.map((item) => JSON.stringify(item)).join("\n")}\n`);

  const child = spawn(process.execPath, ["--experimental-strip-types", "src/cli.ts", "attach", sessionId, "--history", "2"], {
    cwd: process.cwd(),
    env: { ...process.env, BASHGUARD_DATA_DIR: dataRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGTERM");
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const waitFor = async (needle: string): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (stdout.includes(needle)) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${needle}. stdout=${stdout} stderr=${stderr}`);
  };

  await waitFor("Following live events");
  assert.doesNotMatch(stdout, /historical-one|historical-two/);
  assert.match(stdout, /historical-three/);
  assert.match(stdout, /historical-four/);
  assert.match(stdout, /Showing latest 2 of 5 narrated historical events/);

  await appendFile(eventsFile, `${JSON.stringify(event(7, "live0001", "bash.user_requested", { command: "echo live-one" }))}\n`);
  await appendFile(eventsFile, `${JSON.stringify(event(8, "live0002", "bash.user_requested", { command: "echo live-two" }))}\n`);
  await appendFile(eventsFile, `${JSON.stringify(event(9, "shutdown", "session.shutdown"))}\n`);

  await new Promise<void>((resolve, reject) => {
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`attach exited ${code}: ${stderr}`)));
  });
  assert.match(stdout, /live-one/);
  assert.match(stdout, /live-two/);
  assert.match(stdout, /Pi session ended/);
});
