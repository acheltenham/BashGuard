import { spawn } from "node:child_process";

import { protectedCheck, type ProtectedCheckObservation } from "../model.ts";

export type DcgProcessSurface = "robot-test" | "classify" | "explain";

export interface DcgProcessAdapterCapabilities {
  readonly structural: false;
  readonly checks: true;
  readonly literalGitTargets: false;
  readonly decisionSchema: true;
  readonly classifySchema: true;
  readonly explainSchema: true;
  readonly available: boolean;
}

export interface DcgProcessSurfaceObservation {
  readonly surface: DcgProcessSurface;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly decision?: string;
  readonly riskLevel?: string;
  readonly riskScore?: number;
  readonly ruleId?: string;
  readonly packId?: string;
  readonly patternName?: string;
  readonly reason?: string;
  readonly explanation?: string;
  readonly matchedSpan?: readonly [number, number];
  readonly traceCount?: number;
  readonly notes: readonly string[];
}

export interface DcgProcessAnalysis {
  readonly adapterId: "dcg-process";
  readonly adapterLabel: string;
  readonly command: string;
  readonly status: "structured" | "degraded" | "unsupported" | "failed";
  readonly binary: string;
  readonly availability: "available" | "unavailable";
  readonly availabilityReason?: string;
  readonly version?: string;
  readonly textualEvidence: readonly string[];
  readonly protectedChecks: readonly ProtectedCheckObservation[];
  readonly literalGitTargetOptions: readonly [];
  readonly limitations: readonly string[];
  readonly surfaceObservations: readonly DcgProcessSurfaceObservation[];
  readonly repositoryVerification: "not-claimed";
}

export interface DcgProcessAdapter {
  readonly id: "dcg-process";
  readonly label: string;
  readonly binary: string;
  readonly version?: string;
  readonly availability: "available" | "unavailable";
  readonly availabilityReason?: string;
  readonly capabilities: DcgProcessAdapterCapabilities;
  analyze(command: string, signal?: AbortSignal): Promise<DcgProcessAnalysis>;
}

export interface DcgProcessAdapterOptions {
  readonly binary?: string;
  readonly timeoutMs?: number;
  readonly includeExplain?: boolean;
}

export interface DcgParseResult {
  readonly decision?: string;
  readonly riskLevel?: string;
  readonly riskScore?: number;
  readonly ruleId?: string;
  readonly packId?: string;
  readonly patternName?: string;
  readonly reason?: string;
  readonly explanation?: string;
  readonly matchedSpan?: readonly [number, number];
  readonly traceCount?: number;
}

export interface DcgCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly abortReason?: "timeout" | "caller";
}

const DEFAULT_TIMEOUT_MS = 1_000;

