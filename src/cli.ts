#!/usr/bin/env node

import { createReadStream, existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export type SessionMetadata = {
  schemaVersion?: number;
  sessionId: string;
  cwd?: string;
  repository?: string;
  startedAt?: string;
  processId?: number;
  piMode?: string;
};

export type CaptureMetadata = {
  missing: string[];
  redacted: string[];
  truncated: string[];
};

export type BashGuardEvent = {
  schemaVersion: number;
  id: string;
  sequence: number;
  timestamp: string;
  type: string;
  evidence?: string;
  sessionId: string;
  repository?: string;
  cwd?: string;
  turnId?: string;
  toolCallId?: string;
  toolName?: string;
  payload?: Record<string, unknown>;
  capture?: CaptureMetadata;
};

export type SessionSummary = {
  metadata: SessionMetadata;
  directory: string;
  eventsFile: string;
  modifiedAt: number;
  active: boolean;
};

export type DebriefSummary = {
  durationMs: number;
  prompts: number;
  toolCalls: number;
  shellCommands: number;
  filesObserved: number;
  failedCommands: number;
  captureState: "Complete" | "Partial";
  worthReviewing: string[];
};

const POLL_MS = 250;

function getDataRoot(): string {
  return process.env.BASHGUARD_DATA_DIR ?? join(homedir(), ".bashguard", "sessions");
}

function usage(): never {
  process.stderr.write(`BashGuard\n\nUsage:\n  bashguard sessions\n  bashguard attach [session-id]\n  bashguard inspect <session-id> --event <event-id-or-sequence>\n  bashguard debrief <session-id>\n\nEnvironment:\n  BASHGUARD_DATA_DIR  Override session storage directory\n`);
  process.exit(1);
}

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function processIsAlive(pid?: number): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function normalizeEvent(event: BashGuardEvent): BashGuardEvent {
  return {
    ...event,
    capture: {
      missing: Array.isArray(event.capture?.missing) ? event.capture.missing : [],
      redacted: Array.isArray(event.capture?.redacted) ? event.capture.redacted : [],
      truncated: Array.isArray(event.capture?.truncated) ? event.capture.truncated : [],
    },
  };
}

export function parseJsonlEvents(text: string): BashGuardEvent[] {
  const lines = text.split("\n");
  const hasCompleteFinalLine = text.endsWith("\n");
  if (!hasCompleteFinalLine) lines.pop();

  const events: BashGuardEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(normalizeEvent(JSON.parse(line) as BashGuardEvent));
    } catch {
      // Malformed complete lines are ignored in this first slice rather than crashing attachment.
    }
  }
  return events.sort((a, b) => a.sequence - b.sequence);
}

async function readExistingEvents(eventsFile: string): Promise<BashGuardEvent[]> {
  try {
    return parseJsonlEvents(await readFile(eventsFile, "utf8"));
  } catch {
    return [];
  }
}

function sessionHasShutdown(events: BashGuardEvent[]): boolean {
  return events.some((event) => event.type === "session.shutdown");
}

export async function discoverSessions(root = getDataRoot()): Promise<SessionSummary[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const sessions = await Promise.all(entries.map(async (entry): Promise<SessionSummary | undefined> => {
    const directory = join(root, entry);
    const metadataPath = join(directory, "session.json");
    const eventsFile = join(directory, "events.jsonl");
    const metadata = await readJsonFile<SessionMetadata>(metadataPath);
    if (!metadata?.sessionId || !existsSync(eventsFile)) return undefined;

    try {
      const info = await stat(eventsFile);
      const events = await readExistingEvents(eventsFile);
      const shutdownRecorded = sessionHasShutdown(events);
      return {
        metadata,
        directory,
        eventsFile,
        modifiedAt: info.mtimeMs,
        active: !shutdownRecorded && processIsAlive(metadata.processId),
      };
    } catch {
      return undefined;
    }
  }));

  return sessions
    .filter((session): session is SessionSummary => Boolean(session))
    .sort((a, b) => Number(b.active) - Number(a.active) || b.modifiedAt - a.modifiedAt);
}

function compactSessionId(sessionId: string): string {
  return sessionId.length > 18 ? `${sessionId.slice(0, 8)}…${sessionId.slice(-6)}` : sessionId;
}

