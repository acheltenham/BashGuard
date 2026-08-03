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
  fileToolActions: number;
  failedCommands: number;
  riskyCommands: number;
  gitStatus?: string;
  gitBranch?: string;
  gitWorktree?: string;
  gitChangedPaths?: string;
  gitChangedFiles: string[];
  captureState: "Complete" | "Partial";
  worthReviewing: string[];
  fileActivity: string[];
};

export type ParsedCommandArgs = {
  command?: string;
  sessionId?: string;
  eventId?: string;
};

const POLL_MS = 250;

function getDataRoot(): string {
  return process.env.BASHGUARD_DATA_DIR ?? join(homedir(), ".bashguard", "sessions");
}

function usage(): never {
  process.stderr.write(`BashGuard\n\nUsage:\n  bashguard sessions\n  bashguard attach [session-id]\n  bashguard attach --session <session-id>\n  bashguard inspect <session-id> --event <event-id-or-sequence>\n  bashguard inspect --session <session-id> --event <event-id-or-sequence>\n  bashguard debrief <session-id>\n  bashguard debrief --session <session-id>\n\nEnvironment:\n  BASHGUARD_DATA_DIR  Override session storage directory\n`);
  process.exit(1);
}

export function parseCommandArgs(argv: string[]): ParsedCommandArgs {
  const [command, ...args] = argv;
  let sessionId: string | undefined;
  let eventId: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--session") {
      sessionId = args[++index];
      continue;
    }
    if (arg === "--event") {
      eventId = args[++index];
      continue;
    }
    if (!sessionId) sessionId = arg;
  }

  const parsed: ParsedCommandArgs = {};
  if (command !== undefined) parsed.command = command;
  if (sessionId !== undefined) parsed.sessionId = sessionId;
  if (eventId !== undefined) parsed.eventId = eventId;
  return parsed;
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

function sessionPrefix(sessionId: string, allSessionIds: string[]): string {
  const minLength = Math.min(8, sessionId.length);
  for (let length = minLength; length <= sessionId.length; length++) {
    const prefix = sessionId.slice(0, length);
    if (allSessionIds.filter((id) => id.startsWith(prefix)).length === 1) return prefix;
  }
  return sessionId;
}