function normalizeText(value: string): string {
  return value
    .replaceAll(/\/private\/tmp\/[A-Za-z0-9._/-]+/g, "<tmp-path>")
    .replaceAll(/(?:\/tmp|\/var\/tmp)\/[A-Za-z0-9._/-]+/g, "<tmp-path>")
    .replaceAll(/\b[A-Za-z]:\\[^\s"']+/g, "<drive-path>")
    .replaceAll(/\b\d+(?:\.\d+)?\s*ms\b/gi, "<duration-ms>");
}

function sanitizeMaybe<T>(value: T): T {
  if (typeof value === "string") return normalizeText(value) as T;
  if (Array.isArray(value)) return value.map((entry) => sanitizeMaybe(entry)) as T;
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) out[key] = sanitizeMaybe(entry);
  return out as T;
}

function compact(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function extractText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function extractNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractSpan(value: unknown): readonly [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const start = value[0];
  const end = value[1];
  if (typeof start !== "number" || typeof end !== "number") return undefined;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined;
  return [start, end];
}

function parsePayload(value: unknown): DcgParseResult {
  const root = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const hookSpecific = typeof root.hookSpecificOutput === "object" && root.hookSpecificOutput !== null ? (root.hookSpecificOutput as Record<string, unknown>) : undefined;
  const source = hookSpecific ?? root;
  const trace = Array.isArray(source.trace) ? source.trace : Array.isArray(root.trace) ? root.trace : undefined;
  return {
    decision: extractText(source.decision ?? source.permissionDecision ?? root.decision ?? root.permissionDecision),
    riskLevel: extractText(source.risk_level ?? source.riskLevel),
    riskScore: extractNumber(source.risk_score ?? source.riskScore),
    ruleId: extractText(source.rule_id ?? source.ruleId),
    packId: extractText(source.pack_id ?? source.packId),
    patternName: extractText(source.pattern_name ?? source.patternName),
    reason: extractText(source.reason ?? source.permissionDecisionReason),
    explanation: extractText(source.explanation),
    matchedSpan: extractSpan(source.matched_span ?? source.matchedSpan),
    traceCount: Array.isArray(trace) ? trace.length : undefined,
  };
}

async function runDcgCommand(
  binary: string,
  args: readonly string[],
  options: { readonly input?: string; readonly timeoutMs?: number; readonly signal?: AbortSignal } = {},
): Promise<DcgCommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await new Promise<DcgCommandResult>((resolve) => {
    const child = spawn(binary, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        NO_COLOR: process.env.NO_COLOR ?? "1",
      },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let abortReason: "timeout" | "caller" | undefined;
    let settled = false;

    const finish = (result: DcgCommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const stopChild = (reason: "timeout" | "caller") => {
      aborted = true;
      abortReason = reason;
      child.kill("SIGKILL");
    };

    const timer = setTimeout(() => {
      timedOut = true;
      stopChild("timeout");
    }, timeoutMs);

    const abortHandler = () => stopChild("caller");

    if (options.signal) {
      if (options.signal.aborted) {
        abortHandler();
      } else {
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }
    }

    const cleanup = () => {
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener("abort", abortHandler);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      cleanup();
      finish({ exitCode: null, stdout: normalizeText(stdout), stderr: normalizeText(stderr), error: error.message, timedOut, aborted, abortReason });
    });
    child.on("close", (code) => {
      cleanup();
      finish({ exitCode: code, stdout: normalizeText(stdout), stderr: normalizeText(stderr), timedOut, aborted, abortReason });
    });

    if (options.input) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

async function probeDcgBinary(binary: string, timeoutMs: number): Promise<{ readonly available: boolean; readonly version?: string; readonly reason?: string }> {
  const result = await runDcgCommand(binary, ["--version"], { timeoutMs });
  if (result.error?.includes("ENOENT")) {
    return { available: false, reason: `dcg binary not found: ${binary}` };
  }
  if (result.timedOut) return { available: false, reason: `dcg --version timed out after ${timeoutMs}ms` };
  if (result.exitCode === 0) {
    return { available: true, version: compact(result.stdout).replace(/^dcg\s+/i, "").trim() || compact(result.stdout) };
  }
  return {
    available: false,
    reason: `dcg --version exited ${result.exitCode ?? "unknown"}: ${compact(result.stderr || result.stdout || "no output")}`,
  };
}

function mapProtectedCheck(ruleId: string | undefined, command: string, reason: string | undefined): ProtectedCheckObservation[] {
  const checks: ProtectedCheckObservation[] = [];
  const combined = `${ruleId ?? ""} ${reason ?? ""} ${command}`.toLowerCase();
  if (combined.includes("reset-hard")) {
    checks.push(protectedCheck("git-reset-hard", "matched", "observed", reason ?? ruleId ?? "dcg robot denied git reset --hard"));
  }
  if (combined.includes("recursive") || combined.includes("rm -rf") || combined.includes("rm-rf")) {
    checks.push(protectedCheck("recursive-forced-deletion", "matched", "observed", reason ?? ruleId ?? "dcg robot denied recursive deletion"));
  }
  if (combined.includes("git-clean") || combined.includes("clean -fd")) {
    checks.push(protectedCheck("git-clean-forced", "matched", "observed", reason ?? ruleId ?? "dcg robot denied forced git clean"));
  }
  return checks;
}

function surfaceEvidence(surface: DcgProcessSurface, result: DcgCommandResult, parsed: DcgParseResult): DcgProcessSurfaceObservation {
  const notes: string[] = [];
  if (result.error) notes.push(`spawn error: ${result.error}`);
  if (result.timedOut) notes.push("timed out");
  if (result.aborted) notes.push(`aborted=${result.abortReason ?? "caller"}`);
  if (!result.stdout.trim()) notes.push("stdout empty");
  if (parsed.decision) notes.push(`decision=${parsed.decision}`);
  if (parsed.riskLevel) notes.push(`risk_level=${parsed.riskLevel}`);
  if (parsed.ruleId) notes.push(`rule_id=${parsed.ruleId}`);
  if (parsed.packId) notes.push(`pack_id=${parsed.packId}`);
  if (parsed.traceCount !== undefined) notes.push(`trace=${parsed.traceCount}`);
  return {
    surface,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    decision: parsed.decision,
    riskLevel: parsed.riskLevel,
    riskScore: parsed.riskScore,
    ruleId: parsed.ruleId,
    packId: parsed.packId,
    patternName: parsed.patternName,
    reason: parsed.reason,
    explanation: parsed.explanation,
    matchedSpan: parsed.matchedSpan,
    traceCount: parsed.traceCount,
    notes,
  };
}

function summarizeEvidence(command: string, observations: readonly DcgProcessSurfaceObservation[], binary: string, availabilityReason?: string, version?: string): DcgProcessAnalysis {
  const evidence: string[] = [];
  const limitations = [
    "dcg is an optional external provider, not a runtime dependency for the corpus or CLI",
    "dcg output is normalized into BashGuard evidence; the adapter does not claim Git repository verification",
  ];
  if (availabilityReason) limitations.push(availabilityReason);
  if (version) evidence.push(`dcg version ${version}`);

  const protectedChecks = new Map<string, ProtectedCheckObservation>();
  for (const observation of observations) {
    const summary = `${observation.surface}: ${observation.decision ?? "unknown"}${observation.ruleId ? ` · ${observation.ruleId}` : ""}`;
    evidence.push(summary);
    if (observation.reason) evidence.push(normalizeText(observation.reason));
    if (observation.explanation) evidence.push(normalizeText(observation.explanation));
    for (const check of mapProtectedCheck(observation.ruleId, command, observation.reason ?? observation.explanation)) {
      protectedChecks.set(`${check.checkId}:${check.outcome}`, check);
    }
  }

  const status = observations.length === 0 ? "degraded" : observations.some((entry) => entry.notes.some((note) => note.includes("timed out") || note.includes("spawn error"))) ? "degraded" : "structured";
  return {
    adapterId: "dcg-process",
    adapterLabel: "dcg process adapter",
    command,
    status,
    binary,
    availability: availabilityReason ? "unavailable" : "available",
    availabilityReason,
    version,
    textualEvidence: evidence,
    protectedChecks: [...protectedChecks.values()],
    literalGitTargetOptions: [],
    limitations,
    surfaceObservations: observations,
    repositoryVerification: "not-claimed",
  };
}

export async function createDcgProcessAdapter(options: DcgProcessAdapterOptions = {}): Promise<DcgProcessAdapter> {
  const binary = options.binary ?? process.env.BASHGUARD_DCG_BIN ?? process.env.DCG_BIN ?? "dcg";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const probe = await probeDcgBinary(binary, timeoutMs);

  return {
    id: "dcg-process",
    label: probe.available ? `dcg process adapter (${probe.version ?? "available"})` : "dcg process adapter (unavailable)",
    binary,
    version: probe.version,
    availability: probe.available ? "available" : "unavailable",
    availabilityReason: probe.reason,
    capabilities: {
      structural: false,
      checks: true,
      literalGitTargets: false,
      decisionSchema: true,
      classifySchema: true,
      explainSchema: true,
      available: probe.available,
    },
    async analyze(command: string, signal?: AbortSignal): Promise<DcgProcessAnalysis> {
      if (!probe.available) {
        return {
          adapterId: "dcg-process",
          adapterLabel: "dcg process adapter",
          command,
          status: "unsupported",
          binary,
          availability: "unavailable",
          availabilityReason: probe.reason,
          version: probe.version,
          textualEvidence: [probe.reason ?? `dcg unavailable: ${binary}`],
          protectedChecks: [],
          literalGitTargetOptions: [],
          limitations: [
            probe.reason ?? `dcg unavailable: ${binary}`,
            "dcg is optional and skipped visibly when missing",
            "dcg output is normalized into BashGuard evidence; the adapter does not claim Git repository verification",
          ],
          surfaceObservations: [],
          repositoryVerification: "not-claimed",
        };
      }

      const observations: DcgProcessSurfaceObservation[] = [];
      const robot = await runDcgCommand(binary, ["--robot", "test", command], { timeoutMs, signal });
      const robotParsed = parsePayload(parseJson(robot.stdout));
      observations.push(surfaceEvidence("robot-test", robot, robotParsed));

      const classify = await runDcgCommand(binary, ["classify", "--format", "json", command], { timeoutMs, signal });
      const classifyParsed = parsePayload(parseJson(classify.stdout));
      observations.push(surfaceEvidence("classify", classify, classifyParsed));

      const shouldDeepInspect = options.includeExplain !== false && (robotParsed.decision === "deny" || classifyParsed.decision === "block" || classifyParsed.decision === "deny" || classifyParsed.decision === "ask" || classifyParsed.decision === "indeterminate");
      if (shouldDeepInspect) {
        const explain = await runDcgCommand(binary, ["explain", "--format", "json", command], { timeoutMs, signal });
        const explainParsed = parsePayload(parseJson(explain.stdout));
        observations.push(surfaceEvidence("explain", explain, explainParsed));
      }

      const anyErrors = observations.some((entry) => entry.notes.some((note) => note.includes("spawn error") || note.includes("timed out") || note.includes("aborted=")));
      const anyParseGaps = observations.some((entry) => entry.decision === undefined && entry.riskLevel === undefined && entry.ruleId === undefined && entry.traceCount === undefined);
      const analysis = summarizeEvidence(command, observations, binary, probe.reason, probe.version);
      if (anyErrors) {
        return { ...analysis, status: "degraded" };
      }
      if (anyParseGaps) {
        return { ...analysis, status: "degraded" };
      }
      return analysis;
    },
  };
}

function parseJson(input: string): unknown {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

export { mapProtectedCheck, parseJson, parsePayload, probeDcgBinary, runDcgCommand, sanitizeMaybe, surfaceEvidence };
