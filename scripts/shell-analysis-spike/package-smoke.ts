import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export interface PackageSmokeCommandRecord {
  readonly command: string;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut?: boolean;
  readonly notes?: readonly string[];
}

export interface PackageSmokeInstallEvidence {
  readonly status: "loaded" | "blocked" | "unknown";
  readonly evidence: "observed" | "blocked" | "missing";
  readonly command: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly notes?: readonly string[];
}

export interface PackageSmokeProcessEvidence {
  readonly status: "observed" | "blocked" | "missing" | "unproven";
  readonly evidence: "observed" | "blocked" | "missing" | "unproven";
  readonly command: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly notes?: readonly string[];
}

export interface PackageSmokeCandidate {
  readonly packageName: string;
  readonly runtimeDependencies: readonly string[];
  readonly unpackedSizeBytes: number;
  readonly hasInstallScript: boolean;
  readonly nativeCompilation: boolean;
  readonly importInit: PackageSmokeInstallEvidence;
  readonly notes: readonly string[];
}

export interface BashGuardPackageSmokeSection {
  readonly pack: {
    readonly tarball: string;
    readonly unpackedSizeBytes: number;
    readonly succeeded: boolean;
  };
  readonly install: PackageSmokeProcessEvidence;
  readonly piProcess: PackageSmokeProcessEvidence;
  readonly startupEvidence: PackageSmokeProcessEvidence;
  readonly registrationConfig: PackageSmokeProcessEvidence;
  readonly authBehavior: PackageSmokeProcessEvidence;
}

export interface PackageSmokeReport {
  readonly generatedAt: string;
  readonly isolatedRoots: {
    readonly configDir: string;
    readonly projectDir: string;
    readonly packageRoot: string;
  };
  readonly bashguardPackage: BashGuardPackageSmokeSection;
  readonly candidatePackages: readonly PackageSmokeCandidate[];
  readonly commands: readonly PackageSmokeCommandRecord[];
  readonly notes: readonly string[];
}

export interface PackageSmokeOptions {
  outputDir?: string;
  timeoutMs?: number;
  includeCommands?: boolean;
}

export interface PackageSmokeRunResult {
  readonly outputDir: string;
  readonly report: PackageSmokeReport;
}

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

function normalizeText(value: string): string {
  return value
    .replaceAll(/\/(?:Users|home)\/[^\s"'`]+/g, "<home-path>")
    .replaceAll(/\/private\/(?:tmp|var\/folders)\/[A-Za-z0-9._/-]+/g, "<tmp-path>")
    .replaceAll(/(?:\/tmp|\/var\/tmp|\/var\/folders)\/[A-Za-z0-9._/-]+/g, "<tmp-path>")
    .replaceAll(/\b[A-Za-z]:\\[^\s"']+/g, "<drive-path>")
    .replaceAll(/\b\d+(?:\.\d+)?\s*ms\b/gi, "<duration-ms>");
}

function sanitizeValue<T>(value: T): T {
  if (typeof value === "string") return normalizeText(value) as T;
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry)) as T;
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) out[key] = sanitizeValue(entry);
  return out as T;
}

async function runCommand(command: string, args: readonly string[], options: { readonly cwd?: string; readonly timeoutMs?: number; readonly env?: NodeJS.ProcessEnv } = {}): Promise<PackageSmokeCommandRecord> {
  const startedAt = performance.now();
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeoutMs ?? 30_000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    });
    return {
      command: [command, ...args].join(" "),
      cwd: options.cwd ?? process.cwd(),
      exitCode: 0,
      stdout: normalizeText(stdout),
      stderr: normalizeText(stderr),
      durationMs: Math.round(performance.now() - startedAt),
      notes: [],
    };
  } catch (error) {
    const failed = error as NodeJS.ErrnoException & { readonly stdout?: string; readonly stderr?: string; readonly status?: number | null; readonly killed?: boolean; readonly signal?: NodeJS.Signals | null };
    return {
      command: [command, ...args].join(" "),
      cwd: options.cwd ?? process.cwd(),
      exitCode: typeof failed.status === "number" ? failed.status : null,
      stdout: normalizeText(typeof failed.stdout === "string" ? failed.stdout : ""),
      stderr: normalizeText(typeof failed.stderr === "string" ? failed.stderr : failed.message),
      durationMs: Math.round(performance.now() - startedAt),
      timedOut: failed.killed === true || failed.signal === "SIGTERM",
      notes: [],
    };
  }
}

