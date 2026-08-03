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
};

export type SessionSummary = {
  metadata: SessionMetadata;
  directory: string;
  eventsFile: string;
  modifiedAt: number;
  active: boolean;
};

const POLL_MS = 250;

function getDataRoot(): string {
  return process.env.BASHGUARD_DATA_DIR ?? join(homedir(), ".bashguard", "sessions");
}

function usage(): never {
  process.stderr.write(`BashGuard\n\nUsage:\n  bashguard sessions\n  bashguard attach [session-id]\n  bashguard inspect <session-id> --event <event-id-or-sequence>\n\nEnvironment:\n  BASHGUARD_DATA_DIR  Override session storage directory\n`);
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

export function parseJsonlEvents(text: string): BashGuardEvent[] {
  const lines = text.split("\n");
  const hasCompleteFinalLine = text.endsWith("\n");
  if (!hasCompleteFinalLine) lines.pop();

  const events: BashGuardEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as BashGuardEvent);
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
  return `${label.padEnd(12)} ${String(value)}`;
}

export function formatEventInspection(event: BashGuardEvent): string {
  const payload = event.payload ?? {};
  const input = payload.input as Record<string, unknown> | undefined;
  const details = payload.details as Record<string, unknown> | undefined;
  const command = getString(payload.command) ?? getString(input?.command);
  const path = getString(payload.path) ?? getString(input?.path);
  const exitCode = getNumber(details?.exitCode);

  const lines = [
    "Event detail",
    "",
    formatField("Sequence", event.sequence),
    formatField("Event ID", event.id),
    formatField("Type", event.type),
    formatField("Timestamp", event.timestamp),
    formatField("Evidence", event.evidence ?? "unknown"),
    formatField("Session", event.sessionId),
    formatField("Cwd", event.cwd),
    formatField("Tool", event.toolName ?? getString(payload.toolName)),
    formatField("Tool call", event.toolCallId ?? getString(payload.toolCallId)),
    formatField("Command", command),
    formatField("Path", path),
    formatField("Exit code", exitCode),
  ].filter((line): line is string => line !== undefined);

  lines.push("", "Payload", JSON.stringify(payload, null, 2));
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
