import { performance } from "node:perf_hooks";

import {
  type CommandAnalysisExpectation,
  type CorpusFixture,
  type ProtectedCheckOutcome,
} from "./model.ts";

export interface AdapterAnalysis {
  readonly adapterId: string;
  readonly adapterLabel: string;
  readonly command: string;
  readonly status: "structured" | "degraded" | "unsupported" | "failed";
  readonly textualEvidence: readonly string[];
  readonly protectedChecks: readonly { checkId: string; outcome: ProtectedCheckOutcome; evidenceLevel: string; text: string }[];
  readonly literalGitTargetOptions: readonly { option: "-C" | "--git-dir" | "--work-tree"; value: string }[];
  readonly limitations: readonly string[];
}

export interface AnalysisAdapter {
  readonly id: string;
  readonly label: string;
  analyze(fixture: CorpusFixture, signal: AbortSignal): AdapterAnalysis | Promise<AdapterAnalysis>;
}

export interface FixtureEvaluation {
  readonly fixtureId: string;
  readonly outcome: "pass" | "mismatch" | "error" | "timeout";
  readonly documented: CommandAnalysisExpectation;
  readonly demonstrated?: AdapterAnalysis;
  readonly notes: readonly string[];
  readonly durationMs: number;
}

export interface CorpusEvaluation {
  readonly adapterId: string;
  readonly adapterLabel: string;
  readonly fixtures: readonly FixtureEvaluation[];
  readonly summary: {
    readonly pass: number;
    readonly mismatch: number;
    readonly error: number;
    readonly timeout: number;
  };
}

export interface EvaluateOptions {
  readonly timeoutMs: number;
}

function toPromise<T>(value: T | Promise<T>): Promise<T> {
  return value instanceof Promise ? value : Promise.resolve(value);
}

function normalizeText(value: string): string {
  return value
    .replaceAll(/\/private\/tmp\/[A-Za-z0-9._/-]+/g, "<tmp-path>")
    .replaceAll(/(?:\/tmp|\/var\/tmp)\/[A-Za-z0-9._/-]+/g, "<tmp-path>")
    .replaceAll(/\b[A-Za-z]:\\[^\s"']+/g, "<drive-path>")
    .replaceAll(/\b\d+(?:\.\d+)?\s*ms\b/gi, "<duration-ms>");
}

function normalizeValue<T>(value: T): T {
  if (typeof value === "string") return normalizeText(value) as T;
  if (Array.isArray(value)) return value.map((entry) => normalizeValue(entry)) as T;
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) out[key] = normalizeValue(entry);
  return out as T;
}

function compareChecks(expected: CommandAnalysisExpectation, actual: AdapterAnalysis): string[] {
  const expectedChecks = expected.protectedChecks.filter((check) => check.outcome === "matched").map((check) => check.checkId).sort();
  const actualChecks = actual.protectedChecks.map((check) => check.checkId).sort();
  const notes: string[] = [];
  if (expectedChecks.join(",") !== actualChecks.join(",")) {
    notes.push(`expected checks ${expectedChecks.join(",") || "<none>"} but saw ${actualChecks.join(",") || "<none>"}`);
  }
  const expectedStatus = expected.status === "failed" ? "failed" : expected.segments.length > 0 ? "structured" : "degraded";
  if (expectedStatus !== actual.status && !(expectedChecks.length === 0 && actual.status === "degraded")) {
    notes.push(`expected status ${expectedStatus} but saw ${actual.status}`);
  }
  return notes;
}

async function evaluateFixture(
  adapter: AnalysisAdapter,
  fixture: CorpusFixture,
  options: EvaluateOptions,
): Promise<FixtureEvaluation> {
  const controller = new AbortController();
  const startedAt = performance.now();
  const timer = setTimeout(() => controller.abort(new Error(`evaluation timed out after ${options.timeoutMs}ms`)), options.timeoutMs);
  try {
    const result = await Promise.race([
      toPromise(adapter.analyze(fixture, controller.signal)),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(controller.signal.reason ?? new Error("evaluation timed out")), { once: true });
      }),
    ]);
    const notes = compareChecks(fixture.expected, result).map((line) => normalizeText(line));
    const outcome = notes.length === 0 ? "pass" : "mismatch";
    return {
      fixtureId: fixture.id,
      outcome,
      documented: fixture.expected,
      demonstrated: result,
      notes,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outcome = message.includes("timed out") ? "timeout" : "error";
    return {
      fixtureId: fixture.id,
      outcome,
      documented: fixture.expected,
      notes: [normalizeText(message)],
      durationMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function evaluateCorpus(
  adapter: AnalysisAdapter,
  corpus: readonly CorpusFixture[],
  options: EvaluateOptions,
): Promise<CorpusEvaluation> {
  const fixtures: FixtureEvaluation[] = [];
  for (const fixture of corpus) fixtures.push(await evaluateFixture(adapter, fixture, options));
  const summary = fixtures.reduce(
    (counts, fixtureResult) => {
      counts[fixtureResult.outcome] += 1;
      return counts;
    },
    { pass: 0, mismatch: 0, error: 0, timeout: 0 },
  );
  return {
    adapterId: adapter.id,
    adapterLabel: adapter.label,
    fixtures,
    summary,
  };
}

export function sanitizeEvaluationProjection<T>(value: T): T {
  return normalizeValue(value);
}
