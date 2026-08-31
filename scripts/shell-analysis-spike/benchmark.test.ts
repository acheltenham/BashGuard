import assert from "node:assert/strict";
import test from "node:test";

import { formatBenchmarkJson, formatBenchmarkMarkdown, projectBenchmarkReport, type BenchmarkReport } from "./benchmark.ts";

const report: BenchmarkReport = {
  generatedAt: "2026-08-28T12:00:00.000Z",
  host: {
    fingerprint: "host-12345678",
    platform: "darwin",
    arch: "arm64",
    release: "25.0.0",
    loadAverage: [1.25, 0.75, 0.5],
    totalMemoryBytes: 34_359_738_368,
  },
  toolVersions: {
    node: "v22.0.0",
    npm: "10.9.0",
    pi: "0.84.0",
    git: "2.45.0",
    dcg: undefined,
  },
  corpusSize: 30,
  fixtures: {
    safe: ["sa-026-protected-quoted-inert"],
    error: ["sa-020-malformed-recovery"],
    representative: ["sa-001-background-and-or"],
  },
  adapters: [
    {
      adapterId: "current-matcher",
      adapterLabel: "Current matcher baseline",
      kind: "baseline",
      coldInitMs: 0.22,
      warmupIterations: 1,
      iterations: 5,
      safe: { count: 5, p50Ms: 0.12, p95Ms: 0.28, minMs: 0.09, maxMs: 0.35 },
      error: { count: 5, p50Ms: 0.31, p95Ms: 0.61, minMs: 0.21, maxMs: 0.88 },
      externalCostMs: undefined,
      dependencyMetrics: [
        {
          packageName: "string-width",
          unpackedSizeBytes: 12_345,
          hasInstallScript: false,
          nativeCompilation: false,
          memoryDeltaBytes: 64_000,
          notes: [],
        },
      ],
      notes: ["local observation only"],
    },
  ],
  commandLog: [
    {
      command: "node --experimental-strip-types scripts/shell-analysis-spike/benchmark.ts --output-dir <tmp-path>",
      exitCode: 0,
      stdout: "wrote benchmark report",
      stderr: "",
      durationMs: 42.4,
      notes: [],
    },
  ],
};

test("benchmark report projection stays sanitized and preserves p50/p95 evidence", () => {
  const projected = projectBenchmarkReport(report);
  const markdown = formatBenchmarkMarkdown(projected);
  const json = formatBenchmarkJson(projected);

  assert.match(markdown, /Current matcher baseline/);
  assert.match(markdown, /safe p50/);
  assert.match(markdown, /error p95/);
  assert.match(markdown, /external cost/);
  assert.match(markdown, /string-width/);
  assert.match(json, /"fingerprint": "host-12345678"/);
  assert.equal(markdown.includes("/private/tmp"), false);
  assert.equal(json.includes("/private/tmp"), false);
  assert.equal(markdown.includes("/Users/"), false);
});

test("benchmark projection keeps adapter ordering stable", () => {
  const projected = projectBenchmarkReport({ ...report, adapters: [...report.adapters].reverse() });
  assert.equal(formatBenchmarkMarkdown(projectBenchmarkReport(report)), formatBenchmarkMarkdown(projected));
  assert.equal(formatBenchmarkJson(projectBenchmarkReport(report)), formatBenchmarkJson(projected));
});