function formatAge(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export function formatSessionList(sessions: SessionSummary[]): string {
  const sessionIds = sessions.map((session) => session.metadata.sessionId);
  const lines = ["#  STATE     SESSION              REPOSITORY           UPDATED"];
  for (const [index, session] of sessions.entries()) {
    const state = session.active ? "active" : "complete";
    const repo = session.metadata.repository ?? basename(session.metadata.cwd ?? "unknown");
    const selector = String(index + 1).padEnd(2);
    lines.push(`${selector} ${state.padEnd(9)} ${sessionPrefix(session.metadata.sessionId, sessionIds).padEnd(20)} ${repo.slice(0, 20).padEnd(20)} ${formatAge(session.modifiedAt)}`);
  }

  lines.push("", "Use a # or SESSION prefix, for example:", "  bashguard attach 1", "  bashguard inspect 1 --event <event-id-or-sequence>", "  bashguard debrief 1");
  return `${lines.join("\n")}\n`;
}

async function listSessions(): Promise<void> {
  const sessions = await discoverSessions();
  if (sessions.length === 0) {
    process.stdout.write(`No BashGuard sessions found in ${getDataRoot()}\n`);
    return;
  }

  process.stdout.write(formatSessionList(sessions));
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function classifyCommandRisk(command: string): string[] {
  const normalized = command.toLowerCase();
  const risks: string[] = [];

  if (/\brm\s+[^\n;|&]*-(?:[^\s]*r[^\s]*f|[^\s]*f[^\s]*r)\b/.test(normalized)) {
    risks.push("destructive filesystem removal");
  }
  if (/\bgit\s+(reset\s+--hard|clean\s+-[^\n;|&]*f|push\s+[^\n;|&]*--force|rebase\b)/.test(normalized)) {
    risks.push("history or working-tree rewrite");
  }
  if (/\b(curl|wget)\b[^\n]*\|\s*(sh|bash|zsh|fish|sudo\s+(sh|bash))\b/.test(normalized)) {
    risks.push("network download piped to shell");
  }
  if (/\b(token|api[_-]?key|password|passwd|secret)=\S+/i.test(command)) {
    risks.push("secret-looking value in command text");
  }

  return risks;
}

const RISK_EXPLANATIONS: Record<string, string> = {
  "destructive filesystem removal": "recursively deletes files without a trash/undo step",
  "history or working-tree rewrite": "can discard local changes or rewrite repository state",
  "network download piped to shell": "downloads code from the network and executes it in a shell",
  "secret-looking value in command text": "may expose sensitive values in logs, shell history, or recorded output",
};

function explainRisk(risk: string): string {
  return RISK_EXPLANATIONS[risk] ?? "review the recorded command before trusting the result";
}

function formatRiskWithExplanation(risk: string): string {
  return `${risk} — ${explainRisk(risk)}`;
}

function formatRiskNotice(command: string): string | undefined {
  const risks = classifyCommandRisk(command);
  return risks.length > 0 ? `Risk notice: ${risks.join(", ")}` : undefined;
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
        const riskNotice = command ? formatRiskNotice(command) : undefined;
        if (command && riskNotice) return `Running · ${command} · ${riskNotice}`;
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
      const riskNotice = command ? formatRiskNotice(command) : undefined;
      if (command && riskNotice) return `You ran · ${command} · ${riskNotice}`;
      return command ? `You ran · ${command}` : "You ran a shell command";
    }
    case "capture.gap": {
      const reason = getString(payload.reason);
      const tool = getString(payload.failedToolName);
      const command = getString(payload.command);
      const path = getString(payload.path);
      const context = [tool, command ?? path].filter(Boolean).join(" · ");
      const base = reason ? `Capture gap · ${reason}` : "Capture gap";
      return context ? `${base} · ${context}` : base;
    }
    case "git.status.snapshot": {
      const phase = getString(payload.phase) ?? "unknown";
      if (payload.isRepository === false) return `Git status snapshot · ${phase} · not a repository`;
      const changedFileCount = getStringArray(payload.changedFiles).length;
      const state = changedFileCount > 0 ? "dirty" : "clean";
      return `Git status snapshot · ${phase} · ${state} · ${changedFileCount} changed ${changedFileCount === 1 ? "path" : "paths"}`;
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

export function formatTimelineEvent(event: BashGuardEvent): string | undefined {
  const rendered = renderEvent(event);
  if (!rendered) return undefined;
  const eventSelector = event.id.slice(0, 8).padEnd(8);
  return `${String(event.sequence).padStart(2)}  ${eventSelector}  ${renderTimestamp(event.timestamp)}  ${rendered}`;
}

export function formatInspectableEvents(sessionSelector: string, events: BashGuardEvent[]): string {
  const renderedEvents = events
    .map(formatTimelineEvent)
    .filter((line): line is string => line !== undefined);
  const visibleEvents = renderedEvents.slice(-50);
  const firstEventId = events.find((event) => renderEvent(event))?.id.slice(0, 8);
  const lines = ["Inspectable events", "", ...visibleEvents];

  if (renderedEvents.length > visibleEvents.length) {
    lines.splice(2, 0, `Showing last ${visibleEvents.length} of ${renderedEvents.length} rendered events.`);
  }

  lines.push("", "Inspect an event with:");
  lines.push(`  bashguard inspect ${sessionSelector} --event ${firstEventId ?? "<event-id-or-sequence>"}`);
  return `${lines.join("\n")}\n`;
}

export function findEvent(events: BashGuardEvent[], eventIdOrSequence: string): BashGuardEvent | undefined {
  const sequence = Number(eventIdOrSequence);
  if (Number.isInteger(sequence) && sequence > 0) {
    const bySequence = events.find((event) => event.sequence === sequence);
    if (bySequence) return bySequence;
  }

  const exact = events.find((event) => event.id === eventIdOrSequence);
  if (exact) return exact;

  const prefixMatches = events.filter((event) => event.id.startsWith(eventIdOrSequence));
  return prefixMatches.length === 1 ? prefixMatches[0] : undefined;
}

function formatField(label: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return `${label.padEnd(18)} ${String(value)}`;
}

function fileActionForTool(tool: string | undefined): string | undefined {
  if (tool === "read") return "read";
  if (tool === "edit") return "edit";
  if (tool === "write") return "write tool";
  return undefined;
}

function fileMeaningForTool(tool: string | undefined): string | undefined {
  if (tool === "read") return "Pi read file contents";
  if (tool === "edit") return "Pi requested targeted text replacement";
  if (tool === "write") return "Pi wrote full file content; may create, overwrite, or leave content unchanged";
  return undefined;
}

export function formatEventInspection(event: BashGuardEvent): string {
  const normalized = normalizeEvent(event);
  const payload = normalized.payload ?? {};
  const input = payload.input as Record<string, unknown> | undefined;
  const details = payload.details as Record<string, unknown> | undefined;
  const tool = normalized.toolName ?? getString(payload.toolName);
  const command = getString(payload.command) ?? getString(input?.command);
  const path = getString(payload.path) ?? getString(input?.path);
  const exitCode = getNumber(details?.exitCode);
  const riskFactors = command ? classifyCommandRisk(command) : [];
  const riskWhy = riskFactors.map(explainRisk);
  const fileAction = path ? fileActionForTool(tool) : undefined;
  const fileMeaning = path ? fileMeaningForTool(tool) : undefined;

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
    formatField("Tool", tool),
    formatField("Tool call", normalized.toolCallId ?? getString(payload.toolCallId)),
    formatField("Command", command),
    formatField("Risk factors", riskFactors.join(", ")),
    formatField("Risk why", riskWhy.join("; ")),
    formatField("Path", path),
    formatField("File action", fileAction),
    formatField("File meaning", fileMeaning),
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

function formatRiskyCommandReview(event: BashGuardEvent, command: string, risks: string[], resultEvidence: string): string {
  const details = [
    `  Risk: ${risks.map(formatRiskWithExplanation).join(", ")}`,
    event.cwd ? `  Cwd: ${event.cwd}` : undefined,
    `  Result: ${resultEvidence}`,
    `  Inspect: --event ${event.sequence}`,
  ].filter((item): item is string => item !== undefined);
  return [`risky shell command observed at event ${event.sequence}: \`${command}\``, ...details].join("\n");
}

function formatFileActivity(event: BashGuardEvent): string | undefined {
  const tool = toolNameFor(event);
  const path = pathFor(event);
  const action = fileActionForTool(tool);
  const meaning = fileMeaningForTool(tool);
  if (!path || !action || !meaning) return undefined;
  return [`${action} ${path}`, `  Meaning: ${meaning}`, `  Evidence: ${tool} tool event`, `  Inspect: --event ${event.sequence}`].join("\n");
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function gitSnapshotStatus(event: BashGuardEvent | undefined): "clean" | "dirty" | "not a repository" | "missing" {
  if (!event) return "missing";
  if (event.payload?.isRepository === false) return "not a repository";
  return getStringArray(event.payload?.changedFiles).length > 0 ? "dirty" : "clean";
}

function gitSnapshotCount(event: BashGuardEvent | undefined): number | undefined {
  if (!event || event.payload?.isRepository === false) return undefined;
  return getStringArray(event.payload?.changedFiles).length;
}

function formatGitChangedPaths(start: BashGuardEvent | undefined, end: BashGuardEvent | undefined): string | undefined {
  const startCount = gitSnapshotCount(start);
  const endCount = gitSnapshotCount(end);
  if (startCount === undefined || endCount === undefined) return undefined;
  return `${startCount} -> ${endCount}`;
}

function formatGitSnapshotValue(key: string, start: BashGuardEvent | undefined, end: BashGuardEvent | undefined): string | undefined {
  const startValue = getString(start?.payload?.[key]);
  const endValue = getString(end?.payload?.[key]);
  if (startValue && endValue && startValue !== endValue) return `${startValue} -> ${endValue}`;
  return endValue ?? startValue;
}

function getNumberFromRecord(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatGitChangedFileDetail(detail: unknown): string | undefined {
  if (typeof detail !== "object" || detail === null) return undefined;
  const record = detail as Record<string, unknown>;
  const path = getString(record.path);
  const status = getString(record.status);
  if (!path || !status) return undefined;
  const additions = getNumberFromRecord(record, "additions");
  const deletions = getNumberFromRecord(record, "deletions");
  const stats = additions !== undefined && deletions !== undefined ? ` (+${additions} -${deletions})` : "";
  const lineRanges = getStringArray(record.lineRanges);
  const lines = [`${status} ${path}${stats}`];
  if (lineRanges.length > 0) lines.push(`  Lines: ${lineRanges.join(", ")}`);
  return lines.join("\n");
}

function gitChangedFileDetails(event: BashGuardEvent | undefined): string[] {
  const details = event?.payload?.changedFileDetails;
  if (!Array.isArray(details)) return [];
  return details.map(formatGitChangedFileDetail).filter((detail): detail is string => detail !== undefined);
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
  const fileToolRequests = toolRequests.filter((event) => ["read", "write", "edit"].includes(toolNameFor(event) ?? ""));
  const files = new Set(
    fileToolRequests
      .map(pathFor)
      .filter((path): path is string => Boolean(path)),
  );
  const fileActivity = fileToolRequests.map(formatFileActivity).filter((activity): activity is string => activity !== undefined);
  const completionByToolCallId = new Map(
    bashCompletions
      .map((event) => {
        const toolCallId = toolCallIdFor(event);
        return toolCallId ? ([toolCallId, event] as const) : undefined;
      })
      .filter((entry): entry is readonly [string, BashGuardEvent] => entry !== undefined),
  );
  const resultEvidenceFor = (event: BashGuardEvent): string => {
    const toolCallId = toolCallIdFor(event);
    const completion = toolCallId ? completionByToolCallId.get(toolCallId) : undefined;
    if (!completion) return "missing command completion evidence";
    const exitCode = bashExitCodeFor(completion);
    if (exitCode !== undefined) return `exit ${exitCode}`;
    return completion.payload?.isError === true ? "failed without exit-code details" : "completed without exit-code details";
  };
  const riskyCommandReviews = Array.from(new Map(
    normalizedEvents
      .filter((event) => (event.type === "tool.requested" && toolNameFor(event) === "bash") || event.type === "bash.user_requested")
      .map((event) => {
        const command = commandFor(event);
        if (!command) return undefined;
        const risks = classifyCommandRisk(command);
        return risks.length > 0 ? ([`${event.sequence}:${command}`, formatRiskyCommandReview(event, command, risks, resultEvidenceFor(event))] as const) : undefined;
      })
      .filter((entry): entry is readonly [string, string] => entry !== undefined),
  ).values());
  const riskyCommands = riskyCommandReviews.length;
  const gitSnapshots = normalizedEvents.filter((event) => event.type === "git.status.snapshot");
  const gitStartSnapshot = gitSnapshots.find((event) => getString(event.payload?.phase) === "start");
  const gitEndSnapshot = [...gitSnapshots].reverse().find((event) => getString(event.payload?.phase) === "shutdown");
  const gitStatus = gitSnapshots.length > 0 ? `${gitSnapshotStatus(gitStartSnapshot)} -> ${gitSnapshotStatus(gitEndSnapshot)}` : undefined;
  const gitBranch = formatGitSnapshotValue("branch", gitStartSnapshot, gitEndSnapshot);
  const gitWorktree = formatGitSnapshotValue("worktree", gitStartSnapshot, gitEndSnapshot);
  const gitChangedPaths = formatGitChangedPaths(gitStartSnapshot, gitEndSnapshot);
  const gitChangedFiles = gitChangedFileDetails(gitEndSnapshot);
  const startGitCount = gitSnapshotCount(gitStartSnapshot);
  const endGitCount = gitSnapshotCount(gitEndSnapshot);
  const gitReviewItem = startGitCount !== undefined && endGitCount !== undefined && startGitCount !== endGitCount
    ? `Git working tree changed during session: ${startGitCount} -> ${endGitCount} changed paths`
    : undefined;
  const captureGapEventList = normalizedEvents.filter((event) => event.type === "capture.gap");
  const captureGapEvents = captureGapEventList.length;
  const captureGapContexts = captureGapEventList
    .map((event) => {
      const tool = getString(event.payload?.failedToolName);
      const command = getString(event.payload?.command);
      const path = getString(event.payload?.path);
      if (tool && command) return `${tool} \`${command}\``;
      if (tool && path) return `${tool} ${path}`;
      return tool ?? command ?? path;
    })
    .filter((context): context is string => Boolean(context));
  const nonGapEvents = normalizedEvents.filter((event) => event.type !== "capture.gap");
  const missingCaptureEvents = nonGapEvents.filter((event) => (event.capture?.missing.length ?? 0) > 0).length;
  const redactedEvents = nonGapEvents.filter((event) => (event.capture?.redacted.length ?? 0) > 0).length;
  const truncatedEvents = nonGapEvents.filter((event) => (event.capture?.truncated.length ?? 0) > 0).length;
  const captureReviewItems = [
    captureGapEvents > 0
      ? `${formatCount(captureGapEvents, "capture gap")} occurred during recording${captureGapEvents === 1 && captureGapContexts[0] ? `: ${captureGapContexts[0]}` : ""}`
      : undefined,
    missingCaptureEvents > 0 ? `${formatCount(missingCaptureEvents, "event")} ${missingCaptureEvents === 1 ? "has" : "have"} missing capture fields` : undefined,
    redactedEvents > 0
      ? `${formatCount(redactedEvents, "event")} ${redactedEvents === 1 ? "has" : "have"} redacted fields (values hidden; run inspect on related events to see redacted paths)`
      : undefined,
    truncatedEvents > 0
      ? `${formatCount(truncatedEvents, "event")} ${truncatedEvents === 1 ? "has" : "have"} truncated fields (large values shortened; run inspect to see truncated paths)`
      : undefined,
  ].filter((item): item is string => item !== undefined);
  const worthReviewing = [
    ...riskyCommandReviews,
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
    gitReviewItem,
    ...captureReviewItems,
  ].filter((item): item is string => item !== undefined);

  return {
    durationMs,
    prompts: normalizedEvents.filter((event) => event.type === "agent.before_start").length,
    toolCalls: toolRequests.length,
    shellCommands: shellRequests.length,
    filesObserved: files.size,
    fileToolActions: fileActivity.length,
    failedCommands,
    riskyCommands,
    gitStatus,
    gitBranch,
    gitWorktree,
    gitChangedPaths,
    gitChangedFiles,
    captureState: captureReviewItems.length > 0 ? "Partial" : "Complete",
    worthReviewing,
    fileActivity,
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
    formatField("File tool actions", summary.fileToolActions),
    formatField("Failed commands", summary.failedCommands),
    formatField("Risk notices", summary.riskyCommands),
    formatField("Git status", summary.gitStatus),
    formatField("Git branch", summary.gitBranch),
    formatField("Git worktree", summary.gitWorktree),
    formatField("Git changed paths", summary.gitChangedPaths),
    formatField("Capture state", summary.captureState),
  ].filter((line): line is string => line !== undefined);

  if (summary.worthReviewing.length > 0) {
    lines.push("", "Worth reviewing", ...summary.worthReviewing.map((item) => `- ${item}`));
  }

  if (summary.gitChangedFiles.length > 0) {
    lines.push("", "Git changed files", ...summary.gitChangedFiles.map((item) => `- ${item}`));
  }

  if (summary.fileActivity.length > 0) {
    lines.push("", "File tool activity", ...summary.fileActivity.map((item) => `- ${item}`));
  }

  return `${lines.join("\n")}\n`;
}

function formatSessionNotFound(requestedId: string, root: string, sessions: SessionSummary[]): string {
  return [
    `Session ${requestedId} was not found in ${root}.`,
    "",
    "BashGuard can only attach to sessions recorded while the BashGuard extension was loaded.",
    "Older Pi sessions or sessions recorded with a different BASHGUARD_DATA_DIR are not available here.",
    "",
    sessions.length > 0 ? "Available BashGuard sessions:" : undefined,
    sessions.length > 0 ? formatSessionList(sessions).trimEnd() : undefined,
    "Run:",
    "  bashguard sessions",
    "  bashguard attach 1",
  ].filter((line): line is string => line !== undefined).join("\n");
}

export async function chooseSession(requestedId?: string, root = getDataRoot()): Promise<SessionSummary> {
  const sessions = await discoverSessions(root);
  if (sessions.length === 0) throw new Error(`No BashGuard sessions found in ${root}`);

  if (requestedId) {
    const index = Number(requestedId);
    if (Number.isInteger(index) && index >= 1 && index <= sessions.length) return sessions[index - 1]!;

    const exact = sessions.find((session) => session.metadata.sessionId === requestedId);
    if (exact) return exact;
    const prefixMatches = sessions.filter((session) => session.metadata.sessionId.startsWith(requestedId));
    if (prefixMatches.length === 1) return prefixMatches[0];
    if (prefixMatches.length > 1) throw new Error(`Session prefix ${requestedId} is ambiguous`);
    throw new Error(formatSessionNotFound(requestedId, root, sessions));
  }

  const active = sessions.filter((session) => session.active);
  if (active.length === 1) return active[0];
  if (active.length > 1) throw new Error("More than one active session found. Pass a session ID from `bashguard sessions`.");
  return sessions[0];
}

async function inspect(sessionId: string | undefined, eventIdOrSequence: string | undefined): Promise<void> {
  if (!sessionId) {
    throw new Error("Usage: bashguard inspect <session-id> --event <event-id-or-sequence>");
  }

  const session = await chooseSession(sessionId);
  const events = await readExistingEvents(session.eventsFile);

  if (!eventIdOrSequence) {
    process.stdout.write(formatInspectableEvents(sessionId, events));
    return;
  }

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
    const rendered = formatTimelineEvent(event);
    if (rendered) process.stdout.write(`${rendered}\n`);
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
        const rendered = formatTimelineEvent(event);
        if (rendered) process.stdout.write(`${rendered}\n`);
      } catch {
        // Malformed complete lines are ignored in this first slice rather than crashing attachment.
      }
    }

    if (shutdownSeen) return;
  }
}

async function main(): Promise<void> {
  const { command, sessionId, eventId } = parseCommandArgs(process.argv.slice(2));
  try {
    if (command === "sessions") return await listSessions();
    if (command === "attach") return await attach(sessionId);
    if (command === "inspect") return await inspect(sessionId, eventId);
    if (command === "debrief") return await debrief(sessionId);
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
