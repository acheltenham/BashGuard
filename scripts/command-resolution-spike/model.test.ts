import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { assertPathWithinRoot, buildScenarioDefinitions } from "./model.ts";

test("buildScenarioDefinitions covers the required command and ordering matrix", () => {
  const root = resolve("/tmp/bashguard command resolution");
  const scenarios = buildScenarioDefinitions(root);

  assert.deepEqual(scenarios.map((scenario) => scenario.name), [
    "simple",
    "pipeline",
    "chain",
    "prefix-env",
    "environment-load",
    "relative-path",
    "directory-change",
    "harmless-rm",
    "bashguard-before-mutator",
    "mutator-before-bashguard",
    "replacement-spawn-hook",
  ]);
  assert.equal(new Set(scenarios.map((scenario) => scenario.token)).size, scenarios.length);
  for (const scenario of scenarios) {
    assert.match(scenario.command, new RegExp(scenario.token));
    assert.doesNotThrow(() => assertPathWithinRoot(root, scenario.cwd));
  }

  assert.equal(scenarios.find((scenario) => scenario.name === "pipeline")?.expectedRuntimeRecords, 1);
  assert.equal(scenarios.find((scenario) => scenario.name === "chain")?.expectedRuntimeRecords, 2);
  assert.equal(scenarios.find((scenario) => scenario.name === "bashguard-before-mutator")?.expectedMutation, true);
  assert.equal(scenarios.find((scenario) => scenario.name === "mutator-before-bashguard")?.expectedMutation, true);
  assert.equal(scenarios.find((scenario) => scenario.name === "replacement-spawn-hook")?.expectedSpawnWrap, true);
  assert.match(scenarios.find((scenario) => scenario.name === "harmless-rm")?.command ?? "", /delete-target/);
});

test("scenario roots reject unsafe control characters and escaped paths", () => {
  assert.throws(() => buildScenarioDefinitions("/tmp/bad\nroot"), /control characters/);
  assert.throws(() => buildScenarioDefinitions("/tmp/bad\0root"), /control characters/);
  assert.throws(() => buildScenarioDefinitions("relative/root"), /absolute/);
  assert.throws(() => assertPathWithinRoot("/tmp/safe", "/tmp/outside"), /outside temporary root/);
  assert.doesNotThrow(() => assertPathWithinRoot("/tmp/safe", "/tmp/safe/nested/file"));
});
