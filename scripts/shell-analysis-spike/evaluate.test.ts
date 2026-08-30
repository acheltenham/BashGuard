import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { shellAnalysisCorpus } from "./corpus.ts";
import { evaluateCorpus, sanitizeEvaluationProjection, type AnalysisAdapter } from "./evaluate.ts";
import { analyzeWithCurrentMatcher } from "./adapters/current-matcher.ts";

const corpus = shellAnalysisCorpus();

const baselineAdapter: AnalysisAdapter = {
  id: "current-matcher",
  label: "Current matcher baseline",
  analyze: (fixture) => analyzeWithCurrentMatcher(fixture.command),
};

test("generic evaluator records pass, mismatch, error, and timeout outcomes", async () => {
  const evaluation = await evaluateCorpus(baselineAdapter, corpus, { timeoutMs: 250 });
  assert.equal(evaluation.adapterId, "current-matcher");
  assert.ok(evaluation.summary.pass > 0);
  assert.ok(evaluation.summary.mismatch >= 0);
  assert.equal(evaluation.fixtures.length, corpus.length);

  const errorAdapter: AnalysisAdapter = {
    id: "error-adapter",
    label: "Error adapter",
    analyze: () => {
      throw new Error("host path /private/tmp/abc should be sanitized");
    },
  };
  const errorResult = await evaluateCorpus(errorAdapter, [corpus[0]!], { timeoutMs: 250 });
  assert.equal(errorResult.fixtures[0]?.outcome, "error");
  assert.match(errorResult.fixtures[0]?.notes.join(" ") ?? "", /<tmp-path>/);

  const timeoutAdapter: AnalysisAdapter = {
    id: "timeout-adapter",
    label: "Timeout adapter",
    analyze: () => new Promise(() => undefined),
  };
  const timeoutResult = await evaluateCorpus(timeoutAdapter, [corpus[0]!], { timeoutMs: 10 });
  assert.equal(timeoutResult.fixtures[0]?.outcome, "timeout");
});

test("evaluation projections sanitize host-specific paths and timing noise", () => {
  const projection = sanitizeEvaluationProjection({
    path: "/private/tmp/bashguard/spike/result.json",
    nested: ["/tmp/bashguard/spike/result.json", "12 ms"],
    message: "wrote /private/tmp/bashguard/spike/result.json in 12 ms",
  });
  const text = JSON.stringify(projection);
  assert.doesNotMatch(text, /\/private\/tmp\//);
  assert.doesNotMatch(text, /\/tmp\//);
  assert.doesNotMatch(text, /\b12 ms\b/);
  assert.match(text, /<tmp-path>/);
  assert.match(text, /<duration-ms>/);
});

test("production sources do not import shell-analysis-spike modules", async () => {
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const sourceRoots = [join(repoRoot, "src"), join(repoRoot, "extensions")];
  const importText: string[] = [];
  for (const root of sourceRoots) {
    let entries: string[] = [];
    try {
      entries = await readdir(root, { recursive: true }) as unknown as string[];
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".ts")) continue;
      const fullPath = join(root, entry);
      importText.push(await readFile(fullPath, "utf8"));
    }
  }
  assert.equal(importText.some((text) => text.includes("shell-analysis-spike")), false);
});