async function sizeOf(root: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      total += await sizeOf(entryPath);
      continue;
    }
    if (entry.isFile()) total += (await stat(entryPath)).size;
  }
  return total;
}

async function hasInstallScript(root: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { readonly scripts?: Record<string, unknown> };
    return Boolean(pkg.scripts?.install || pkg.scripts?.postinstall || pkg.scripts?.prepare);
  } catch {
    return false;
  }
}

async function hasNativeFiles(root: string): Promise<boolean> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);
    if (entry.isFile() && (entry.name === "binding.gyp" || entry.name.endsWith(".node"))) return true;
    if (entry.isDirectory() && await hasNativeFiles(entryPath)) return true;
  }
  return false;
}

function candidatePackageJson(name: string, runtimeDependencies: Record<string, string>): string {
  return `${JSON.stringify({
    name,
    version: "0.0.0",
    private: true,
    type: "module",
    main: "index.mjs",
    scripts: {
      build: "node -e \"console.log('build')\"",
    },
    dependencies: runtimeDependencies,
    files: ["index.mjs", "package.json"],
  }, null, 2)}\n`;
}

async function writeCandidatePackage(root: string, name: string, runtimeDependencies: Record<string, string>, initBody: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), candidatePackageJson(name, runtimeDependencies), "utf8");
  await writeFile(join(root, "index.mjs"), `${initBody}\n`, "utf8");
}

async function packPackage(root: string, timeoutMs: number): Promise<{ readonly tarball: string; readonly command: PackageSmokeCommandRecord }> {
  const command = await runCommand("npm", ["pack"], { cwd: root, timeoutMs });
  const tarball = await findTarball(root, command.stdout, command.stderr);
  if (!tarball) {
    const files = await readdir(root);
    throw new Error(`npm pack did not yield a tarball for ${root}; files=${files.join(",")}; stdout=${normalizeText(command.stdout)}; stderr=${normalizeText(command.stderr)}`);
  }
  return { tarball, command };
}

async function extractTarball(tarballPath: string, extractDir: string, timeoutMs: number): Promise<PackageSmokeCommandRecord> {
  await mkdir(extractDir, { recursive: true });
  return await runCommand("tar", ["-xzf", tarballPath, "-C", extractDir], { timeoutMs });
}

async function importInit(packageRoot: string, timeoutMs: number): Promise<PackageSmokeInstallEvidence & { readonly memoryDeltaBytes?: number }> {
  const entry = join(packageRoot, "index.mjs");
  const command = [
    process.execPath,
    "--input-type=module",
    "-e",
    `import { pathToFileURL } from 'node:url'; const before = process.memoryUsage().rss; const mod = await import(pathToFileURL(${JSON.stringify(entry)}).href); if (typeof mod.init === 'function') { await mod.init(); } console.log(String(process.memoryUsage().rss - before));`,
  ];
  const startedAt = performance.now();
  try {
    const { stdout, stderr } = await execFileAsync(command[0]!, command.slice(1), {
      cwd: packageRoot,
      timeout: timeoutMs,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    });
    const trimmed = stdout.trim();
    const maybeDelta = Number(trimmed.split(/\s+/).at(-1));
    return {
      status: "loaded",
      evidence: "observed",
      command: `${command[0]} ${command.slice(1).join(" ")}`,
      exitCode: 0,
      stdout: normalizeText(stdout),
      stderr: normalizeText(stderr),
      notes: Number.isFinite(maybeDelta) ? ["imported candidate package", `memory delta ${maybeDelta} bytes`] : ["imported candidate package"],
      memoryDeltaBytes: Number.isFinite(maybeDelta) ? maybeDelta : undefined,
    };
  } catch (error) {
    const failed = error as NodeJS.ErrnoException & { readonly stdout?: string; readonly stderr?: string; readonly status?: number | null };
    return {
      status: "blocked",
      evidence: "blocked",
      command: `${command[0]} ${command.slice(1).join(" ")}`,
      exitCode: typeof failed.status === "number" ? failed.status : null,
      stdout: normalizeText(typeof failed.stdout === "string" ? failed.stdout : ""),
      stderr: normalizeText(typeof failed.stderr === "string" ? failed.stderr : failed.message),
      notes: ["package import/init blocked"],
      memoryDeltaBytes: undefined,
    };
  } finally {
    void startedAt;
  }
}

