import assert from "node:assert/strict";
import test from "node:test";

import {
  matchesForcedGitClean,
  matchesGitResetHard,
  matchesRecursiveForcedDeletion,
} from "../../../src/command-risk.ts";

import { shellAnalysisCorpus } from "../corpus.ts";
import { analyzeWithCurrentMatcher } from "./current-matcher.ts";

test("current matcher adapter reuses the production exports instead of duplicating logic", () => {
  const cases = [
    ["rm -rf ./target", ["recursive-forced-deletion"]],
    ["git -C ./repo-a reset --hard HEAD~1", ["git-reset-hard"]],
    ["git --git-dir=.git --work-tree=./repo-a clean -fd", ["git-clean-forced"]],
    ["echo 'git reset --hard'", ["git-reset-hard"]],
  ] as const;

  for (const [command, expected] of cases) {
    const analysis = analyzeWithCurrentMatcher(command);
    const matcherChecks = [
      matchesRecursiveForcedDeletion(command) ? "recursive-forced-deletion" : undefined,
      matchesGitResetHard(command) ? "git-reset-hard" : undefined,
      matchesForcedGitClean(command) ? "git-clean-forced" : undefined,
    ].filter(Boolean);
    assert.deepEqual(analysis.protectedChecks.map((check) => check.checkId), expected, command);
    assert.deepEqual(analysis.protectedChecks.map((check) => check.checkId), matcherChecks, command);
  }
});

test("current matcher adapter emits only textual evidence and known limitations", () => {
  const analysis = analyzeWithCurrentMatcher("git -C ./repo-a reset --hard HEAD~1");
  assert.ok(analysis.textualEvidence.every((line) => !line.includes("segment")));
  assert.ok(analysis.limitations.some((line) => line.includes("text-only matcher")));
  assert.ok(analysis.literalGitTargetOptions.length > 0);
});

test("current matcher adapter can analyze the whole corpus without structural synthesis", () => {
  for (const fixture of shellAnalysisCorpus()) {
    const analysis = analyzeWithCurrentMatcher(fixture.command);
    assert.equal(analysis.adapterId, "current-matcher");
    assert.ok(["structured", "degraded"].includes(analysis.status));
    assert.ok(Array.isArray(analysis.textualEvidence));
    assert.ok(Array.isArray(analysis.protectedChecks));
    assert.ok(Array.isArray(analysis.limitations));
  }
});
