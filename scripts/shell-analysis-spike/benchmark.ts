import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path, { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { shellAnalysisCorpus } from "./corpus.ts";
import { analyzeWithCurrentMatcher } from "./adapters/current-matcher.ts";
import { createDcgProcessAdapter } from "./adapters/dcg-process.ts";
import { analyzeWithNarrowAnalyzer } from "./adapters/narrow-analyzer.ts";
import { createTreeSitterNativeAdapter } from "./adapters/tree-sitter-native.ts";
import { createTreeSitterWasmAdapter } from "./adapters/tree-sitter-wasm.ts";
import { probeGitTarget, type GitProbeResult } from "./git-probe.ts";
import { resolveGitTargetCandidate, projectGitTargetLiteralEvidence } from "./git-target.ts";

const execFileAsync = promisify(execFile);

export interface BenchmarkQuantiles {
  readonly count: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

export interface BenchmarkPackageMetric {
  readonly packageName: string;
  readonly unpackedSizeBytes: number;
  readonly hasInstallScript: boolean;
  readonly nativeCompilation: boolean;
  readonly memoryDeltaBytes?: number;
  readonly notes?: readonly string[];
}

export interface BenchmarkAdapterSummary {
  readonly adapterId: string;
  readonly adapterLabel: string;
  readonly kind: "baseline" | "native" | "wasm" | "narrow" | "dcg" | "git-probe";
  readonly availability?: "available" | "unavailable";
  readonly availabilityReason?: string;
  readonly coldInitMs: number;
  readonly warmupIterations: number;
  readonly iterations: number;
  readonly safe: BenchmarkQuantiles;
  readonly error: BenchmarkQuantiles;
  readonly externalCostMs?: number;
  readonly dependencyMetrics: readonly BenchmarkPackageMetric[];
  readonly notes: readonly string[];
}

export interface BenchmarkCommandRecord {
  readonly command: string;
  readonly cwd?: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly notes?: readonly string[];
}

export interface BenchmarkReport {
  readonly generatedAt: string;
  readonly host: {
    readonly fingerprint: string;
    readonly platform: string;
    readonly arch: string;
    readonly release: string;
    readonly loadAverage: readonly number[];
    readonly totalMemoryBytes: number;
  };
  readonly toolVersions: {
    readonly node: string;
    readonly npm: string;
    readonly pi?: string;
    readonly git?: string;
    readonly dcg?: string;
  };
  readonly corpusSize: number;
  readonly fixtures: {
    readonly safe: readonly string[];
    readonly error: readonly string[];
    readonly representative: readonly string[];
  };
  readonly adapters: readonly BenchmarkAdapterSummary[];
  readonly commandLog: readonly BenchmarkCommandRecord[];
  readonly notes?: readonly string[];
}

export interface BenchmarkOptions {
  iterations?: number;
  warmupIterations?: number;
  timeoutMs?: number;
  gitTimeoutMs?: number;
  outputDir?: string;
  includeCommands?: boolean;
}

export interface BenchmarkRunResult {
  readonly outputDir: string;
  readonly report: BenchmarkReport;
}

export interface BenchmarkRunner {
  readonly run: (command: string, args: readonly string[], options?: { readonly cwd?: string; readonly timeoutMs?: number; readonly env?: NodeJS.ProcessEnv }) => Promise<BenchmarkCommandRecord>;
}

function normalizeText(value: string): string {
  return value
    .replaceAll(/\/(?:Users|home)\/[^\s"'`]+/g, "<home-path>")
    .replaceAll(/\/private\/(?:tmp|var\/folders)\/[A-Za-z0-9._/-]+/g, "<tmp-path>")
    .replaceAll(/(?:\/tmp|\/var\/tmp|\/var\/folders)\/[A-Za-z0-9._/-]+/g, "<tmp-path>")
    .replaceAll(/\b[A-Za-z]:\\[^\s"']+/g, "<drive-path>")
    .replaceAll(/\b\d+(?:\.\d+)?\s*ms\b/gi, "<duration-ms>")
    .replaceAll(/\b[0-9a-f]{12,64}\b/gi, "<hash>");
}

function sanitizeValue<T>(value: T): T {
  if (typeof value === "string") return normalizeText(value) as T;
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry)) as T;
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) out[key] = sanitizeValue(entry);
  return out as T;
}

function quantiles(values: readonly number[]): BenchmarkQuantiles {
  if (values.length === 0) {
    return { count: 0, minMs: 0, maxMs: 0, p50Ms: 0, p95Ms: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const pick = (fraction: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
  return {
    count: sorted.length,
    minMs: sorted[0]!,
    maxMs: sorted[sorted.length - 1]!,
    p50Ms: pick(0.5),
    p95Ms: pick(0.95),
  };
}

function hashFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

async function directorySize(root: string): Promise<number> {
  let total = 0;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(entryPath);
      continue;
    }
    if (entry.isFile()) {
      total += (await stat(entryPath)).size;
    }
  }
  return total;
}

async function packageRootForSpecifier(specifier: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", `import { createRequire } from 'node:module'; import { dirname, join } from 'node:path'; import { existsSync, readFileSync } from 'node:fs'; const require = createRequire(import.meta.url); let directory = dirname(require.resolve(${JSON.stringify(specifier)})); while (true) { const packageJsonPath = join(directory, 'package.json'); if (existsSync(packageJsonPath)) { const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')); if (pkg && typeof pkg === 'object') { console.log(directory); break; } } const parent = dirname(directory); if (parent === directory) break; directory = parent; }`], {
      cwd: process.cwd(),
      maxBuffer: 16 * 1024,
      timeout: 10_000,
    });
    const value = stdout.trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

async function measureImportMemory(specifier: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "--input-type=module",
      "-e",
      `const before = process.memoryUsage().rss; await import(${JSON.stringify(specifier)}); console.log(String(process.memoryUsage().rss - before));`,
    ], {
      cwd: process.cwd(),
      maxBuffer: 16 * 1024,
      timeout: 20_000,
    });
    const parsed = Number(stdout.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function inspectPackage(specifier: string, notes: string[] = []): Promise<BenchmarkPackageMetric | undefined> {
  const root = await packageRootForSpecifier(specifier);
  if (!root) return undefined;
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { readonly scripts?: Record<string, unknown>; readonly gypfile?: boolean; readonly binary?: Record<string, unknown> };
  const hasInstallScript = Boolean(packageJson.scripts?.install || packageJson.scripts?.postinstall || packageJson.scripts?.prepare);
  const nativeCompilation = Boolean(packageJson.gypfile || await hasNativeFiles(root));
  const memoryDeltaBytes = await measureImportMemory(specifier);
  return {
    packageName: specifier,
    unpackedSizeBytes: await directorySize(root),
    hasInstallScript,
    nativeCompilation,
    memoryDeltaBytes,
    notes,
  };
}

async function hasNativeFiles(root: string): Promise<boolean> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name === "binding.gyp" || entry.name.endsWith(".node"))) return true;
      if (entry.isDirectory()) {
        const found = await hasNativeFiles(join(root, entry.name));
        if (found) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

function buildCommandRecord(command: string, args: readonly string[], cwd: string, startedAt: number, result: CommandResult): BenchmarkCommandRecord {
  return {
    command: [command, ...args].join(" "),
    cwd,
    exitCode: result.exitCode,
    stdout: normalizeText(result.stdout),
    stderr: normalizeText(result.stderr),
    durationMs: Math.round(performance.now() - startedAt),
    notes: [],
  };
}

async function runCommand(command: string, args: readonly string[], options: { readonly cwd?: string; readonly timeoutMs?: number; readonly env?: NodeJS.ProcessEnv } = {}): Promise<BenchmarkCommandRecord> {
  const startedAt = performance.now();
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeoutMs ?? 20_000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
    });
    return buildCommandRecord(command, args, options.cwd ?? process.cwd(), startedAt, { stdout, stderr, exitCode: 0 });
  } catch (error) {
    const failed = error as NodeJS.ErrnoException & { readonly stdout?: string; readonly stderr?: string; readonly status?: number | null };
    return buildCommandRecord(command, args, options.cwd ?? process.cwd(), startedAt, {
      stdout: typeof failed.stdout === "string" ? failed.stdout : "",
      stderr: typeof failed.stderr === "string" ? failed.stderr : failed.message,
      exitCode: typeof failed.status === "number" ? failed.status : null,
    });
  }
}

