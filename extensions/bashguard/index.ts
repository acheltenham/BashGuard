import { execFile } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type EvidenceKind = "observed" | "reported" | "inferred" | "redacted" | "missing";

type CaptureMetadata = {
  missing: string[];
  redacted: string[];
  truncated: string[];
};

type BashGuardEvent = {
  schemaVersion: 1;
  id: string;
  sequence: number;
  timestamp: string;
  type: string;
  evidence: EvidenceKind;
  sessionId: string;
  repository?: string;
  cwd: string;
  turnId?: string;
  toolCallId?: string;
  toolName?: string;
  payload: Record<string, unknown>;
  capture: CaptureMetadata;
};

type SessionState = {
  sessionId: string;
  sequence: number;
  directory: string;
  eventsFile: string;
};

const execFileAsync = promisify(execFile);

const REDACTED = "[REDACTED]";
const MAX_TEXT_LENGTH = 16_000;
const SECRET_KEYS = new Set([
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "authToken",
  "secret",
  "clientSecret",
  "password",
  "passwd",
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "privateKey",
  "private_key",
]);

function normalizeKey(key: string): string {
  return key.replace(/[-_]/g, "").toLowerCase();
}

const NORMALIZED_SECRET_KEYS = new Set(Array.from(SECRET_KEYS, normalizeKey));

function shouldRedactKey(key: string): boolean {
  return NORMALIZED_SECRET_KEYS.has(normalizeKey(key));
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function truncate(value: string, path: string, truncated: string[]): string {
  if (value.length <= MAX_TEXT_LENGTH) return value;
  truncated.push(path);
  return `${value.slice(0, MAX_TEXT_LENGTH)}\n...[truncated ${value.length - MAX_TEXT_LENGTH} characters]`;
}

function sanitize(value: unknown, key = "", depth = 0, redacted: string[] = [], truncated: string[] = [], path = "payload"): unknown {
  if (depth > 8) return "[MAX_DEPTH]";
  if (shouldRedactKey(key)) {
    redacted.push(path);
    return REDACTED;
  }
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncate(value, path, truncated);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncate(value.message, `${path}.message`, truncated),
      stack: value.stack ? truncate(value.stack, `${path}.stack`, truncated) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((entry, index) => sanitize(entry, key, depth + 1, redacted, truncated, `${path}.${index}`));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      result[childKey] = sanitize(childValue, childKey, depth + 1, redacted, truncated, `${path}.${childKey}`);
    }
    return result;
  }
  return String(value);
}

function resolveSessionId(ctx: ExtensionContext): string {
  const manager = ctx.sessionManager as unknown as Record<string, unknown>;
  for (const candidate of ["sessionId", "id", "sessionFile", "file"]) {
    const value = manager[candidate];
    if (typeof value === "string" && value.length > 0) return basename(value, ".jsonl");
  }

  const leaf = ctx.sessionManager.getLeafId?.();
  if (leaf) return `leaf-${leaf}`;
  return `session-${Date.now().toString(36)}`;
}

function getDataRoot(): string {
  return process.env.BASHGUARD_DATA_DIR ?? join(homedir(), ".bashguard", "sessions");
}

function resolveSessionName(ctx: ExtensionContext): string | undefined {
  const manager = ctx.sessionManager as unknown as Record<string, unknown>;
  for (const candidate of ["name", "title", "sessionName"]) {
    const value = manager[candidate];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

type GitChangedFileDetail = {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
  lineRanges?: string[];
};

function parseGitStatusPorcelain(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3));
}

function parseGitNumstat(stdout: string): Map<string, { additions: number; deletions: number }> {
  const stats = new Map<string, { additions: number; deletions: number }>();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [additionsRaw, deletionsRaw, path] = line.split("\t");
    if (!path) continue;
    const additions = additionsRaw === "-" ? 0 : Number(additionsRaw);
    const deletions = deletionsRaw === "-" ? 0 : Number(deletionsRaw);
    if (Number.isFinite(additions) && Number.isFinite(deletions)) stats.set(path, { additions, deletions });
  }
  return stats;
}

function mergeNumstat(...maps: Array<Map<string, { additions: number; deletions: number }>>): Map<string, { additions: number; deletions: number }> {
  const merged = new Map<string, { additions: number; deletions: number }>();
  for (const map of maps) {
    for (const [path, stats] of map) {
      const existing = merged.get(path) ?? { additions: 0, deletions: 0 };
      merged.set(path, {
        additions: existing.additions + stats.additions,
        deletions: existing.deletions + stats.deletions,
      });
    }
  }
  return merged;
}

function formatLineRange(start: number, count: number): string {
  if (count <= 1) return String(start);
  return `${start}-${start + count - 1}`;
}

