import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";

import { dcgFixtureProtocol } from "../dcg-fixture.ts";
import {
  createDcgProcessAdapter,
  parseJson,
  parsePayload,
  probeDcgBinary,
  runDcgCommand,
} from "./dcg-process.ts";

const fixtures = dcgFixtureProtocol();
const missingBinary = "/tmp/bashguard-definitely-missing-dcg-binary";
const defaultBinary = process.env.BASHGUARD_DCG_BIN ?? process.env.DCG_BIN ?? "dcg";
const defaultBinaryAvailability = await probeDcgBinary(defaultBinary, 250);

async function makeMockDcgBinary(script: string): Promise<string> {
  const directory = join(os.tmpdir(), `bashguard-dcg-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(directory, { recursive: true });
  const binary = join(directory, "dcg");
  await writeFile(binary, `#!/usr/bin/env node\n${script}\n`);
  await chmod(binary, 0o755);
  return binary;
}

test("dcg process parser normalizes robot, classify, and explain shapes from source-shaped JSON", () => {
  const robot = parsePayload(
    parseJson(
      JSON.stringify({
        schema_version: 1,
        dcg_version: "0.9.4",
        robot_mode: true,
        command: "git reset --hard",
        decision: "deny",
        rule_id: "core.git:reset-hard",
        pack_id: "core.git",
        pattern_name: "reset-hard",
        reason: "BLOCKED by dcg",
        matched_span: [0, 16],
      }),
    ),
  );

  const classify = parsePayload(
    parseJson(
      JSON.stringify({
        schema_version: 1,
        dcg_version: "0.9.4",
        command: "git status",
        decision: "allow",
        risk_level: "safe",
        risk_score: 0,
        reasons: [],
        suggestions: [],
      }),
    ),
  );

  const explain = parsePayload(
    parseJson(
      JSON.stringify({
        schema_version: 1,
        dcg_version: "0.9.4",
        command: "git reset --hard",
        decision: "deny",
        rule_id: "core.git:reset-hard",
        trace: [{ step: "keyword", matched: true }],
      }),
    ),
  );

  assert.equal(robot.decision, "deny");
  assert.equal(robot.ruleId, "core.git:reset-hard");
  assert.deepEqual(robot.matchedSpan, [0, 16]);
  assert.equal(classify.decision, "allow");
  assert.equal(classify.riskLevel, "safe");
  assert.equal(classify.riskScore, 0);
  assert.equal(explain.decision, "deny");
  assert.equal(explain.ruleId, "core.git:reset-hard");
  assert.equal(explain.traceCount, 1);
});

test("dcg process adapter is visibly unavailable when the binary is missing", async () => {
  const adapter = await createDcgProcessAdapter({ binary: missingBinary, timeoutMs: 250 });
  const analysis = await adapter.analyze("git status");

  assert.equal(adapter.availability, "unavailable");
  assert.equal(adapter.capabilities.available, false);
  assert.equal(analysis.status, "unsupported");
  assert.equal(analysis.availability, "unavailable");
  assert.equal(analysis.repositoryVerification, "not-claimed");
  assert.ok(analysis.limitations.some((line) => line.includes("unavailable") || line.includes("missing")));
  assert.equal(analysis.literalGitTargetOptions.length, 0);
});

test("dcg process adapter keeps repository verification out of the evidence model", async () => {
  const adapter = await createDcgProcessAdapter({ binary: missingBinary });
  const analysis = await adapter.analyze("git -C ./repo-a status");

  assert.equal(analysis.repositoryVerification, "not-claimed");
  assert.ok(analysis.textualEvidence.some((line) => line.includes("dcg")));
  assert.equal(analysis.literalGitTargetOptions.length, 0);
  assert.ok(analysis.limitations.some((line) => line.includes("not claim Git repository verification")));
});

test("dcg process adapter distinguishes timeout and caller abort, and removes abort listeners", async () => {
  const binary = await makeMockDcgBinary(`
process.stdout.write(JSON.stringify({ decision: "allow" }) + "\\n");
setTimeout(() => {}, 10_000);
`);
  const controller = new AbortController();
  const before = getEventListeners(controller.signal, "abort").length;
  const command = runDcgCommand(binary, ["classify", "--format", "json", "git status"], { timeoutMs: 50, signal: controller.signal });
  queueMicrotask(() => controller.abort());
  const result = await command;
  const after = getEventListeners(controller.signal, "abort").length;

  assert.equal(before, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.aborted, true);
  assert.equal(result.abortReason, "caller");
  assert.equal(after, 0);
});

test("dcg optional integration test skips visibly when the binary is unavailable", { skip: !defaultBinaryAvailability.available }, async () => {
  const adapter = await createDcgProcessAdapter({ binary: defaultBinary, timeoutMs: 500 });
  assert.equal(adapter.availability, "available");
  const robotFixture = fixtures.find((fixture) => fixture.expectation.surface === "robot-test");
  const classifyFixture = fixtures.find((fixture) => fixture.expectation.surface === "classify");
  assert.ok(robotFixture);
  assert.ok(classifyFixture);
  const analysis = await adapter.analyze(`git -C /private/tmp/bashguard-dcg-fixture status && echo ${robotFixture.command}`);

  assert.ok(["structured", "degraded"].includes(analysis.status));
  assert.equal(analysis.repositoryVerification, "not-claimed");
  assert.ok(analysis.surfaceObservations.length >= 2);
  assert.ok(analysis.surfaceObservations.some((observation) => observation.surface === "robot-test"));
  assert.ok(analysis.surfaceObservations.some((observation) => observation.surface === "classify"));
  assert.equal(analysis.surfaceObservations.every((observation) => !observation.stdout.includes("/private/tmp/") && !observation.stdout.includes("/tmp/")), true);
  assert.ok(analysis.textualEvidence.length > 0);
});

test("dcg process adapter reports a bounded timeout distinctly from caller cancellation", async () => {
  const binary = await makeMockDcgBinary(`
setTimeout(() => {}, 10_000);
`);
  const result = await runDcgCommand(binary, ["--version"], { timeoutMs: 25 });

  assert.equal(result.timedOut, true);
  assert.equal(result.aborted, true);
  assert.equal(result.abortReason, "timeout");
});