function selectFixtures(corpus = shellAnalysisCorpus()): { safe: string[]; error: string[]; representative: string[] } {
  const safe = corpus
    .filter((fixture) => fixture.expected.status === "structured" && fixture.expected.protectedChecks.every((check) => check.outcome !== "matched"))
    .slice(0, 4)
    .map((fixture) => fixture.id);
  const error = corpus
    .filter((fixture) => fixture.expected.status !== "structured" || fixture.expected.unresolved.length > 0)
    .slice(0, 4)
    .map((fixture) => fixture.id);
  const representative = corpus.slice(0, 3).map((fixture) => fixture.id);
  return { safe, error, representative };
}

function fixtureById(id: string): ReturnType<typeof shellAnalysisCorpus>[number] {
  const fixture = shellAnalysisCorpus().find((entry) => entry.id === id);
  if (!fixture) throw new Error(`missing benchmark fixture ${id}`);
  return fixture;
}

async function runAdapterBenchmark(
  adapterId: string,
  adapterLabel: string,
  kind: BenchmarkAdapterSummary["kind"],
  analyze: (command: string) => Promise<unknown> | unknown,
  options: { readonly iterations: number; readonly warmupIterations: number; readonly dependencyMetrics: readonly BenchmarkPackageMetric[]; readonly externalCostMs?: number; readonly notes?: readonly string[] },
  sample: { readonly safe: readonly string[]; readonly error: readonly string[] },
): Promise<BenchmarkAdapterSummary> {
  const coldStartedAt = performance.now();
  const warmup = sample.safe[0] ?? sample.error[0];
  for (let index = 0; index < options.warmupIterations && warmup; index += 1) {
    await analyze(fixtureById(warmup).command);
  }
  const coldInitMs = Math.round(performance.now() - coldStartedAt);

  const safeDurations: number[] = [];
  const errorDurations: number[] = [];
  for (let index = 0; index < options.iterations; index += 1) {
    for (const fixtureId of sample.safe) {
      const fixture = fixtureById(fixtureId);
      const startedAt = performance.now();
      await analyze(fixture.command);
      safeDurations.push(performance.now() - startedAt);
    }
    for (const fixtureId of sample.error) {
      const fixture = fixtureById(fixtureId);
      const startedAt = performance.now();
      await analyze(fixture.command);
      errorDurations.push(performance.now() - startedAt);
    }
  }

  return {
    adapterId,
    adapterLabel,
    kind,
    coldInitMs,
    warmupIterations: options.warmupIterations,
    iterations: options.iterations,
    safe: quantiles(safeDurations),
    error: quantiles(errorDurations),
    externalCostMs: options.externalCostMs,
    dependencyMetrics: options.dependencyMetrics,
    notes: options.notes ?? [],
  };
}

