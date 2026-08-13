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

test("attach completes an event whose JSONL line was partial at the startup boundary", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "bashguard-attach-boundary-"));
  t.after(async () => rm(dataRoot, { recursive: true, force: true }));
  const sessionId = "attach-boundary-session";
  const directory = join(dataRoot, sessionId);
  const eventsFile = join(directory, "events.jsonl");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "session.json"), `${JSON.stringify({ schemaVersion: 1, sessionId, processId: process.pid })}\n`);
  const complete = Buffer.from(`${JSON.stringify(event(1, "start001", "session.started"))}\n`);
  const liveLine = Buffer.from(JSON.stringify(event(2, "livepart", "bash.user_requested", { command: "echo café-boundary" })));
  const multibyteStart = liveLine.indexOf(Buffer.from("é"));
  const splitAt = multibyteStart + 1;
  await writeFile(eventsFile, Buffer.concat([complete, liveLine.subarray(0, splitAt)]));

  const child = spawn(process.execPath, ["--experimental-strip-types", "src/cli.ts", "attach", sessionId, "--history", "0"], {
    cwd: process.cwd(),
    env: { ...process.env, BASHGUARD_DATA_DIR: dataRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  for (let attempt = 0; attempt < 100 && !stdout.includes("Following live events"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.match(stdout, /Following live events/);

  await appendFile(eventsFile, Buffer.concat([
    liveLine.subarray(splitAt),
    Buffer.from(`\n${JSON.stringify(event(3, "shutdown", "session.shutdown"))}\n`),
  ]));
  await new Promise<void>((resolve, reject) => child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`attach exited ${code}: ${stderr}`))));
  assert.match(stdout, /café-boundary/);
  assert.doesNotMatch(stdout, /�/);
  assert.match(stdout, /Pi session ended/);
});

test("attach preserves UTF-8 split across live polling cycles", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "bashguard-attach-live-utf8-"));
  t.after(async () => rm(dataRoot, { recursive: true, force: true }));
  const sessionId = "attach-live-utf8-session";
  const directory = join(dataRoot, sessionId);
  const eventsFile = join(directory, "events.jsonl");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "session.json"), `${JSON.stringify({ schemaVersion: 1, sessionId, processId: process.pid })}\n`);
  await writeFile(eventsFile, `${JSON.stringify(event(1, "start001", "session.started"))}\n`);

  const child = spawn(process.execPath, ["--experimental-strip-types", "src/cli.ts", "attach", sessionId, "--history", "0"], {
    cwd: process.cwd(), env: { ...process.env, BASHGUARD_DATA_DIR: dataRoot }, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  for (let attempt = 0; attempt < 100 && !stdout.includes("Following live events"); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.match(stdout, /Following live events/);

  const liveLine = Buffer.from(JSON.stringify(event(2, "liveutf8", "bash.user_requested", { command: "echo café-live" })));
  const splitAt = liveLine.indexOf(Buffer.from("é")) + 1;
  await appendFile(eventsFile, liveLine.subarray(0, splitAt));
  await new Promise((resolve) => setTimeout(resolve, 400));
  await appendFile(eventsFile, Buffer.concat([liveLine.subarray(splitAt), Buffer.from(`\n${JSON.stringify(event(3, "shutdown", "session.shutdown"))}\n`)]));

  await new Promise<void>((resolve, reject) => child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`attach exited ${code}: ${stderr}`))));
  assert.match(stdout, /café-live/);
  assert.doesNotMatch(stdout, /�/);
});

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
  assert.match(stdout, /Live status/);
  assert.match(stdout, /State\s+active/);
  assert.match(stdout, /Last activity\s+You ran · echo historical-four/);
  assert.match(stdout, /Evidence\s+recorded event/);
  assert.match(stdout, /Capture\s+No recorded capture limitations/);
  assert.match(stdout, /Events\s+6/);
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
