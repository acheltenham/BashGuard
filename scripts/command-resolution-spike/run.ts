#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeScenario, formatSanitizedMatrix, type ScenarioAnalysis } from "./analyze.ts";
import { parseBashGuardJsonl, parseProbeJsonl, type BashGuardSpikeEvent } from "./evidence.ts";
import { assertPathWithinRoot, buildScenarioDefinitions, type SpikeScenario } from "./model.ts";

export type RunnerOptions = {
  root: string;
  scenario: string;
  model: string;
  maxAttempts: number;
  timeoutMs: number;
};

export type PiInvocation = {
  command: "pi";
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  prompt: string;
};

export type BuildInvocationInput = {
  scenario: SpikeScenario;
  repositoryRoot: string;
  fixtureRoot: string;
  attemptRoot: string;
  model: string;
  timeoutMs: number;
};

const SAFE_ENV_KEYS = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "XDG_CONFIG_HOME"] as const;

const EXTENSION_FILES: Record<string, string> = {
  early: "early-observer.ts",
  late: "late-observer.ts",
  mutator: "mutator.ts",
  replacement: "replacement-bash.ts",
};

export function extensionOrderForScenario(scenario: SpikeScenario): string[] {
  if (scenario.name === "bashguard-before-mutator") return ["early", "bashguard", "mutator", "late"];
  if (scenario.name === "mutator-before-bashguard") return ["early", "mutator", "bashguard", "late"];
  if (scenario.name === "replacement-spawn-hook") return ["early", "bashguard", "late", "replacement"];
  return ["early", "bashguard", "late"];
}

export function buildPiInvocation(input: BuildInvocationInput): PiInvocation {
  assertPathWithinRoot(input.fixtureRoot, input.attemptRoot);
  const order = extensionOrderForScenario(input.scenario);
  const dataDir = join(input.attemptRoot, "bashguard-data");
  const probeFile = join(input.attemptRoot, "probe.jsonl");
  const extensionDir = join(input.repositoryRoot, "scripts", "command-resolution-spike", "extensions");
  const extensionArgs: string[] = [];
  for (const name of order) {
    const source = name === "bashguard" ? input.repositoryRoot : join(extensionDir, EXTENSION_FILES[name]!);
    extensionArgs.push("-e", source);
  }
  const prompt = [
    "Use the bash tool exactly once.",
    "Run exactly this command byte-for-byte, with no prefix, suffix, quoting changes, or alternative:",
    "",
    input.scenario.command,
    "",
    "After it completes, reply briefly. Do not call any other tool.",
  ].join("\n");
  const args = [
    "--no-extensions",
    "--no-skills",
    "--approve",
    "--provider", "openai-codex",
    "--model", input.model,
    "--thinking", "off",
    "--tools", "bash",
    "--no-context-files",
    "--name", `command-resolution-${input.scenario.name}`,
    ...extensionArgs,
    "-p",
    prompt,
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, {
    BASHGUARD_DATA_DIR: dataDir,
    BASHGUARD_SPIKE_ROOT: input.fixtureRoot,
    BASHGUARD_SPIKE_PROBE_FILE: probeFile,
    BASHGUARD_SPIKE_RUN_ID: basename(input.attemptRoot),
    BASHGUARD_SPIKE_SCENARIO: input.scenario.name,
    BASHGUARD_SPIKE_EXTENSION_ORDER: JSON.stringify(order),
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
  });
  return {
    command: "pi",
    args,
    cwd: input.scenario.cwd,
    env,
    timeoutMs: input.timeoutMs,
    prompt,
  };
}