async function runGitProbeBenchmark(timeoutMs: number): Promise<{ readonly summary: BenchmarkAdapterSummary; readonly commands: BenchmarkCommandRecord[] }> {
  const tempRoot = await mkdirTemporaryRoot("bashguard-shell-analysis-git");
  const repoRoot = join(tempRoot, "repo");
  const missingRoot = join(tempRoot, "missing");
  const commands: BenchmarkCommandRecord[] = [];
  try {
    await mkdir(repoRoot, { recursive: true });
    commands.push(await runCommand("git", ["init"], { cwd: repoRoot, timeoutMs }));
    await writeFile(join(repoRoot, "README.md"), "# benchmark\n", "utf8");
    commands.push(await runCommand("git", ["status", "--porcelain=v1"], { cwd: repoRoot, timeoutMs }));
      const safeLiteral = projectGitTargetLiteralEvidence("git rev-parse --show-toplevel", repoRoot);
    const errorLiteral = projectGitTargetLiteralEvidence("git rev-parse --show-toplevel", missingRoot);
    if (safeLiteral.evidenceLevel !== "literal" || errorLiteral.evidenceLevel !== "literal") throw new Error("unexpected git target projection");
    const safeTarget = resolveGitTargetCandidate(safeLiteral);
    const errorTarget = resolveGitTargetCandidate(errorLiteral);

    const safeDurations: number[] = [];
    const errorDurations: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const safeStartedAt = performance.now();
      await probeGitTarget(safeTarget, { timeoutMs });
      safeDurations.push(performance.now() - safeStartedAt);
      const errorStartedAt = performance.now();
      await probeGitTarget(errorTarget, { timeoutMs });
      errorDurations.push(performance.now() - errorStartedAt);
    }

    return {
      summary: {
        adapterId: "git-probe",
        adapterLabel: "Git probe",
        kind: "git-probe",
        coldInitMs: 0,
        warmupIterations: 1,
        iterations: 5,
        safe: quantiles(safeDurations),
        error: quantiles(errorDurations),
        externalCostMs: quantiles(commands.map((entry) => entry.durationMs)).p50Ms,
        dependencyMetrics: [],
        notes: ["fresh repository and missing-path candidate"],
      },
      commands,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function mkdirTemporaryRoot(prefix: string): Promise<string> {
  return await mkdtemp(join(os.tmpdir(), `${prefix}-`));
}

function sortSummaries(summaries: readonly BenchmarkAdapterSummary[]): readonly BenchmarkAdapterSummary[] {
  return [...summaries].sort((left, right) => left.adapterId.localeCompare(right.adapterId));
}

export function projectBenchmarkReport<T extends BenchmarkReport>(report: T): T {
  return sanitizeValue({
    ...report,
    adapters: sortSummaries(report.adapters),
    commandLog: [...report.commandLog].sort((left, right) => left.command.localeCompare(right.command)),
  });
}

function formatQuantiles(label: string, quantile: BenchmarkQuantiles): string {
  return `${label} p50 ${quantile.p50Ms.toFixed(2)} ms · ${label} p95 ${quantile.p95Ms.toFixed(2)} ms · n ${quantile.count}`;
}

function formatAdapterQuantiles(adapter: BenchmarkAdapterSummary, label: "safe" | "error"): string {
  if (adapter.availability === "unavailable") return "n/a";
  return formatQuantiles(label, label === "safe" ? adapter.safe : adapter.error);
}

function formatAdapterInit(adapter: BenchmarkAdapterSummary): string {
  if (adapter.availability === "unavailable") return "n/a";
  return `${adapter.coldInitMs.toFixed(2)} ms`;
}

function formatExternalCost(adapter: BenchmarkAdapterSummary): string {
  if (adapter.availability === "unavailable") return "n/a";
  return adapter.externalCostMs === undefined ? "n/a" : `${adapter.externalCostMs.toFixed(2)} ms`;
}

function formatDependencies(metrics: readonly BenchmarkPackageMetric[]): string {
  if (metrics.length === 0) return "none";
  return metrics
    .map((metric) => `${metric.packageName} · ${metric.unpackedSizeBytes} bytes · install ${metric.hasInstallScript ? "yes" : "no"} · native ${metric.nativeCompilation ? "yes" : "no"}${metric.memoryDeltaBytes !== undefined ? ` · memory ${metric.memoryDeltaBytes} bytes` : ""}`)
    .join("; ");
}

export function formatBenchmarkMarkdown(report: BenchmarkReport): string {
  const lines = [
    "# Shell analysis benchmark",
    "",
    `Generated: ${report.generatedAt} (local observation; timestamp/load/durations are non-repeatable)`,
    `Host: ${report.host.platform} ${report.host.arch} · ${report.host.release} · load ${report.host.loadAverage.join(", ")} · memory ${report.host.totalMemoryBytes} · host ${report.host.fingerprint}`,
    `Tools: node ${report.toolVersions.node} · npm ${report.toolVersions.npm}${report.toolVersions.pi ? ` · pi ${report.toolVersions.pi}` : ""}${report.toolVersions.git ? ` · git ${report.toolVersions.git}` : ""}${report.toolVersions.dcg ? ` · dcg ${report.toolVersions.dcg}` : ""}`,
    `Corpus fixtures: ${report.corpusSize}`,
    `Safe fixtures: ${report.fixtures.safe.join(", ")}`,
    `Error fixtures: ${report.fixtures.error.join(", ")}`,
    `Representative fixtures: ${report.fixtures.representative.join(", ")}`,
    "",
    "| Adapter | Kind | Init | Safe | Error | external cost | Dependency metrics | Notes |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const adapter of sortSummaries(report.adapters)) {
    lines.push(
      `| ${adapter.adapterLabel} | ${adapter.kind} | ${formatAdapterInit(adapter)} | ${formatAdapterQuantiles(adapter, "safe")} | ${formatAdapterQuantiles(adapter, "error")} | ${formatExternalCost(adapter)} | ${formatDependencies(adapter.dependencyMetrics)} | ${adapter.notes.join("; ") || "-"} |`,
    );
  }
  if (report.commandLog.length > 0) {
    lines.push("", "## Commands", "");
    for (const entry of report.commandLog) {
      lines.push(`- ${entry.command} → exit ${entry.exitCode ?? "unknown"} · ${entry.durationMs.toFixed(1)} ms`);
      if (entry.stdout) lines.push(`  - stdout: ${entry.stdout}`);
      if (entry.stderr) lines.push(`  - stderr: ${entry.stderr}`);
    }
  }
  const notes = report.notes ?? [];
  if (notes.length > 0) {
    lines.push("", "## Notes", ...notes.map((note) => `- ${note}`));
  }
  return `${lines.join("\n")}\n`;
}

export function formatBenchmarkJson(report: BenchmarkReport): string {
  return `${JSON.stringify(projectBenchmarkReport(report), null, 2)}\n`;
}

function parseArgs(argv: string[]): BenchmarkOptions {
  const options: BenchmarkOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--output-dir") {
      const value = argv[++index];
      if (!value) throw new Error("--output-dir requires a value");
      options.outputDir = value;
      continue;
    }
    if (option === "--iterations") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1) throw new Error("--iterations must be a positive integer");
      options.iterations = value;
      continue;
    }
    if (option === "--warmup-iterations") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 0) throw new Error("--warmup-iterations must be a non-negative integer");
      options.warmupIterations = value;
      continue;
    }
    if (option === "--timeout-ms") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1) throw new Error("--timeout-ms must be a positive integer");
      options.timeoutMs = value;
      continue;
    }
    if (option === "--git-timeout-ms") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1) throw new Error("--git-timeout-ms must be a positive integer");
      options.gitTimeoutMs = value;
      continue;
    }
    if (option === "--include-commands") {
      options.includeCommands = true;
      continue;
    }
    throw new Error(`Unknown option: ${option}`);
  }
  return options;
}

