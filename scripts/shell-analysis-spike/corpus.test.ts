import assert from "node:assert/strict";
import test from "node:test";

import { shellAnalysisCorpus, validateShellAnalysisCorpus } from "./corpus.ts";

const corpus = shellAnalysisCorpus();

test("shell analysis corpus covers the broad Stage A research families", () => {
  assert.equal(corpus.length >= 17, true);
  assert.deepEqual(
    new Set(corpus.map((fixture) => fixture.family)),
    new Set([
      "inert-text",
      "quotes-and-escapes",
      "operators-and-newlines",
      "groups-and-subshells",
      "assignments-and-wrappers",
      "redirects-and-heredocs",
      "git-target-collision",
      "dynamic-sink",
      "malformed-syntax",
      "long-command",
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

test("every fixture declares structural facts, protected checks, evidence level, supported subset, and runtime unknowns", () => {
  for (const fixture of corpus) {
    const expected = fixture.expected;
    assert.ok(expected.segments.length > 0, fixture.id);
    assert.ok(["structured", "degraded", "unsupported", "failed"].includes(expected.status), fixture.id);
    assert.ok(["observed", "reported", "inferred", "unknown"].includes(expected.evidenceLevel), fixture.id);
    assert.ok(["supported", "degraded", "unsupported"].includes(expected.subset), fixture.id);
    assert.ok(Array.isArray(expected.runtimeUnknowns), fixture.id);
    assert.ok(Array.isArray(expected.protectedChecks), fixture.id);
  }
});

test("corpus avoids private host paths and destructive real targets", () => {
  const text = JSON.stringify(corpus);
  assert.doesNotMatch(text, /\/Users\//);
  assert.doesNotMatch(text, /\/home\//);
  assert.doesNotMatch(text, /C:\\/);
  assert.doesNotMatch(text, /\/private\/tmp\//);
  assert.doesNotMatch(text, /rm\s+-rf\s+\/Users/);
});
