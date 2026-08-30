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
      analyze: (fixture) => analyzeWithCurrentMatcher(fixture.command),
    },
    corpus,
    { timeoutMs: 250 },
  );

  const markdown = formatMarkdownReport(evaluation);
  const json = formatJsonReport(evaluation);
  assert.match(markdown, /Documented/);
  assert.match(markdown, /Demonstrated/);
  assert.match(json, /"adapterId": "current-matcher"/);
  assert.equal(markdown.includes("/private/tmp"), false);
  assert.equal(json.includes("/private/tmp"), false);
  assert.ok(projectReport(evaluation).fixtures.length > 0);
});

test("report formatting stays stable for fixture ordering", async () => {
  const evaluation = await evaluateCorpus(
    {
      id: "current-matcher",
      label: "Current matcher baseline",
      analyze: (fixture) => analyzeWithCurrentMatcher(fixture.command),
    },
    corpus.slice(0, 2),
    { timeoutMs: 250 },
  );
  const markdownA = formatMarkdownReport(evaluation);
  const markdownB = formatMarkdownReport(evaluation);
  assert.equal(markdownA, markdownB);
});
