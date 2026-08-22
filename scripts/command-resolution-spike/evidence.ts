export type ProbeStage =
  | "early_tool_call"
  | "late_tool_call"
  | "spawn_hook_input"
  | "spawn_hook_output"
  | "runtime_fixture";

export type SpikeSentinel =
  | "BASHGUARD_SPIKE_MUTATED"
  | "BASHGUARD_SPIKE_SPAWN"
  | "BASHGUARD_SPIKE_PREFIX"
  | "BASHGUARD_SPIKE_LOADED";

export type ProbeRecord = {
  runId: string;
  scenario: string;
  stage: ProbeStage;
  toolCallId?: string;
  command?: string;
  cwd?: string;
  extensionOrder: string[];
  timestamp: string;
  token?: string;
  argv?: string[];
  stdin?: string;
  sentinels?: Partial<Record<SpikeSentinel, string>>;
};

export type BashGuardSpikeEvent = {
  id: string;
  sequence: number;
  timestamp: string;
  type: "session.started" | "tool.requested" | "tool.completed" | "session.shutdown";
  sessionId: string;
  toolCallId?: string;
  toolName?: string;
  payload?: Record<string, unknown>;
};

const PROBE_STAGES = new Set<ProbeStage>([
  "early_tool_call",
  "late_tool_call",
  "spawn_hook_input",
  "spawn_hook_output",
  "runtime_fixture",
]);
const SENTINELS = new Set<SpikeSentinel>([
  "BASHGUARD_SPIKE_MUTATED",
  "BASHGUARD_SPIKE_SPAWN",
  "BASHGUARD_SPIKE_PREFIX",
  "BASHGUARD_SPIKE_LOADED",
]);
const BASHGUARD_TYPES = new Set<BashGuardSpikeEvent["type"]>([
  "session.started",
  "tool.requested",
  "tool.completed",
  "session.shutdown",
]);

function completeLines(text: string, label: string): { lines: string[]; diagnostics: string[] } {
  const lines = text.split("\n");
  const diagnostics: string[] = [];
  if (!text.endsWith("\n")) {
    const incompleteLine = lines.length;
    if (lines.at(-1)?.trim()) diagnostics.push(`incomplete final ${label} JSONL line ${incompleteLine}`);
    lines.pop();
  }
  return { lines, diagnostics };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseProbeJsonl(text: string): { records: ProbeRecord[]; diagnostics: string[] } {
  const parsed = completeLines(text, "probe");
  const records: ProbeRecord[] = [];
  parsed.lines.forEach((line, index) => {
    if (!line.trim()) return;
    const lineNumber = index + 1;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      parsed.diagnostics.push(`malformed probe JSONL line ${lineNumber}`);
      return;
    }
    if (!isRecord(value) || typeof value.stage !== "string" || !PROBE_STAGES.has(value.stage as ProbeStage)) {
      parsed.diagnostics.push(`unknown probe stage on line ${lineNumber}`);
      return;
    }
    if (typeof value.runId !== "string" || typeof value.scenario !== "string" || typeof value.timestamp !== "string"
      || !Array.isArray(value.extensionOrder) || !value.extensionOrder.every((item) => typeof item === "string")) {
      parsed.diagnostics.push(`invalid probe envelope on line ${lineNumber}`);
      return;
    }
    if (isRecord(value.sentinels)) {
      for (const key of Object.keys(value.sentinels)) {
        if (!SENTINELS.has(key as SpikeSentinel)) {
          parsed.diagnostics.push(`non-allowlisted sentinel ${key} on line ${lineNumber}`);
          return;
        }
      }
    }
    records.push(value as ProbeRecord);
  });
  return { records, diagnostics: parsed.diagnostics };
}

export function parseBashGuardJsonl(text: string): { events: BashGuardSpikeEvent[]; diagnostics: string[] } {
  const parsed = completeLines(text, "BashGuard");
  const events: BashGuardSpikeEvent[] = [];
  parsed.lines.forEach((line, index) => {
    if (!line.trim()) return;
    const lineNumber = index + 1;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      parsed.diagnostics.push(`malformed BashGuard JSONL line ${lineNumber}`);
      return;
    }
    if (!isRecord(value) || typeof value.type !== "string" || !BASHGUARD_TYPES.has(value.type as BashGuardSpikeEvent["type"])) return;
    if (typeof value.id !== "string" || typeof value.sequence !== "number" || typeof value.timestamp !== "string" || typeof value.sessionId !== "string") {
      parsed.diagnostics.push(`invalid BashGuard envelope on line ${lineNumber}`);
      return;
    }
    events.push(value as BashGuardSpikeEvent);
  });
  return { events, diagnostics: parsed.diagnostics };
}