export async function runShellAnalysisBenchmark(options: BenchmarkOptions = {}): Promise<BenchmarkRunResult> {
  const corpus = shellAnalysisCorpus();
  const selectedFixtures = selectFixtures(corpus);
  const iterations = options.iterations ?? 5;
  const warmupIterations = options.warmupIterations ?? 1;
  const timeoutMs = options.timeoutMs ?? 250;
  const gitTimeoutMs = options.gitTimeoutMs ?? 500;
  const commands: BenchmarkCommandRecord[] = [];

  const dependencyMetricsFor = async (packages: readonly string[]): Promise<BenchmarkPackageMetric[]> => {
    const metrics: BenchmarkPackageMetric[] = [];
    for (const specifier of packages) {
      const metric = await inspectPackage(specifier, []);
      if (metric) metrics.push(metric);
    }
    return metrics;
  };

  const currentMatcherStart = performance.now();
  const currentMatcher = await runAdapterBenchmark(
    "current-matcher",
    "Current matcher baseline",
    "baseline",
    (command) => analyzeWithCurrentMatcher(command),
    {
      iterations,
      warmupIterations,
      dependencyMetrics: await dependencyMetricsFor(["string-width"]),
      notes: ["observed current matcher only"],
      externalCostMs: undefined,
    },
    selectedFixtures,
  );
  const currentMatcherInitMs = Math.round(performance.now() - currentMatcherStart);

  const nativeAdapterStart = performance.now();
  const nativeAdapter = await createTreeSitterNativeAdapter();
  const nativeInitMs = Math.round(performance.now() - nativeAdapterStart);
  const native = await runAdapterBenchmark(
    nativeAdapter.id,
    nativeAdapter.label,
    "native",
    (command) => nativeAdapter.analyze({ id: "benchmark", title: "benchmark", family: "command-resolution-shape", command, expected: fixtureById(selectedFixtures.safe[0] ?? selectedFixtures.error[0]).expected } as never, new AbortController().signal),
    {
      iterations,
      warmupIterations,
      dependencyMetrics: await dependencyMetricsFor(["tree-sitter", "tree-sitter-bash"]),
      notes: ["tree-sitter native binding candidate"],
      externalCostMs: undefined,
    },
    selectedFixtures,
  );

  const wasmAdapterStart = performance.now();
  const wasmAdapter = await createTreeSitterWasmAdapter();
  const wasmInitMs = Math.round(performance.now() - wasmAdapterStart);
  const wasm = await runAdapterBenchmark(
    wasmAdapter.id,
    wasmAdapter.label,
    "wasm",
    (command) => wasmAdapter.analyze({ id: "benchmark", title: "benchmark", family: "command-resolution-shape", command, expected: fixtureById(selectedFixtures.safe[0] ?? selectedFixtures.error[0]).expected } as never, new AbortController().signal),
    {
      iterations,
      warmupIterations,
      dependencyMetrics: await dependencyMetricsFor(["web-tree-sitter", "tree-sitter-bash"]),
      notes: ["web-tree-sitter parser candidate"],
      externalCostMs: undefined,
    },
    selectedFixtures,
  );

  const narrow = await runAdapterBenchmark(
    "narrow-analyzer",
    "Narrow shell analyzer",
    "narrow",
    (command) => analyzeWithNarrowAnalyzer(command),
    {
      iterations,
      warmupIterations,
      dependencyMetrics: await dependencyMetricsFor(["string-width"]),
      notes: ["bounded tokenizer/analyzer"],
      externalCostMs: undefined,
    },
    selectedFixtures,
  );

  const dcgStart = performance.now();
  const dcgAdapter = await createDcgProcessAdapter({ timeoutMs });
  const dcgInitMs = Math.round(performance.now() - dcgStart);
  const dcg = await runAdapterBenchmark(
    dcgAdapter.id,
    dcgAdapter.label,
    "dcg",
    (command) => dcgAdapter.analyze(command),
    {
      iterations,
      warmupIterations,
      dependencyMetrics: [],
      notes: dcgAdapter.availability === "available" ? ["dcg external process"] : [dcgAdapter.availabilityReason ?? "dcg unavailable"],
      externalCostMs: undefined,
    },
    selectedFixtures,
  );

  const gitProbe = await runGitProbeBenchmark(gitTimeoutMs);
  const report: BenchmarkReport = {
    generatedAt: new Date().toISOString(),
    host: {
      fingerprint: hashFingerprint(os.hostname()),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      loadAverage: os.loadavg(),
      totalMemoryBytes: os.totalmem(),
    },
    toolVersions: {
      node: process.version,
      npm: (await runCommand("npm", ["--version"])).stdout.trim() || "unknown",
      pi: (await runCommand("pi", ["--version"])).stdout.trim() || undefined,
      git: (await runCommand("git", ["--version"])).stdout.trim() || undefined,
      dcg: dcgAdapter.version ?? undefined,
    },
    corpusSize: corpus.length,
    fixtures: selectedFixtures,
    adapters: [
      { ...currentMatcher, coldInitMs: currentMatcherInitMs, notes: [...currentMatcher.notes, "local observation only"] },
      { ...native, coldInitMs: nativeInitMs, notes: [...native.notes, nativeAdapter.availabilityReason ?? "available"] },
      { ...wasm, coldInitMs: wasmInitMs, notes: [...wasm.notes, wasmAdapter.availabilityReason ?? "available"] },
      { ...narrow, coldInitMs: narrow.coldInitMs },
      { ...dcg, coldInitMs: dcgInitMs, availability: dcgAdapter.availability, availabilityReason: dcgAdapter.availabilityReason, notes: [...dcg.notes, dcgAdapter.availabilityReason ?? "available"] },
      gitProbe.summary,
    ],
    commandLog: options.includeCommands ? [
      ...gitProbe.commands,
      await runCommand("npm", ["--version"]),
      await runCommand("git", ["--version"]),
    ] : [],
    notes: [
      "Local observations only; snapshot timestamp, load, and durations are non-repeatable.",
      "Deterministic schema/order/sanitization are tested separately.",
      "Cold initialization includes only the measured factory call, not top-level module import time.",
      "External costs are local subprocess observations, not guarantees.",
      nativeAdapter.availability === "available" ? "Tree-sitter native candidate initialized successfully." : `Tree-sitter native candidate blocked: ${nativeAdapter.availabilityReason ?? "unknown"}`,
      wasmAdapter.availability === "available" ? "Tree-sitter WASM candidate initialized successfully." : `Tree-sitter WASM candidate blocked: ${wasmAdapter.availabilityReason ?? "unknown"}`,
      dcgAdapter.availability === "available" ? "dcg detected locally." : `dcg unavailable: ${dcgAdapter.availabilityReason ?? "not installed"}`,
    ],
  };

  const outputDir = options.outputDir ?? process.env.BASHGUARD_SHELL_ANALYSIS_OUTPUT_DIR ?? join(os.tmpdir(), "bashguard-shell-analysis", "benchmark");
  const projected = projectBenchmarkReport(report);
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "benchmark-report.md"), formatBenchmarkMarkdown(projected), "utf8");
  await writeFile(join(outputDir, "benchmark-report.json"), formatBenchmarkJson(projected), "utf8");
  return { outputDir, report: projected };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await runShellAnalysisBenchmark(options);
  process.stdout.write(`${normalizeText(result.outputDir)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    process.stderr.write(`benchmark: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