async function packageFileSize(root: string): Promise<number> {
  return await sizeOf(root);
}

interface SentinelSnapshot {
  readonly path: string;
  readonly contents: string;
}

async function createSentinelSnapshot(root: string, label: string): Promise<SentinelSnapshot> {
  const path = join(root, `.bashguard-sentinel-${label}.txt`);
  const contents = `${label}:${Date.now()}:${Math.random().toString(16).slice(2)}\n`;
  await writeFile(path, contents, "utf8");
  return { path, contents };
}

async function sentinelUnchanged(snapshot: SentinelSnapshot): Promise<boolean> {
  try {
    const contents = await readFile(snapshot.path, "utf8");
    return contents === snapshot.contents;
  } catch {
    return false;
  }
}

async function resolveExtractedPackageRoot(extractDir: string): Promise<string> {
  const directPackageJson = join(extractDir, "package.json");
  if (await fileExists(directPackageJson)) return extractDir;
  const nested = join(extractDir, "package");
  if (await fileExists(join(nested, "package.json"))) return nested;
  throw new Error(`unable to locate extracted package root in ${extractDir}`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function packageDependenciesFor(kind: "native" | "wasm" | "narrow"): Record<string, string> {
  const nativeTreeSitter = resolve(REPO_ROOT, "node_modules", "tree-sitter");
  const treeSitterBash = resolve(REPO_ROOT, "node_modules", "tree-sitter-bash");
  const webTreeSitter = resolve(REPO_ROOT, "node_modules", "web-tree-sitter");
  const stringWidth = resolve(REPO_ROOT, "node_modules", "string-width");
  const stripAnsi = resolve(REPO_ROOT, "node_modules", "strip-ansi");
  switch (kind) {
    case "native":
      return { "tree-sitter": `file:${nativeTreeSitter}`, "tree-sitter-bash": `file:${treeSitterBash}` };
    case "wasm":
      return { "web-tree-sitter": `file:${webTreeSitter}`, "tree-sitter-bash": `file:${treeSitterBash}` };
    case "narrow":
      return { "string-width": `file:${stringWidth}`, "strip-ansi": `file:${stripAnsi}` };
  }
}

function candidateInitSource(kind: "native" | "wasm" | "narrow"): string {
  if (kind === "native") {
    return `import Parser from 'tree-sitter';\nimport BashLanguage from 'tree-sitter-bash';\nexport async function init() {\n  const parser = new Parser();\n  parser.setLanguage(BashLanguage);\n  const tree = parser.parse('echo hi');\n  return { kind: 'native', root: tree.rootNode.type, named: tree.rootNode.namedChildCount };\n}`;
  }
  if (kind === "wasm") {
    return `import * as WebTreeSitter from 'web-tree-sitter';\nexport async function init() {\n  return { kind: 'wasm', keys: Object.keys(WebTreeSitter).slice(0, 6) };\n}`;
  }
  return `import stringWidth from 'string-width';\nimport stripAnsi from 'strip-ansi';\nexport async function init() {\n  return { kind: 'narrow', width: stringWidth(stripAnsi('abc')), output: stripAnsi('abc') };\n}`;
}

async function buildCandidate(root: string, kind: "native" | "wasm" | "narrow", timeoutMs: number): Promise<PackageSmokeCandidate> {
  const packageName = `bashguard-${kind}-candidate`;
  const dependencies = packageDependenciesFor(kind);
  const candidateRoot = join(root, packageName);
  await writeCandidatePackage(candidateRoot, packageName, dependencies, candidateInitSource(kind));

  const pack = await packPackage(candidateRoot, timeoutMs);
  const tarballPath = join(candidateRoot, pack.tarball);
  const extractDir = join(root, `${packageName}-extract`);
  const extractCommand = await extractTarball(tarballPath, extractDir, timeoutMs);
  const packageRoot = await resolveExtractedPackageRoot(extractDir);
  const installCommand = await runCommand("npm", ["install", "--omit=dev"], { cwd: packageRoot, timeoutMs });
  const importResult = await importInit(packageRoot, timeoutMs);
  const unpackedSizeBytes = await packageFileSize(packageRoot);
  const runtimeDependencies = Object.keys(dependencies);
  return {
    packageName,
    runtimeDependencies,
    unpackedSizeBytes,
    hasInstallScript: await hasInstallScript(extractDir),
    nativeCompilation: await hasNativeFiles(extractDir),
    importInit: {
      status: importResult.status,
      evidence: importResult.evidence,
      command: importResult.command,
      exitCode: importResult.exitCode,
      stdout: importResult.stdout,
      stderr: importResult.stderr,
      notes: importResult.notes,
    },
    notes: [
      `pack ${pack.command.exitCode === 0 ? 'succeeded' : 'failed'}`,
      `extract ${extractCommand.exitCode === 0 ? 'succeeded' : 'failed'}`,
      `install ${installCommand.exitCode === 0 ? 'succeeded' : 'failed'}`,
      importResult.memoryDeltaBytes !== undefined ? `memory delta ${importResult.memoryDeltaBytes} bytes` : "memory delta unavailable",
    ],
  };
}

function sortCandidates<T extends { readonly packageName: string }>(values: readonly T[]): readonly T[] {
  return [...values].sort((left, right) => left.packageName.localeCompare(right.packageName));
}

export function projectPackageSmokeReport<T extends PackageSmokeReport>(report: T): T {
  return sanitizeValue({
    ...report,
    candidatePackages: sortCandidates(report.candidatePackages),
    commands: [...report.commands].sort((left, right) => left.command.localeCompare(right.command)),
  });
}

function formatPackageSmokeEvidence(label: string, evidence: PackageSmokeProcessEvidence): string {
  return `${label}: ${evidence.status} · ${evidence.evidence}${evidence.timedOut ? " · timed out" : ""}`;
}

export function formatPackageSmokeMarkdown(report: PackageSmokeReport): string {
  const lines = [
    "# Shell analysis package smoke",
    "",
    `Generated: ${report.generatedAt} (local observation; timestamp/load/durations are non-repeatable)`,
    `Isolated config dir: ${report.isolatedRoots.configDir}`,
    `Isolated project dir: ${report.isolatedRoots.projectDir}`,
    `Isolated package dir: ${report.isolatedRoots.packageRoot}`,
    "",
    "## BashGuard package",
    `Tarball: ${report.bashguardPackage.pack.tarball} · unpacked ${report.bashguardPackage.pack.unpackedSizeBytes} bytes · pack ${report.bashguardPackage.pack.succeeded ? "succeeded" : "failed"}`,
    formatPackageSmokeEvidence("Package install", report.bashguardPackage.install),
    formatPackageSmokeEvidence("Pi process", report.bashguardPackage.piProcess),
    formatPackageSmokeEvidence("Recorder startup evidence", report.bashguardPackage.startupEvidence),
    formatPackageSmokeEvidence("Registration/config evidence", report.bashguardPackage.registrationConfig),
    formatPackageSmokeEvidence("Authorization behavior", report.bashguardPackage.authBehavior),
    "",
    "| Candidate | Dependencies | Size | Install script | Native compile | Import/init | Notes |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const candidate of sortCandidates(report.candidatePackages)) {
    lines.push(
      `| ${candidate.packageName} | ${candidate.runtimeDependencies.join(", ")} | ${candidate.unpackedSizeBytes} bytes | ${candidate.hasInstallScript ? "yes" : "no"} | ${candidate.nativeCompilation ? "yes" : "no"} | ${candidate.importInit.status} · ${candidate.importInit.evidence} | ${candidate.notes.join("; ") || "-"} |`,
    );
  }
  if (report.commands.length > 0) {
    lines.push("", "## Commands");
    for (const command of report.commands) {
      lines.push(`- ${command.command} → exit ${command.exitCode ?? "unknown"} · ${command.durationMs.toFixed(1)} ms`);
      if (command.stdout) lines.push(`  - stdout: ${command.stdout}`);
      if (command.stderr) lines.push(`  - stderr: ${command.stderr}`);
    }
  }
  const notes = report.notes ?? [];
  if (notes.length > 0) {
    lines.push("", "## Notes", ...notes.map((note) => `- ${note}`));
  }
  return `${lines.join("\n")}\n`;
}

export function formatPackageSmokeJson(report: PackageSmokeReport): string {
  return `${JSON.stringify(projectPackageSmokeReport(report), null, 2)}\n`;
}

async function packBashGuardBranch(root: string, timeoutMs: number): Promise<{ readonly tarball: string; readonly packed: PackageSmokeCommandRecord }> {
  const packed = await runCommand("npm", ["pack"], { cwd: root, timeoutMs });
  const tarball = await findTarball(root, packed.stdout, packed.stderr);
  if (!tarball) {
    const files = await readdir(root);
    throw new Error(`npm pack did not yield a tarball; files=${files.join(",")}; stdout=${normalizeText(packed.stdout)}; stderr=${normalizeText(packed.stderr)}`);
  }
  return { tarball, packed };
}

async function extractPackage(tarballPath: string, extractDir: string, timeoutMs: number): Promise<PackageSmokeCommandRecord> {
  await mkdir(extractDir, { recursive: true });
  return await runCommand("tar", ["-xzf", tarballPath, "-C", extractDir], { timeoutMs });
}

async function findTarball(root: string, stdout: string, stderr: string): Promise<string | undefined> {
  const direct = [...stdout.split(/\s+/), ...stderr.split(/\s+/)].find((token) => token.endsWith(".tgz"));
  if (direct) return direct;
  const tgzFiles = (await readdir(root)).filter((entry) => entry.endsWith(".tgz"));
  if (tgzFiles.length === 0) return undefined;
  if (tgzFiles.length === 1) return tgzFiles[0];
  const stats = await Promise.all(tgzFiles.map(async (entry) => ({ entry, stat: await stat(join(root, entry)) })));
  return stats.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0]?.entry;
}

async function inspectBashGuardPackage(root: string, timeoutMs: number, isolatedConfigDir: string, isolatedProjectDir: string, dataDir: string): Promise<BashGuardPackageSmokeSection & { readonly commands: PackageSmokeCommandRecord[]; readonly notes: string[] }> {
  const projectSnapshot = await createSentinelSnapshot(isolatedProjectDir, "project");
  const configSnapshot = await createSentinelSnapshot(isolatedConfigDir, "config");
  const dataSnapshot = await createSentinelSnapshot(dataDir, "data");
  const configEntriesBefore = new Set(await readdir(isolatedConfigDir));

  const pack = await packBashGuardBranch(root, timeoutMs);
  const commands: PackageSmokeCommandRecord[] = [pack.packed];
  const extractDir = join(isolatedProjectDir, "bashguard-extract");
  const tarballPath = join(root, pack.tarball);
  const extracted = await extractPackage(tarballPath, extractDir, timeoutMs);
  commands.push(extracted);
  const packageRoot = await resolveExtractedPackageRoot(extractDir);
  const install = await runCommand("npm", ["install", "--omit=dev"], { cwd: packageRoot, timeoutMs });
  commands.push(install);

  const piLoad = await runCommand("pi", ["--mode", "json", "--offline", "--no-extensions", "--no-skills", "--no-context-files", "--no-tools", "-e", packageRoot, "-p", "smoke"], {
    cwd: isolatedProjectDir,
    timeoutMs,
    env: {
      ...process.env,
      PI_OFFLINE: "1",
      BASHGUARD_DATA_DIR: dataDir,
      PI_CODING_AGENT_DIR: isolatedConfigDir,
    },
  });
  commands.push(piLoad);

  const piProcess: PackageSmokeProcessEvidence = {
    status: piLoad.timedOut ? "unproven" : piLoad.exitCode === 0 ? "observed" : "blocked",
    evidence: piLoad.timedOut ? "unproven" : piLoad.exitCode === 0 ? "observed" : "blocked",
    command: piLoad.command,
    exitCode: piLoad.exitCode,
    timedOut: Boolean(piLoad.timedOut),
    stdout: piLoad.stdout,
    stderr: piLoad.stderr,
    notes: piLoad.timedOut
      ? ["offline Pi session timed out; runtime auth behavior unproven"]
      : piLoad.exitCode === 0
        ? ["Pi process exited cleanly; this does not prove authorization behavior"]
        : ["Pi process exited nonzero; runtime auth behavior remains unproven"],
  };

  const startupArtifactObserved = (await readdir(dataDir)).some((entry) => entry === "session.json" || entry === "events.jsonl");
  const startupEvidence: PackageSmokeProcessEvidence = {
    status: startupArtifactObserved ? "observed" : "missing",
    evidence: startupArtifactObserved ? "observed" : "missing",
    command: "scan BASHGUARD_DATA_DIR for session.json/events.jsonl",
    exitCode: null,
    timedOut: false,
    stdout: startupArtifactObserved ? "session artifact observed in isolated BASHGUARD_DATA_DIR" : "",
    stderr: "",
    notes: startupArtifactObserved ? ["recorder extension startup artifact observed"] : ["recorder extension startup artifact not observed"],
  };

  const configEntriesAfter = await readdir(isolatedConfigDir);
  const registrationArtifactObserved = configEntriesAfter.some((entry) => !configEntriesBefore.has(entry) && entry !== basename(configSnapshot.path));
  const registrationConfig: PackageSmokeProcessEvidence = {
    status: registrationArtifactObserved ? "observed" : "unproven",
    evidence: registrationArtifactObserved ? "observed" : "unproven",
    command: "pi install -l <package-root>",
    exitCode: install.exitCode,
    timedOut: Boolean(install.timedOut),
    stdout: install.stdout,
    stderr: install.stderr,
    notes: [
      "dedicated cwd, PI_CODING_AGENT_DIR, and BASHGUARD_DATA_DIR were set",
      registrationArtifactObserved ? "registration/config evidence observed in isolated config root" : "registration/config evidence not proven",
      (await sentinelUnchanged(projectSnapshot)) && (await sentinelUnchanged(configSnapshot)) && (await sentinelUnchanged(dataSnapshot)) ? "no writes to sentinel snapshot observed" : "sentinel snapshot write observed or unverified",
    ],
  };

  const authBehavior: PackageSmokeProcessEvidence = {
    status: "unproven",
    evidence: "unproven",
    command: piLoad.command,
    exitCode: piLoad.exitCode,
    timedOut: Boolean(piLoad.timedOut),
    stdout: piLoad.stdout,
    stderr: piLoad.stderr,
    notes: [
      piLoad.timedOut ? "offline Pi session timed out; runtime auth behavior unproven" : "runtime auth behavior remains unproven from process exit or temp files alone",
      "static production-import and runtime-dependency isolation are assessed separately",
    ],
  };

  return {
    pack: {
      tarball: pack.tarball,
      unpackedSizeBytes: await sizeOf(extractDir),
      succeeded: pack.packed.exitCode === 0,
    },
    install: {
      status: install.exitCode === 0 ? "observed" : "blocked",
      evidence: install.exitCode === 0 ? "observed" : "blocked",
      command: install.command,
      exitCode: install.exitCode,
      timedOut: Boolean(install.timedOut),
      stdout: install.stdout,
      stderr: install.stderr,
      notes: install.exitCode === 0 ? ["extracted package install succeeded"] : ["extracted package install blocked"],
    },
    piProcess,
    startupEvidence,
    registrationConfig,
    authBehavior,
    commands,
    notes: [
      "dedicated cwd, PI_CODING_AGENT_DIR, and BASHGUARD_DATA_DIR were set",
      (await sentinelUnchanged(projectSnapshot)) && (await sentinelUnchanged(configSnapshot)) && (await sentinelUnchanged(dataSnapshot)) ? "no writes to sentinel snapshot observed" : "sentinel snapshot write observed or unverified",
      startupArtifactObserved ? "BashGuard startup artifact observed in isolated data dir" : "BashGuard startup artifact not observed",
      install.exitCode === 0 ? "isolated npm install syntax was exercised" : "isolated npm install syntax was blocked",
    ],
  };
}

function hashHost(value: string): string {
  return value.slice(0, 12);
}

async function mkdirTemporaryRoot(prefix: string): Promise<string> {
  return await mkdtemp(join(os.tmpdir(), `${prefix}-`));
}

export async function runPackageSmoke(options: PackageSmokeOptions = {}): Promise<PackageSmokeRunResult> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const root = await mkdirTemporaryRoot("bashguard-package-smoke");
  const projectDir = await mkdirTemporaryRoot("bashguard-package-smoke-project");
  const configDir = await mkdirTemporaryRoot("bashguard-package-smoke-config");
  const dataDir = await mkdirTemporaryRoot("bashguard-package-smoke-data");
  const commands: PackageSmokeCommandRecord[] = [];
  try {
    const candidateNative = await buildCandidate(root, "native", timeoutMs);
    const candidateWasm = await buildCandidate(root, "wasm", timeoutMs);
    const candidateNarrow = await buildCandidate(root, "narrow", timeoutMs);

    const bashguardPackage = await inspectBashGuardPackage(REPO_ROOT, timeoutMs, configDir, projectDir, dataDir);
    commands.push(...bashguardPackage.commands);

    const report: PackageSmokeReport = {
      generatedAt: new Date().toISOString(),
      isolatedRoots: {
        configDir,
        projectDir,
        packageRoot: root,
      },
      bashguardPackage: {
        pack: bashguardPackage.pack,
        install: bashguardPackage.install,
        piProcess: bashguardPackage.piProcess,
        startupEvidence: bashguardPackage.startupEvidence,
        registrationConfig: bashguardPackage.registrationConfig,
        authBehavior: bashguardPackage.authBehavior,
      },
      candidatePackages: [candidateNative, candidateWasm, candidateNarrow],
      commands: options.includeCommands ? commands : [],
      notes: [
        "Local smoke only; failures are visible and not masked.",
        "Timestamp, load, and duration values are local observations rather than guarantees.",
        "No real user settings are touched; all roots are temporary.",
      ],
    };

    const outputDir = options.outputDir ?? process.env.BASHGUARD_SHELL_ANALYSIS_OUTPUT_DIR ?? join(os.tmpdir(), "bashguard-shell-analysis", "package-smoke");
    const projected = projectPackageSmokeReport(report);
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, "package-smoke-report.md"), formatPackageSmokeMarkdown(projected), "utf8");
    await writeFile(join(outputDir, "package-smoke-report.json"), formatPackageSmokeJson(projected), "utf8");
    return { outputDir, report: projected };
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
}

function parseArgs(argv: string[]): PackageSmokeOptions {
  const options: PackageSmokeOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--output-dir") {
      const value = argv[++index];
      if (!value) throw new Error("--output-dir requires a value");
      options.outputDir = value;
      continue;
    }
    if (option === "--timeout-ms") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1) throw new Error("--timeout-ms must be a positive integer");
      options.timeoutMs = value;
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await runPackageSmoke(options);
  process.stdout.write(`${normalizeText(result.outputDir)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    process.stderr.write(`package-smoke: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