function formatAge(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

async function listSessions(): Promise<void> {
  const sessions = await discoverSessions();
  if (sessions.length === 0) {
    process.stdout.write(`No BashGuard sessions found in ${getDataRoot()}\n`);
    return;
  }

  process.stdout.write("STATE     SESSION              REPOSITORY           UPDATED\n");
  for (const session of sessions) {
    const state = session.active ? "active" : "complete";
    const repo = session.metadata.repository ?? basename(session.metadata.cwd ?? "unknown");
    process.stdout.write(`${state.padEnd(9)} ${compactSessionId(session.metadata.sessionId).padEnd(20)} ${repo.slice(0, 20).padEnd(20)} ${formatAge(session.modifiedAt)}\n`);
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function renderEvent(event: BashGuardEvent): string | undefined {
  const payload = event.payload ?? {};

  switch (event.type) {
    case "session.started":
      return "Pi session started";
    case "session.shutdown":
      return "Pi session ended";
    case "agent.before_start": {
      const prompt = getString(payload.prompt)?.replace(/\s+/g, " ").trim();
      return prompt ? `Prompt · ${prompt.slice(0, 120)}` : "Prompt received";
    }
    case "tool.requested": {
      const tool = event.toolName ?? getString(payload.toolName) ?? "tool";
      const input = payload.input as Record<string, unknown> | undefined;
      if (tool === "bash") {
        const command = getString(input?.command);
        return command ? `Running · ${command}` : "Running shell command";
      }
      if (tool === "read") {
        const path = getString(input?.path);
        return path ? `Reading · ${path}` : "Reading file";
      }
      if (tool === "write") {
        const path = getString(input?.path);
        return path ? `Writing · ${path}` : "Writing file";
      }
      if (tool === "edit") {
        const path = getString(input?.path);
        return path ? `Editing · ${path}` : "Editing file";
      }
      return `Tool · ${tool}`;
    }
    case "tool.completed": {
      const tool = event.toolName ?? getString(payload.toolName) ?? "tool";
      const isError = payload.isError === true;
      const details = payload.details as Record<string, unknown> | undefined;
      const exitCode = getNumber(details?.exitCode);
      if (tool === "bash" && exitCode !== undefined) {
        return `${isError || exitCode !== 0 ? "Command failed" : "Command complete"} · exit ${exitCode}`;
      }
      return `${tool} ${isError ? "failed" : "complete"}`;
    }
    case "bash.user_requested": {
      const command = getString(payload.command);
      return command ? `You ran · ${command}` : "You ran a shell command";
    }
    case "agent.ended":
      return "Agent turn complete";
    default:
      return undefined;
  }
}

function renderTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function findEvent(events: BashGuardEvent[], eventIdOrSequence: string): BashGuardEvent | undefined {
  const sequence = Number(eventIdOrSequence);
  if (Number.isInteger(sequence) && sequence > 0) {
    const bySequence = events.find((event) => event.sequence === sequence);
    if (bySequence) return bySequence;
  }
  return events.find((event) => event.id === eventIdOrSequence);
}

function formatField(label: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return `${label.padEnd(16)} ${String(value)}`;
}

export function formatEventInspection(event: BashGuardEvent): string {
  const normalized = normalizeEvent(event);
  const payload = normalized.payload ?? {};
  const input = payload.input as Record<string, unknown> | undefined;
  const details = payload.details as Record<string, unknown> | undefined;
  const command = getString(payload.command) ?? getString(input?.command);
  const path = getString(payload.path) ?? getString(input?.path);
  const exitCode = getNumber(details?.exitCode);

  const lines = [
    "Event detail",
    "",
    formatField("Sequence", normalized.sequence),
    formatField("Event ID", normalized.id),
    formatField("Type", normalized.type),
    formatField("Timestamp", normalized.timestamp),
    formatField("Evidence", normalized.evidence ?? "unknown"),
    formatField("Missing", normalized.capture?.missing.join(", ")),
    formatField("Redacted", normalized.capture?.redacted.join(", ")),
    formatField("Truncated", normalized.capture?.truncated.join(", ")),
    formatField("Session", normalized.sessionId),
    formatField("Cwd", normalized.cwd),
    formatField("Tool", normalized.toolName ?? getString(payload.toolName)),
    formatField("Tool call", normalized.toolCallId ?? getString(payload.toolCallId)),
    formatField("Command", command),
    formatField("Path", path),
    formatField("Exit code", exitCode),
  ].filter((line): line is string => line !== undefined);

  lines.push("", "Payload", JSON.stringify(payload, null, 2));
  return `${lines.join("\n")}\n`;
}

function inputFor(event: BashGuardEvent): Record<string, unknown> | undefined {
  return event.payload?.input as Record<string, unknown> | undefined;
}

function toolNameFor(event: BashGuardEvent): string | undefined {
  return event.toolName ?? getString(event.payload?.toolName);
}

function pathFor(event: BashGuardEvent): string | undefined {
  const payload = event.payload ?? {};
  return getString(payload.path) ?? getString(inputFor(event)?.path);
}

function commandFor(event: BashGuardEvent): string | undefined {
  const payload = event.payload ?? {};
  return getString(payload.command) ?? getString(inputFor(event)?.command);
}

function toolCallIdFor(event: BashGuardEvent): string | undefined {
  return event.toolCallId ?? getString(event.payload?.toolCallId);
}

function bashExitCodeFor(event: BashGuardEvent): number | undefined {
  const detailsExitCode = getNumber((event.payload?.details as Record<string, unknown> | undefined)?.exitCode);
  if (detailsExitCode !== undefined) return detailsExitCode;

  const content = event.payload?.content;
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (typeof item !== "object" || item === null) continue;
    const text = getString((item as Record<string, unknown>).text);
    const match = text?.match(/Command exited with code (\d+)/);
    if (match?.[1]) return Number(match[1]);
  }
  return undefined;
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value === 1 ? "one" : value} ${value === 1 ? singular : plural}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function formatCommandReview(count: number, message: string, commands: string[]): string {
  const uniqueCommands = Array.from(new Set(commands.filter(Boolean)));
  if (count === 1 && uniqueCommands.length === 1) return `shell command ${message}: \`${uniqueCommands[0]}\``;
  if (uniqueCommands.length > 0 && uniqueCommands.length <= 3) {
    return `${formatCount(count, "shell command")} ${message}: ${uniqueCommands.map((command) => `\`${command}\``).join(", ")}`;
  }
  return `${formatCount(count, "shell command")} ${message}`;
}

export function buildDebrief(events: BashGuardEvent[]): DebriefSummary {
  const normalizedEvents = events.map(normalizeEvent);
  const timestamps = normalizedEvents
    .map((event) => Date.parse(event.timestamp))
    .filter((timestamp) => Number.isFinite(timestamp));
  const durationMs = timestamps.length > 1 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
  const toolRequests = normalizedEvents.filter((event) => event.type === "tool.requested");
  const shellRequests = toolRequests.filter((event) => toolNameFor(event) === "bash");
  const commandByToolCallId = new Map(
    shellRequests
      .map((event) => {
        const toolCallId = toolCallIdFor(event);
        const command = commandFor(event);
        return toolCallId && command ? ([toolCallId, command] as const) : undefined;
      })
      .filter((entry): entry is readonly [string, string] => entry !== undefined),
  );
  const commandForCompletion = (event: BashGuardEvent): string | undefined => {
    const directCommand = commandFor(event);
    if (directCommand) return directCommand;
    const toolCallId = toolCallIdFor(event);
    return toolCallId ? commandByToolCallId.get(toolCallId) : undefined;
  };
  const bashCompletions = normalizedEvents.filter((event) => event.type === "tool.completed" && toolNameFor(event) === "bash");
  const failedBashCompletions = bashCompletions.filter((event) => {
    const exitCode = bashExitCodeFor(event);
    return event.payload?.isError === true || (exitCode !== undefined && exitCode !== 0);
  });
  const failedCommands = failedBashCompletions.length;
  const failedWithoutExitCode = failedBashCompletions.filter((event) => bashExitCodeFor(event) === undefined);
  const failedWithExitCode = failedBashCompletions.filter((event) => bashExitCodeFor(event) !== undefined);
  const failedWithoutExitCodeCount = failedWithoutExitCode.length;
  const missingExitCode = bashCompletions.filter((event) => bashExitCodeFor(event) === undefined);
  const missingExitCodeCount = missingExitCode.length;
  const nonFailedMissingExitCodeCount = missingExitCodeCount - failedWithoutExitCodeCount;
  const files = new Set(
    toolRequests
      .filter((event) => ["read", "write", "edit"].includes(toolNameFor(event) ?? ""))
      .map(pathFor)
      .filter((path): path is string => Boolean(path)),
  );
  const missingCaptureEvents = normalizedEvents.filter((event) => (event.capture?.missing.length ?? 0) > 0).length;
  const redactedEvents = normalizedEvents.filter((event) => (event.capture?.redacted.length ?? 0) > 0).length;
  const truncatedEvents = normalizedEvents.filter((event) => (event.capture?.truncated.length ?? 0) > 0).length;
  const worthReviewing = [
    failedWithoutExitCodeCount > 0
      ? formatCommandReview(failedWithoutExitCodeCount, "failed without exit-code details", failedWithoutExitCode.map(commandForCompletion).filter((command): command is string => Boolean(command)))
      : undefined,
    nonFailedMissingExitCodeCount > 0
      ? formatCommandReview(nonFailedMissingExitCodeCount, "completed without exit-code details", missingExitCode.filter((event) => !failedWithoutExitCode.includes(event)).map(commandForCompletion).filter((command): command is string => Boolean(command)))
      : undefined,
    ...failedWithExitCode.map((event) => {
      const exitCode = bashExitCodeFor(event);
      const command = commandForCompletion(event);
      return command && exitCode !== undefined
        ? `shell command failed with exit ${exitCode}: \`${command}\``
        : undefined;
    }),
    failedWithExitCode.filter((event) => !commandForCompletion(event)).length > 0
      ? `${formatCount(failedWithExitCode.filter((event) => !commandForCompletion(event)).length, "shell command")} failed`
      : undefined,
    missingCaptureEvents > 0 ? `${formatCount(missingCaptureEvents, "event")} ${missingCaptureEvents === 1 ? "has" : "have"} missing capture fields` : undefined,
    redactedEvents > 0
      ? `${formatCount(redactedEvents, "event")} ${redactedEvents === 1 ? "has" : "have"} redacted fields (values hidden; run inspect on related events to see redacted paths)`
      : undefined,
    truncatedEvents > 0
      ? `${formatCount(truncatedEvents, "event")} ${truncatedEvents === 1 ? "has" : "have"} truncated fields (large values shortened; run inspect to see truncated paths)`
      : undefined,
  ].filter((item): item is string => item !== undefined);

  return {
    durationMs,
    prompts: normalizedEvents.filter((event) => event.type === "agent.before_start").length,
    toolCalls: toolRequests.length,
    shellCommands: shellRequests.length,
    filesObserved: files.size,
    failedCommands,
    captureState: worthReviewing.length > 0 ? "Partial" : "Complete",
    worthReviewing,
  };
}

