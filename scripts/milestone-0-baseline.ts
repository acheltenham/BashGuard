#!/usr/bin/env node

import { spawn } from "node:child_process";
import { appendFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const root = process.cwd();
const args = process.argv.slice(2);
const sampleArg = args.indexOf("--samples");
const sampleCount = sampleArg >= 0 ? Number(args[sampleArg + 1]) : 20;
const jsonOutput = args.includes("--json");
if (!Number.isInteger(sampleCount) || sampleCount < 1) throw new Error("--samples must be a positive integer");

type EventInput = {
  id: string;
  sequence: number;
  type: string;
  toolName?: string;
  payload?: Record<string, unknown>;
  capture?: { missing: string[]; redacted: string[]; truncated: string[] };
};

function event(sessionId: string, input: EventInput): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: input.id,
    sequence: input.sequence,
    timestamp: new Date().toISOString(),
    type: input.type,
    evidence: "observed",
    sessionId,
    repository: "baseline-project",
    cwd: "/tmp/bashguard-baseline-project",
    toolName: input.toolName,
    payload: input.payload ?? {},
    capture: input.capture ?? { missing: [], redacted: [], truncated: [] },
  };
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function measureLatency(samples: number): Promise<Record<string, unknown>> {
  const dataRoot = await mkdtemp(join(tmpdir(), "bashguard-latency-baseline-"));
  const sessionId = "latency-baseline";
  const directory = join(dataRoot, sessionId);
  const eventsFile = join(directory, "events.jsonl");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "session.json"), `${JSON.stringify({
    schemaVersion: 1,
    sessionId,
    repository: "baseline-project",
    cwd: "/tmp/bashguard-baseline-project",
    startedAt: new Date().toISOString(),
    processId: process.pid,
    piMode: "non-interactive",
  }, null, 2)}\n`);
  await writeFile(eventsFile, `${JSON.stringify(event(sessionId, { id: "baseline-start", sequence: 1, type: "session.started" }))}\n`);

  const child = spawn(process.execPath, ["--experimental-strip-types", "src/cli.ts", "attach", sessionId], {
    cwd: root,
    env: { ...process.env, BASHGUARD_DATA_DIR: dataRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let stderr = "";
  const waiters: Array<{ marker: string; resolve: () => void }> = [];
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
    for (const waiter of [...waiters]) {
      if (!output.includes(waiter.marker)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const waitFor = (marker: string, timeoutMs = 5_000): Promise<void> => new Promise((resolve, reject) => {
    if (output.includes(marker)) return resolve();
    const waiter = { marker, resolve };
    waiters.push(waiter);
    const timeout = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error(`Timed out waiting for ${marker}. stderr: ${stderr}`));
    }, timeoutMs);
    waiter.resolve = () => {
      clearTimeout(timeout);
      resolve();
    };
  });

  const startedAt = performance.now();
  try {
    await waitFor("Pi session started");
    const initialAttachMs = round(performance.now() - startedAt);
    await waitFor("Following live events");
    const samplesMs: number[] = [];
    for (let index = 0; index < samples; index += 1) {
      const id = `lat${String(index + 1).padStart(5, "0")}`;
      const appendStartedAt = performance.now();
      const visible = waitFor(id.slice(0, 8));
      await appendFile(eventsFile, `${JSON.stringify(event(sessionId, {
        id,
        sequence: index + 2,
        type: "bash.user_requested",
        payload: { command: `echo latency-${index + 1}` },
      }))}\n`);
      await visible;
      samplesMs.push(round(performance.now() - appendStartedAt));
    }
    await appendFile(eventsFile, `${JSON.stringify(event(sessionId, {
      id: "baseline-shutdown",
      sequence: samples + 2,
      type: "session.shutdown",
    }))}\n`);
    await new Promise<void>((resolve, reject) => {
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`attach exited ${code}: ${stderr}`)));
    });
    return {
      initialAttachMs,
      sampleCount: samples,
      samplesMs,
      medianMs: round(percentile(samplesMs, 0.5)),
      p95Ms: round(percentile(samplesMs, 0.95)),
      maxMs: round(Math.max(...samplesMs)),
      pollIntervalMs: 250,
    };
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await rm(dataRoot, { recursive: true, force: true });
  }
}

function measureStorage(): Record<string, unknown> {
  const sessionId = "storage-baseline";
  const fixtures: Array<[string, EventInput]> = [
    ["session.started", { id: "storage-0001", sequence: 1, type: "session.started", payload: { event: { type: "session_start" } } }],
    ["tool.requested:shell", { id: "storage-0002", sequence: 2, type: "tool.requested", toolName: "bash", payload: { toolCallId: "shell-1", toolName: "bash", input: { command: "npm test" } } }],
    ["tool.completed:shell", { id: "storage-0003", sequence: 3, type: "tool.completed", toolName: "bash", payload: { toolCallId: "shell-1", toolName: "bash", content: [{ type: "text", text: "tests passed" }], details: { exitCode: 0 }, isError: false } }],
    ["tool.requested:edit", { id: "storage-0004", sequence: 4, type: "tool.requested", toolName: "edit", payload: { toolCallId: "edit-1", toolName: "edit", input: { path: "README.md", edits: [{ oldText: "old", newText: "new" }] } } }],
    ["tool.completed:edit", { id: "storage-0005", sequence: 5, type: "tool.completed", toolName: "edit", payload: { toolCallId: "edit-1", toolName: "edit", content: [{ type: "text", text: "Updated README.md" }], details: { firstChangedLine: 1 }, isError: false } }],
    ["tool.completed:truncated", { id: "storage-0006", sequence: 6, type: "tool.completed", toolName: "bash", payload: { toolCallId: "shell-large", toolName: "bash", content: [{ type: "text", text: `${"x".repeat(512)}\n...[truncated 2048 characters]` }] }, capture: { missing: [], redacted: [], truncated: ["payload.content.0.text"] } }],
    ["git.status.snapshot", { id: "storage-0007", sequence: 7, type: "git.status.snapshot", payload: { phase: "shutdown", isRepository: true, branch: "main", worktree: "/tmp/bashguard-baseline-project", changedFiles: ["README.md"], changedFileDetails: [{ path: "README.md", status: "M", additions: 1, deletions: 1, lineRanges: ["1"] }], changedFileCount: 1 } }],
  ];
  const lines = fixtures.map(([, input]) => `${JSON.stringify(event(sessionId, input))}\n`);
  const metadata = `${JSON.stringify({
    schemaVersion: 1,
    sessionId,
    repository: "baseline-project",
    cwd: "/tmp/bashguard-baseline-project",
    startedAt: "2026-08-01T00:00:00.000Z",
    processId: 12345,
    piMode: "non-interactive",
  }, null, 2)}\n`;
  const eventsBytes = lines.reduce((total, line) => total + Buffer.byteLength(line), 0);
  return {
    eventCount: fixtures.length,
    eventsBytes,
    metadataBytes: Buffer.byteLength(metadata),
    totalBytes: eventsBytes + Buffer.byteLength(metadata),
    bytesPerEvent: round(eventsBytes / fixtures.length),
    eventBytes: Object.fromEntries(fixtures.map(([name], index) => [name, Buffer.byteLength(lines[index]!)])),
  };
}

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
  },
  latency: await measureLatency(sampleCount),
  storage: measureStorage(),
};

if (jsonOutput) process.stdout.write(`${JSON.stringify(result)}\n`);
else {
  process.stdout.write(`Milestone 0 baseline\n\nLatency\n${JSON.stringify(result.latency, null, 2)}\n\nStorage\n${JSON.stringify(result.storage, null, 2)}\n`);
}
