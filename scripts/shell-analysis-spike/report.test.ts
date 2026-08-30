import assert from "node:assert/strict";
import test from "node:test";

import { shellAnalysisCorpus } from "./corpus.ts";
import { evaluateCorpus } from "./evaluate.ts";
import { analyzeWithCurrentMatcher } from "./adapters/current-matcher.ts";
import { formatJsonReport, formatMarkdownReport, projectReport } from "./report.ts";

const corpus = shellAnalysisCorpus();

test("report projections are deterministic and distinguish documented from demonstrated evidence", async () => {
  const evaluation = await evaluateCorpus(
    {
      id: "current-matcher",
      label: "Current matcher baseline",
      capabilities: {
        structural: false,
        checks: true,
        literalGitTargets: true,
      },
      analyze: (fixture) => analyzeWithCurrentMatcher(fixture.command),
    },
    corpus,
    { timeoutMs: 250 },
  );

  const markdown = formatMarkdownReport(evaluation);
  const json = formatJsonReport(evaluation);
  assert.match(markdown, /Structural/);
  assert.match(markdown, /not-applicable/);
  assert.match(json, /"adapterId": "current-matcher"/);
  assert.equal(markdown.includes("/private/tmp"), false);
  assert.equal(json.includes("/private/tmp"), false);
  assert.ok(projectReport(evaluation).fixtures.length > 0);
});

test("report formatting stays stable for reversed fixture ordering", async () => {
  const evaluationA = await evaluateCorpus(
    {
      id: "current-matcher",
      label: "Current matcher baseline",
      capabilities: {
        structural: false,
        checks: true,
        literalGitTargets: true,
      },
      analyze: (fixture) => analyzeWithCurrentMatcher(fixture.command),
    },
    corpus,
    { timeoutMs: 250 },
  );
  const evaluationB = await evaluateCorpus(
    {
      id: "current-matcher",
      label: "Current matcher baseline",
      capabilities: {
        structural: false,
        checks: true,
        literalGitTargets: true,
      },
      analyze: (fixture) => analyzeWithCurrentMatcher(fixture.command),
    },
    [...corpus].reverse(),
    { timeoutMs: 250 },
  );
  assert.equal(formatMarkdownReport(evaluationA), formatMarkdownReport(evaluationB));
  assert.equal(formatJsonReport(evaluationA), formatJsonReport(evaluationB));
});