export function formatDebrief(summary: DebriefSummary): string {
  const lines = [
    "Session complete",
    "",
    formatField("Duration", formatDuration(summary.durationMs)),
    formatField("Prompts", summary.prompts),
    formatField("Tool calls", summary.toolCalls),
    formatField("Shell commands", summary.shellCommands),
    formatField("Files observed", summary.filesObserved),
    formatField("Failed commands", summary.failedCommands),
    formatField("Capture state", summary.captureState),
  ].filter((line): line is string => line !== undefined);

  if (summary.worthReviewing.length > 0) {
    lines.push("", "Worth reviewing", ...summary.worthReviewing.map((item) => `- ${item}`));
  }

  return `${lines.join("\n")}\n`;
}

export async function chooseSession(requestedId?: string, root = getDataRoot()): Promise<SessionSummary> {
  const sessions = await discoverSessions(root);
  if (sessions.length === 0) throw new Error(`No BashGuard sessions found in ${root}`);

  if (requestedId) {
    const exact = sessions.find((session) => session.metadata.sessionId === requestedId);
    if (exact) return exact;
    const prefixMatches = sessions.filter((session) => session.metadata.sessionId.startsWith(requestedId));
    if (prefixMatches.length === 1) return prefixMatches[0];
    if (prefixMatches.length > 1) throw new Error(`Session prefix ${requestedId} is ambiguous`);
    throw new Error(`Session ${requestedId} was not found`);
  }

  const active = sessions.filter((session) => session.active);
  if (active.length === 1) return active[0];
  if (active.length > 1) throw new Error("More than one active session found. Pass a session ID from `bashguard sessions`.");
  return sessions[0];
}

