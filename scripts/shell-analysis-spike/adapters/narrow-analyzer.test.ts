import assert from "node:assert/strict";
import test from "node:test";

import { shellAnalysisCorpus } from "../corpus.ts";
import { evaluateCorpus } from "../evaluate.ts";
import { analyzeWithNarrowAnalyzer } from "./narrow-analyzer.ts";

test("narrow analyzer stays deliberately bounded and records unsupported constructs", () => {
  const analysis = analyzeWithNarrowAnalyzer("printf '%s\\n' 'git reset --hard' && eval \"$cmd\"");
  assert.equal(analysis.adapterId, "narrow-analyzer");
  assert.equal(analysis.capabilities.structural, true);
  assert.ok(analysis.limitations.some((line) => line.includes("bounded scanner")));
  assert.ok(analysis.unsupportedConstructs.some((entry) => entry.kind === "eval"));
  assert.ok(analysis.structuralFacts.length > 0);
});

test("narrow analyzer keeps quotes escapes operators and git target evidence visible", () => {
  const analysis = analyzeWithNarrowAnalyzer("git -C ./repo-a -C ./repo-b status && cp ./quoted\\ path/file.txt './dst file.txt'");
  assert.ok(analysis.literalGitTargetOptions.some((option) => option.option === "-C" && option.value === "./repo-a"));
  assert.ok(analysis.literalGitTargetOptions.some((option) => option.option === "-C" && option.value === "./repo-b"));
  assert.ok(analysis.textualEvidence.some((entry) => entry.includes("git")));
  assert.ok(analysis.structuralFacts.some((fact) => fact.startsWith("redir-") || fact.startsWith("word-")));
});

test("narrow analyzer reports the corpus with explicit unsupported syntax and bounded summary", async () => {
  const corpus = shellAnalysisCorpus();
  const evaluation = await evaluateCorpus(
    {
      id: "narrow-analyzer",
      label: "Narrow shell analyzer",
      capabilities: {
        structural: true,
        checks: true,
        literalGitTargets: true,
      },
      analyze: (fixture) => analyzeWithNarrowAnalyzer(fixture.command),
    },
    corpus,
    { timeoutMs: 250 },
  );

  assert.equal(evaluation.fixtures.length, corpus.length);
  assert.ok(evaluation.summary.pass + evaluation.summary.mismatch + evaluation.summary.error + evaluation.summary.timeout === corpus.length);
  assert.ok(evaluation.fixtures.some((fixture) => (fixture.demonstrated as unknown as { readonly unsupportedConstructs?: readonly unknown[] } | undefined)?.unsupportedConstructs?.length));
  assert.ok(evaluation.fixtures.some((fixture) => fixture.notes.some((note) => note.includes("mismatched")) || fixture.outcome !== "pass"));
});
