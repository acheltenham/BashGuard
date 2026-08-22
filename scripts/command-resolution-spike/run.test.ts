import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { buildPiInvocation, createFreshTemporaryRoot, extensionOrderForScenario, parseRunnerArgs } from "./run.ts";
import { buildScenarioDefinitions } from "./model.ts";

const repositoryRoot = resolve("/tmp/bashguard-repository");
const fixtureRoot = resolve("/tmp/bashguard-spike-root");
const scenarios = buildScenarioDefinitions(fixtureRoot);

function scenario(name: string) {
  return scenarios.find((entry) => entry.name === name)!;
}

test("extensionOrderForScenario places BashGuard around mutation and before replacement execution", () => {
  assert.deepEqual(extensionOrderForScenario(scenario("simple")), ["early", "bashguard", "late"]);
  assert.deepEqual(extensionOrderForScenario(scenario("bashguard-before-mutator")), ["early", "bashguard", "mutator", "late"]);
  assert.deepEqual(extensionOrderForScenario(scenario("mutator-before-bashguard")), ["early", "mutator", "bashguard", "late"]);
  assert.deepEqual(extensionOrderForScenario(scenario("replacement-spawn-hook")), ["early", "bashguard", "late", "replacement"]);
});

test("buildPiInvocation isolates Pi and preserves extension order and exact command prompt", () => {
  const target = scenario("bashguard-before-mutator");
  process.env.BASHGUARD_REVIEW_SECRET = "must-not-leak";
  process.env.PI_CODING_AGENT_DIR = "/tmp/ambient-pi-config";
  const invocation = buildPiInvocation({
    scenario: target,
    repositoryRoot,
    fixtureRoot,
    attemptRoot: resolve(fixtureRoot, "artifacts/attempt-1"),
    model: "gpt-5.4-mini",
    timeoutMs: 90_000,
  });
  delete process.env.BASHGUARD_REVIEW_SECRET;
  delete process.env.PI_CODING_AGENT_DIR;

  assert.equal(invocation.command, "pi");
  assert.equal(invocation.cwd, fixtureRoot);
  assert.equal(invocation.timeoutMs, 90_000);
  assert.deepEqual(invocation.args.slice(0, 9), [
    "--no-extensions",
    "--no-skills",
    "--approve",
    "--provider",
    "openai-codex",
    "--model",
    "gpt-5.4-mini",
    "--thinking",
    "off",
  ]);
  assert.equal(invocation.args.filter((arg) => arg === repositoryRoot).length, 1);
  const extensionPaths = invocation.args.flatMap((arg, index) => invocation.args[index - 1] === "-e" ? [arg] : []);
  assert.deepEqual(extensionPaths, [
    resolve(repositoryRoot, "scripts/command-resolution-spike/extensions/early-observer.ts"),
    repositoryRoot,
    resolve(repositoryRoot, "scripts/command-resolution-spike/extensions/mutator.ts"),
    resolve(repositoryRoot, "scripts/command-resolution-spike/extensions/late-observer.ts"),
  ]);
  assert.match(invocation.prompt, /Use the bash tool exactly once/);
  assert.match(invocation.prompt, new RegExp(target.command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(invocation.env.BASHGUARD_DATA_DIR, resolve(fixtureRoot, "artifacts/attempt-1/bashguard-data"));
  assert.equal(invocation.env.BASHGUARD_SPIKE_PROBE_FILE, resolve(fixtureRoot, "artifacts/attempt-1/probe.jsonl"));
  assert.equal(invocation.env.BASHGUARD_REVIEW_SECRET, undefined);
  assert.equal(invocation.env.PI_CODING_AGENT_DIR, undefined);
});

test("createFreshTemporaryRoot refuses existing or non-temporary roots", async () => {
  const parent = await mkdtemp(join(tmpdir(), "bashguard-spike-parent-"));
  const fresh = join(parent, "fresh-run");

  await createFreshTemporaryRoot(fresh);
  await assert.rejects(() => createFreshTemporaryRoot(fresh), /must not already exist/);
  const commonTmpRoot = `/tmp/bashguard-spike-${process.pid}-${Date.now()}`;
  await createFreshTemporaryRoot(commonTmpRoot);
  await assert.rejects(() => createFreshTemporaryRoot(resolve("/Users/bashguard-not-temporary")), /outside temporary root/);
});

test("parseRunnerArgs applies safe defaults and validates bounded options", () => {
  assert.deepEqual(parseRunnerArgs(["--root", "/tmp/spike"]), {
    root: "/tmp/spike",
    scenario: "all",
    model: "gpt-5.4-mini",
    maxAttempts: 2,
    timeoutMs: 120_000,
  });
  assert.deepEqual(parseRunnerArgs(["--root", "/tmp/spike", "--scenario", "simple", "--model", "gpt-5.4-mini", "--max-attempts", "3", "--timeout-ms", "5000"]), {
    root: "/tmp/spike",
    scenario: "simple",
    model: "gpt-5.4-mini",
    maxAttempts: 3,
    timeoutMs: 5_000,
  });
  assert.throws(() => parseRunnerArgs([]), /--root is required/);
  assert.throws(() => parseRunnerArgs(["--root", "relative"]), /absolute/);
  assert.throws(() => parseRunnerArgs(["--root", "/tmp/spike", "--max-attempts", "0"]), /positive integer/);
  assert.throws(() => parseRunnerArgs(["--root", "/tmp/spike", "--unknown"]), /Unknown option/);
});