async function inspect(sessionId: string | undefined, eventIdOrSequence: string | undefined): Promise<void> {
  if (!sessionId || !eventIdOrSequence) {
    throw new Error("Usage: bashguard inspect <session-id> --event <event-id-or-sequence>");
  }

  const session = await chooseSession(sessionId);
  const events = await readExistingEvents(session.eventsFile);
  const event = findEvent(events, eventIdOrSequence);
  if (!event) throw new Error(`Event ${eventIdOrSequence} was not found in session ${session.metadata.sessionId}`);

  process.stdout.write(formatEventInspection(event));
}

async function debrief(sessionId: string | undefined): Promise<void> {
  if (!sessionId) throw new Error("Usage: bashguard debrief <session-id>");

  const session = await chooseSession(sessionId);
  const events = await readExistingEvents(session.eventsFile);
  process.stdout.write(formatDebrief(buildDebrief(events)));
}

async function attach(requestedId?: string): Promise<void> {
  const session = await chooseSession(requestedId);
  const repo = session.metadata.repository ?? basename(session.metadata.cwd ?? "unknown");

  process.stdout.write(`BashGuard · ${session.active ? "live" : "completed"}\n`);
  process.stdout.write(`Session ${session.metadata.sessionId}\n`);
  process.stdout.write(`Repo    ${repo}\n`);
  if (session.metadata.cwd) process.stdout.write(`Cwd     ${session.metadata.cwd}\n`);
  process.stdout.write("─".repeat(60) + "\n");

  let lastSequence = 0;
  let offset = 0;
  let remainder = "";

  const existing = await readExistingEvents(session.eventsFile);
  for (const event of existing) {
    lastSequence = Math.max(lastSequence, event.sequence);
    const rendered = renderEvent(event);
    if (rendered) process.stdout.write(`${renderTimestamp(event.timestamp)}  ${rendered}\n`);
  }

  try {
    offset = (await stat(session.eventsFile)).size;
  } catch {
    offset = 0;
  }

  if (!session.active) return;

  process.stdout.write("─".repeat(60) + "\nFollowing live events. Ctrl-C to detach.\n");

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));

    let info;
    try {
      info = await stat(session.eventsFile);
    } catch {
      continue;
    }

    if (info.size < offset) {
      offset = 0;
      remainder = "";
    }
    if (info.size === offset) {
      if (!processIsAlive(session.metadata.processId)) {
        process.stdout.write("Pi session ended.\n");
        return;
      }
      continue;
    }

    const stream = createReadStream(session.eventsFile, { start: offset, end: info.size - 1, encoding: "utf8" });
    let chunk = "";
    for await (const piece of stream) chunk += piece;
    offset = info.size;

    const combined = remainder + chunk;
    const lines = combined.split("\n");
    remainder = lines.pop() ?? "";

    let shutdownSeen = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as BashGuardEvent;
        if (event.sequence <= lastSequence) continue;
        lastSequence = event.sequence;
        if (event.type === "session.shutdown") shutdownSeen = true;
        const rendered = renderEvent(event);
        if (rendered) process.stdout.write(`${renderTimestamp(event.timestamp)}  ${rendered}\n`);
      } catch {
        // Malformed complete lines are ignored in this first slice rather than crashing attachment.
      }
    }

    if (shutdownSeen) return;
  }
}

async function main(): Promise<void> {
  const [command, arg, flag, value] = process.argv.slice(2);
  try {
    if (command === "sessions") return await listSessions();
    if (command === "attach") return await attach(arg);
    if (command === "inspect") return await inspect(arg, flag === "--event" ? value : undefined);
    if (command === "debrief") return await debrief(arg);
    usage();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`bashguard: ${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