function positiveInteger(value: string | undefined, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${option} must be a positive integer`);
  return parsed;
}

export function parseRunnerArgs(argv: string[]): RunnerOptions {
  let root: string | undefined;
  let scenario = "all";
  let model = "gpt-5.4-mini";
  let maxAttempts = 2;
  let timeoutMs = 120_000;
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    const value = argv[index + 1];
    if (option === "--root") {
      if (!value) throw new Error("--root requires a value");
      root = value;
      index++;
    } else if (option === "--scenario") {
      if (!value) throw new Error("--scenario requires a value");
      scenario = value;
      index++;
    } else if (option === "--model") {
      if (!value) throw new Error("--model requires a value");
      model = value;
      index++;
    } else if (option === "--max-attempts") {
      maxAttempts = positiveInteger(value, "--max-attempts");
      index++;
    } else if (option === "--timeout-ms") {
      timeoutMs = positiveInteger(value, "--timeout-ms");
      index++;
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }
  if (!root) throw new Error("--root is required");
  if (!isAbsolute(root)) throw new Error("--root must be absolute");
  return { root, scenario, model, maxAttempts, timeoutMs };
}

export async function createFreshTemporaryRoot(root: string): Promise<void> {
  const temporaryParents = process.platform === "win32" ? [tmpdir()] : [tmpdir(), "/tmp"];
  const allowed = temporaryParents.some((parent) => {
    try {
      assertPathWithinRoot(parent, root);
      return true;
    } catch {
      return false;
    }
  });
  if (!allowed) throw new Error(`path is outside temporary root: ${root}`);
  try {
    await mkdir(root, { recursive: false, mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`command resolution root must not already exist: ${root}`);
    throw error;
  }
}

async function prepareFixtures(root: string, repositoryRoot: string): Promise<void> {
  await mkdir(join(root, "nested"), { recursive: true });
  await mkdir(join(root, "delete-target"), { recursive: true });
  await writeFile(join(root, "delete-target", "sentinel.txt"), "safe disposable fixture\n", { mode: 0o600 });
  await writeFile(join(root, "spike-env.sh"), "export BASHGUARD_SPIKE_LOADED=loaded-value\n", { mode: 0o600 });
  const sourceFixture = join(repositoryRoot, "scripts", "command-resolution-spike", "fixtures", "runtime-fixture.mjs");
  const targetFixture = join(root, "runtime-fixture.mjs");
  await copyFile(sourceFixture, targetFixture);
  await chmod(targetFixture, 0o700);
}

async function readIfPresent(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function readBashGuardEvents(dataDir: string): Promise<{ events: BashGuardSpikeEvent[]; diagnostics: string[] }> {
  let entries: string[];
  try {
    entries = await readdir(dataDir);
  } catch {
    return { events: [], diagnostics: ["BashGuard data directory was not created"] };
  }
  const sessionDirectories: string[] = [];
  for (const entry of entries) {
    const path = join(dataDir, entry);
    try {
      if ((await stat(path)).isDirectory()) sessionDirectories.push(path);
    } catch {
      // A concurrent disappearance is visible as missing evidence below.
    }
  }
  if (sessionDirectories.length !== 1) return { events: [], diagnostics: [`expected one BashGuard session directory, found ${sessionDirectories.length}`] };
  return parseBashGuardJsonl(await readIfPresent(join(sessionDirectories[0]!, "events.jsonl")));
}

async function runAttempt(input: BuildInvocationInput): Promise<ScenarioAnalysis> {
  await mkdir(input.attemptRoot, { recursive: true, mode: 0o700 });
  if (input.scenario.name === "harmless-rm") {
    await mkdir(join(input.fixtureRoot, "delete-target"), { recursive: true });
    await writeFile(join(input.fixtureRoot, "delete-target", "sentinel.txt"), "safe disposable fixture\n", { mode: 0o600 });
  }
  const invocation = buildPiInvocation(input);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    encoding: "utf8",
    timeout: invocation.timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  await writeFile(join(input.attemptRoot, "pi.stdout"), result.stdout ?? "", { mode: 0o600 });
  await writeFile(join(input.attemptRoot, "pi.stderr"), result.stderr ?? "", { mode: 0o600 });
  const diagnostics: string[] = [];
  if (result.error) diagnostics.push(`Pi process error: ${result.error.message}`);
  if (result.status !== 0) diagnostics.push(`Pi exited with status ${String(result.status)}${result.signal ? ` (${result.signal})` : ""}`);

  const probeText = await readIfPresent(join(input.attemptRoot, "probe.jsonl"));
  const probe = parseProbeJsonl(probeText);
  if (!probeText) diagnostics.push("probe JSONL was not created");
  const bashguard = await readBashGuardEvents(join(input.attemptRoot, "bashguard-data"));
  return analyzeScenario({
    scenario: input.scenario,
    fixtureRoot: input.fixtureRoot,
    probeRecords: probe.records,
    bashguardEvents: bashguard.events,
    diagnostics: [...diagnostics, ...probe.diagnostics, ...bashguard.diagnostics],
  });
}

async function runScenario(input: Omit<BuildInvocationInput, "attemptRoot"> & { artifactsRoot: string; maxAttempts: number }): Promise<ScenarioAnalysis> {
  let latest: ScenarioAnalysis | undefined;
  for (let attempt = 1; attempt <= input.maxAttempts; attempt++) {
    const attemptRoot = join(input.artifactsRoot, input.scenario.name, `attempt-${attempt}`);
    latest = await runAttempt({ ...input, attemptRoot });
    if (latest.status === "passed" || latest.status === "failed") return latest;
  }
  return latest!;
}

export async function runSpike(options: RunnerOptions): Promise<ScenarioAnalysis[]> {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const fixtureRoot = resolve(options.root);
  const artifactsRoot = join(fixtureRoot, "artifacts");
  await createFreshTemporaryRoot(fixtureRoot);
  await prepareFixtures(fixtureRoot, repositoryRoot);
  const all = buildScenarioDefinitions(fixtureRoot);
  const selected = options.scenario === "all" ? all : all.filter((scenario) => scenario.name === options.scenario);
  if (selected.length === 0) throw new Error(`Unknown scenario: ${options.scenario}`);
  const results: ScenarioAnalysis[] = [];
  for (const scenario of selected) {
    process.stderr.write(`[command-resolution] running ${scenario.name}\n`);
    const result = await runScenario({
      scenario,
      repositoryRoot,
      fixtureRoot,
      artifactsRoot,
      model: options.model,
      timeoutMs: options.timeoutMs,
      maxAttempts: options.maxAttempts,
    });
    results.push(result);
    if (result.status !== "passed") {
      process.stderr.write(`[command-resolution] ${scenario.name}: ${result.status}: ${result.diagnostics.join("; ")}\n`);
    }
  }
  const matrix = formatSanitizedMatrix(results);
  await writeFile(join(fixtureRoot, "sanitized-matrix.md"), `${matrix}\n`, { mode: 0o600 });
  process.stdout.write(`${matrix}\n`);
  return results;
}

async function main(): Promise<void> {
  try {
    const results = await runSpike(parseRunnerArgs(process.argv.slice(2)));
    if (results.some((result) => result.status !== "passed")) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`command-resolution-spike: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
