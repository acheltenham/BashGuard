import assert from "node:assert/strict";
import test from "node:test";

import {
  ANALYSIS_STATUSES,
  CORPUS_ID_PATTERN,
  CORPUS_SUBSETS,
  DIAGNOSTIC_SEVERITIES,
  EVIDENCE_LEVELS,
  PROTECTED_CHECK_OUTCOMES,
  SEGMENT_KINDS,
  SEGMENT_RELATIONS,
  fixture,
  expectation,
  protectedCheck,
  segment,
  span,
  type CommandSegment,
} from "./model.ts";

test("analysis model exposes the required immutable enum sets", () => {
  assert.deepEqual(ANALYSIS_STATUSES, ["structured", "degraded", "unsupported", "failed"]);
  assert.deepEqual(EVIDENCE_LEVELS, ["observed", "reported", "inferred", "unknown"]);
  assert.deepEqual(CORPUS_SUBSETS, ["supported", "degraded", "unsupported"]);
  assert.deepEqual(PROTECTED_CHECK_OUTCOMES, ["matched", "not-matched", "unknown"]);
  assert.deepEqual(DIAGNOSTIC_SEVERITIES, ["info", "warning", "error"]);
  assert.ok(SEGMENT_KINDS.includes("wrapper"));
  assert.ok(SEGMENT_RELATIONS.includes("wraps"));
  assert.ok(CORPUS_ID_PATTERN.test("sa-001-example-fixture"));
});

test("spans and expectations remain immutable and structurally explicit", () => {
  const commandSpan = span(0, 11);
  const analysis = expectation({
    status: "structured",
    evidenceLevel: "observed",
    subset: "supported",
    segments: [segment("command", "command", "echo hello", commandSpan)],
    wrappers: [],
    redirections: [],
    unresolved: [],
    protectedChecks: [protectedCheck("git-reset-hard", "not-matched", "observed", "echo hello")],
    literalGitTargetOptions: [{ option: "-C", value: "./repo-a" }],
    diagnostics: [],
    runtimeUnknowns: ["runtime argv remains unknown"],
  });
  const corpusFixture = fixture({
    id: "sa-999-immutable-fixture",
    title: "Immutable fixture",
    family: "heredoc-inert-data",
    command: "echo hello",
    expected: analysis,
  });

  assert.equal(corpusFixture.expected.segments[0]?.span.start, 0);
  assert.equal(corpusFixture.expected.segments[0]?.span.end, 11);
  assert.equal(Object.isFrozen(corpusFixture), true);
  assert.equal(Object.isFrozen(corpusFixture.expected), true);
  assert.equal(Object.isFrozen(corpusFixture.expected.segments[0]!), true);
  const literalGitTarget = corpusFixture.expected.literalGitTargetOptions?.[0];
  assert.ok(literalGitTarget);
  assert.equal(Object.isFrozen(literalGitTarget), true);
  assert.throws(() => {
    (corpusFixture.expected.segments as CommandSegment[]).push(segment("x", "word", "x", span(0, 1))); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

test("span validation rejects reversed and non-integer offsets", () => {
  assert.throws(() => span(-1, 2), /non-negative/);
  assert.throws(() => span(3, 2), /ordered/);
  assert.throws(() => span(1.5, 2), /integers/);
});