function parseGitDiffLineRanges(stdout: string): Map<string, string[]> {
  const ranges = new Map<string, string[]>();
  let currentPath: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    const diffMatch = line.match(/^diff --git a\/(.*) b\/(.*)$/);
    if (diffMatch?.[2]) {
      currentPath = diffMatch[2];
      continue;
    }
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!currentPath || !hunkMatch?.[1]) continue;
    const start = Number(hunkMatch[1]);
    const count = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]);
    if (!Number.isFinite(start) || !Number.isFinite(count)) continue;
    const fileRanges = ranges.get(currentPath) ?? [];
    fileRanges.push(formatLineRange(start, count));
    ranges.set(currentPath, fileRanges);
  }
  return ranges;
}

function mergeLineRanges(...maps: Array<Map<string, string[]>>): Map<string, string[]> {
  const merged = new Map<string, string[]>();
  for (const map of maps) {
    for (const [path, ranges] of map) {
      merged.set(path, [...(merged.get(path) ?? []), ...ranges]);
    }
  }
  return merged;
}

function parseGitStatusDetails(stdout: string, stats: Map<string, { additions: number; deletions: number }>, lineRanges: Map<string, string[]>): GitChangedFileDetail[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim() || line.slice(0, 2);
      const path = line.slice(3);
      const detail: GitChangedFileDetail = { path, status };
      const stat = stats.get(path);
      if (stat) {
        detail.additions = stat.additions;
        detail.deletions = stat.deletions;
      }
      const ranges = lineRanges.get(path);
      if (ranges && ranges.length > 0) detail.lineRanges = Array.from(new Set(ranges));
      return detail;
    });
}

async function readGitValue(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: 2_000,
      maxBuffer: 64 * 1024,
    });
    const value = stdout.trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

async function readGitStdout(cwd: string, args: string[], maxBuffer = 128 * 1024): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: 2_000,
      maxBuffer,
    });
    return stdout;
  } catch {
    return "";
  }
}

