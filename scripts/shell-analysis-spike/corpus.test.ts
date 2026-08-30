import assert from "node:assert/strict";
import test from "node:test";

import { shellAnalysisCorpus, validateShellAnalysisCorpus } from "./corpus.ts";
import { diagnostic, expectation, fixture, protectedCheck, segment, span } from "./model.ts";

const corpus = shellAnalysisCorpus();

test("shell analysis corpus covers the broad Stage A research families", () => {
  assert.equal(corpus.length > 25, true);
  assert.deepEqual(
    new Set(corpus.map((fixture) => fixture.family)),
    new Set([
      "background-and-or",
      "pipe-both",
      "comments-printf",
      "heredoc-inert-data",
      "escaped-quoted-paths",
      "git-sequential-targeting",
      "git-missing-conflicting-options",
      "path-operation-collision",
      "option-character-collision",
      "alias-function",
      "source-dot",
      "bash-sh-c",
      "python-node-c",
      "xargs-variants",
      "find-exec",
      "process-substitution",
      "parameter-expansion",
      "eval",
      "malformed-recovery",
      "long-bounded",
      "command-resolution-shape",
      "protected-check",
    ]),
  );
});

test("corpus ids are sanitized, unique, and stable", () => {
  validateShellAnalysisCorpus(corpus);
  assert.equal(new Set(corpus.map((fixture) => fixture.id)).size, corpus.length);
  for (const fixture of corpus) {
    assert.match(fixture.id, /^sa-[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(fixture.title.length > 0);
    assert.ok(fixture.command.length > 0);
  }
});

test("every fixture declares structural facts, protected checks, literal git targets, evidence level, supported subset, and runtime unknowns", () => {
  for (const fixture of corpus) {
    const expected = fixture.expected;
    assert.ok(expected.segments.length > 0, fixture.id);
    assert.ok(["structured", "degraded", "unsupported", "failed"].includes(expected.status), fixture.id);
    assert.ok(["observed", "reported", "inferred", "unknown"].includes(expected.evidenceLevel), fixture.id);
    assert.ok(["supported", "degraded", "unsupported"].includes(expected.subset), fixture.id);
    assert.ok(Array.isArray(expected.runtimeUnknowns), fixture.id);
    assert.ok(Array.isArray(expected.protectedChecks), fixture.id);
    assert.ok(Array.isArray(expected.literalGitTargetOptions ?? []), fixture.id);
  }
});

test("corpus avoids private host paths and destructive real targets", () => {
  const text = JSON.stringify(corpus);
  assert.doesNotMatch(text, /\/Users\//);
  assert.doesNotMatch(text, /\/home\//);
  assert.doesNotMatch(text, /C:\\\\/);
  assert.doesNotMatch(text, /\/private\/tmp\//);
  assert.doesNotMatch(text, /rm\s+-rf\s+\/Users/);
});

test("corpus validation rejects out-of-bounds spans, empty runtime unknowns, and invalid diagnostics", () => {
  assert.throws(
    () =>
      validateShellAnalysisCorpus([
        fixture({
          id: "sa-mutated-span",
          title: "mutated span",
          family: "protected-check",
          command: "echo safe",
          expected: expectation({
            status: "structured",
            evidenceLevel: "observed",
            subset: "supported",
            segments: [segment("command", "command", "echo safe", span(0, 9))],
            wrappers: [],
            redirections: [],
            unresolved: [],
            protectedChecks: [protectedCheck("recursive-forced-deletion", "matched", "observed", "rm -rf target")],
            diagnostics: [],
            runtimeUnknowns: ["runtime identity depends on shell execution"],
          }),
        }),
      ].map((entry) => ({
        ...entry,
        expected: { ...entry.expected, segments: [{ ...entry.expected.segments[0]!, span: { start: 0, end: 99 } }] },
      }))),
    /span is out of bounds/,
  );

  assert.throws(
    () =>
      validateShellAnalysisCorpus([
        fixture({
          id: "sa-mutated-runtime-unknown",
          title: "mutated runtime unknown",
          family: "protected-check",
          command: "echo safe",
          expected: expectation({
            status: "structured",
            evidenceLevel: "observed",
            subset: "supported",
            segments: [segment("command", "command", "echo safe", span(0, 9))],
            wrappers: [],
            redirections: [],
            unresolved: [],
            protectedChecks: [protectedCheck("recursive-forced-deletion", "matched", "observed", "rm -rf target")],
            diagnostics: [],
            runtimeUnknowns: [""],
          }),
        }),
      ]),
    /empty runtime unknown description/,
  );

  assert.throws(
    () =>
      validateShellAnalysisCorpus([
        fixture({
          id: "sa-mutated-diagnostic",
          title: "mutated diagnostic",
          family: "protected-check",
          command: "echo safe",
          expected: expectation({
            status: "structured",
            evidenceLevel: "observed",
            subset: "supported",
            segments: [segment("command", "command", "echo safe", span(0, 9))],
            wrappers: [],
            redirections: [],
            unresolved: [],
            protectedChecks: [protectedCheck("recursive-forced-deletion", "matched", "observed", "rm -rf target")],
            diagnostics: [diagnostic("bad code", "warning", "", span(0, 4))],
            runtimeUnknowns: ["runtime identity depends on shell execution"],
          }),
        }),
      ]),
    /invalid diagnostic code/,
  );
});
