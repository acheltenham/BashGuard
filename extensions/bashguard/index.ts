import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
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

async function createSessionState(ctx: ExtensionContext): Promise<SessionState> {
  const sessionId = resolveSessionId(ctx);
  const directory = join(getDataRoot(), sessionId);
  await mkdir(directory, { recursive: true });

  const metadata = {
    schemaVersion: 1,
    sessionId,
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

    writeChain = writeChain.then(() => appendFile(state!.eventsFile, `${JSON.stringify(event)}\n`, "utf8"));
    await writeChain;
  };

  pi.on("session_start", async (event, ctx) => {
    state = await createSessionState(ctx);
    await record("session.started", ctx, { event });
    if (ctx.hasUI) {
      ctx.ui.setStatus("bashguard", `BashGuard recording · ${state.sessionId}`);
      ctx.ui.notify(`BashGuard recording to ${state.directory}`, "info");
    }
  });

  pi.on("session_shutdown", async (event, ctx) => {
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
