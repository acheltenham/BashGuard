import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { formatTreeSitterJsonReport, formatTreeSitterMarkdownReport, writeTreeSitterCandidateReport } from "./tree-sitter-report.ts";

const outputDir = join(tmpdir(), "bashguard-tree-sitter-report-test");

test("tree-sitter candidate report writes deterministic markdown and json under /tmp", async () => {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const report = await writeTreeSitterCandidateReport(outputDir);
  const markdown = await readFile(join(outputDir, "tree-sitter-candidate-report.md"), "utf8");
  const json = await readFile(join(outputDir, "tree-sitter-candidate-report.json"), "utf8");

  assert.equal(report.outputDir, outputDir);
  assert.match(markdown, /Tree-sitter shell candidate report/);
  assert.match(markdown, /Tree-sitter native/);
  assert.match(json, /"evaluations"/);
  assert.doesNotMatch(json, /"rootNode"/);
  assert.doesNotMatch(json, /"nodeType"/);
  assert.equal(formatTreeSitterMarkdownReport(report), markdown);
  assert.equal(formatTreeSitterJsonReport(report), json);
});