async function readGitStatus(cwd: string, phase: "start" | "shutdown"): Promise<Record<string, unknown>> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1"], {
      cwd,
      timeout: 2_000,
      maxBuffer: 128 * 1024,
    });
    const changedFiles = parseGitStatusPorcelain(stdout);
    const unstagedStats = parseGitNumstat(await readGitStdout(cwd, ["diff", "--numstat"]));
    const stagedStats = parseGitNumstat(await readGitStdout(cwd, ["diff", "--cached", "--numstat"]));
    const unstagedLineRanges = parseGitDiffLineRanges(await readGitStdout(cwd, ["diff", "--unified=0"]));
    const stagedLineRanges = parseGitDiffLineRanges(await readGitStdout(cwd, ["diff", "--cached", "--unified=0"]));
    const changedFileDetails = parseGitStatusDetails(stdout, mergeNumstat(unstagedStats, stagedStats), mergeLineRanges(unstagedLineRanges, stagedLineRanges));
    return {
      phase,
      isRepository: true,
      branch: await readGitValue(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
      worktree: await readGitValue(cwd, ["rev-parse", "--show-toplevel"]),
      gitCommonDir: await readGitValue(cwd, ["rev-parse", "--git-common-dir"]),
      changedFiles,
      changedFileDetails,
      changedFileCount: changedFiles.length,
    };
  } catch (error) {
    return {
      phase,
      isRepository: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function createSessionState(ctx: ExtensionContext): Promise<SessionState> {
  const sessionId = resolveSessionId(ctx);
  const directory = join(getDataRoot(), sessionId);
  await mkdir(directory, { recursive: true });

  const metadata = {
    schemaVersion: 1,
    sessionId,
    name: resolveSessionName(ctx),
    cwd: ctx.cwd,
    repository: basename(ctx.cwd),
    startedAt: new Date().toISOString(),
    processId: process.pid,
    piMode: ctx.hasUI ? "interactive" : "non-interactive",
  };

  await writeFile(join(directory, "session.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return {
    sessionId,
    sequence: 0,
    directory,
    eventsFile: join(directory, "events.jsonl"),
  };
}

export default function bashGuard(pi: ExtensionAPI): void {
  let state: SessionState | undefined;
  let writeChain: Promise<void> = Promise.resolve();

  const record = async (
    type: string,
    ctx: ExtensionContext,
    payload: Record<string, unknown> = {},
    evidence: EvidenceKind = "observed",
  ): Promise<void> => {
    if (!state) state = await createSessionState(ctx);
    const sequence = ++state.sequence;
    const redacted: string[] = [];
    const truncated: string[] = [];
    const safePayload = sanitize(payload, "", 0, redacted, truncated) as Record<string, unknown>;
    const missing: string[] = [];
    const event: BashGuardEvent = {
      schemaVersion: 1,
      id: makeId(),
      sequence,
      timestamp: new Date().toISOString(),
      type,
      evidence,
      sessionId: state.sessionId,
      repository: basename(ctx.cwd),
      cwd: ctx.cwd,
      turnId: typeof safePayload.turnId === "string" ? safePayload.turnId : undefined,
      toolCallId: typeof safePayload.toolCallId === "string" ? safePayload.toolCallId : undefined,
      toolName: typeof safePayload.toolName === "string" ? safePayload.toolName : undefined,
      payload: safePayload,
      capture: { missing, redacted, truncated },
    };

    const eventLine = `${JSON.stringify(event)}\n`;
    writeChain = writeChain
      .then(() => appendFile(state!.eventsFile, eventLine, "utf8"))
      .catch(async (error: unknown) => {
        const gapSequence = ++state!.sequence;
        const gapEvent: BashGuardEvent = {
          schemaVersion: 1,
          id: makeId(),
          sequence: gapSequence,
          timestamp: new Date().toISOString(),
          type: "capture.gap",
          evidence: "missing",
          sessionId: state!.sessionId,
          repository: basename(ctx.cwd),
          cwd: ctx.cwd,
          payload: {
            reason: `failed to persist ${type} event`,
            failedEventType: type,
            failedToolName: typeof safePayload.toolName === "string" ? safePayload.toolName : undefined,
            failedToolCallId: typeof safePayload.toolCallId === "string" ? safePayload.toolCallId : undefined,
            command: typeof (safePayload.input as Record<string, unknown> | undefined)?.command === "string"
              ? (safePayload.input as Record<string, unknown>).command
              : undefined,
            path: typeof (safePayload.input as Record<string, unknown> | undefined)?.path === "string"
              ? (safePayload.input as Record<string, unknown>).path
              : undefined,
            error: sanitize(error),
          } as Record<string, unknown>,
          capture: {
            missing: [`event:${type}`],
            redacted: [],
            truncated: [],
          },
        };

        try {
          await appendFile(state!.eventsFile, `${JSON.stringify(gapEvent)}\n`, "utf8");
        } catch (gapError) {
          if (ctx.hasUI) {
            const message = gapError instanceof Error ? gapError.message : String(gapError);
            ctx.ui.notify(`BashGuard capture failed: ${message}`, "error");
          }
        }
      });
    await writeChain;
  };

  const recordGitStatus = async (ctx: ExtensionContext, phase: "start" | "shutdown"): Promise<void> => {
    await record("git.status.snapshot", ctx, await readGitStatus(ctx.cwd, phase));
  };

  pi.on("session_start", async (event, ctx) => {
    state = await createSessionState(ctx);
    await record("session.started", ctx, { event });
    await recordGitStatus(ctx, "start");
    if (ctx.hasUI) {
      ctx.ui.setStatus("bashguard", `BashGuard recording · ${state.sessionId}`);
      ctx.ui.notify(`BashGuard recording to ${state.directory}`, "info");
    }
  });

  pi.on("session_shutdown", async (event, ctx) => {
    await recordGitStatus(ctx, "shutdown");
    await record("session.shutdown", ctx, { event });
    await writeChain;
    if (ctx.hasUI) ctx.ui.setStatus("bashguard", undefined);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    await record("agent.before_start", ctx, {
      prompt: event.prompt,
      systemPromptOptions: event.systemPromptOptions,
    });
  });

  pi.on("agent_start", async (event, ctx) => {
    await record("agent.started", ctx, { event });
  });

  pi.on("agent_end", async (event, ctx) => {
    await record("agent.ended", ctx, {
      messageCount: Array.isArray(event.messages) ? event.messages.length : undefined,
      messages: event.messages,
    });
  });

  pi.on("turn_start", async (event, ctx) => {
    await record("turn.started", ctx, { event });
  });

  pi.on("turn_end", async (event, ctx) => {
    await record("turn.ended", ctx, { event });
  });

  pi.on("message_start", async (event, ctx) => {
    await record("message.started", ctx, { event });
  });

  pi.on("message_end", async (event, ctx) => {
    await record("message.ended", ctx, { event });
  });

  pi.on("tool_call", async (event, ctx) => {
    await record("tool.requested", ctx, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      input: event.input,
    });
  });

  pi.on("tool_result", async (event, ctx) => {
    await record("tool.completed", ctx, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      input: event.input,
      content: event.content,
      details: event.details,
      isError: event.isError,
    });
  });

  pi.on("user_bash", async (event, ctx) => {
    await record("bash.user_requested", ctx, {
      command: event.command,
      excludeFromContext: event.excludeFromContext,
    });
  });

  pi.registerCommand("bashguard-status", {
    description: "Show where BashGuard is recording the current Pi session",
    handler: async (_args, ctx) => {
      if (!state) state = await createSessionState(ctx);
      const summary = [
        `Session: ${state.sessionId}`,
        `Events: ${state.sequence}`,
        `Directory: ${state.directory}`,
      ].join("\n");
      if (ctx.hasUI) ctx.ui.notify(summary, "info");
      else process.stdout.write(`${summary}\n`);
    },
  });
}
