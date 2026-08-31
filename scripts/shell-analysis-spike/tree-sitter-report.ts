import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { shellAnalysisCorpus } from "./corpus.ts";
import { createTreeSitterNativeAdapter } from "./adapters/tree-sitter-native.ts";
import { createTreeSitterWasmAdapter } from "./adapters/tree-sitter-wasm.ts";
import {
  runTreeSitterCorpus,
  sanitizeTreeSitterProjection,
  type TreeSitterCorpusEvaluation,
} from "./tree-sitter-projection.ts";

export interface TreeSitterCandidateReport {
  readonly outputDir: string;
  readonly generatedAt: string;
  readonly corpusSize: number;
  readonly evaluations: readonly TreeSitterCorpusEvaluation[];
}

function normalizeText(value: string): string {
  return value
    .replaceAll(/\/private\/tmp\/[A-Za-z0-9._/-]+/g, "<tmp-path>")
    .replaceAll(/(?:\/tmp|\/var\/tmp)\/[A-Za-z0-9._/-]+/g, "<tmp-path>")
    .replaceAll(/\b\d+(?:\.\d+)?\s*ms\b/gi, "<duration-ms>");
}

function sortEvaluations(evaluations: readonly TreeSitterCorpusEvaluation[]): readonly TreeSitterCorpusEvaluation[] {
  return [...evaluations].sort((left, right) => left.adapterId.localeCompare(right.adapterId));
}

export function formatTreeSitterMarkdownReport(report: TreeSitterCandidateReport): string {
  const lines = [
    "# Tree-sitter shell candidate report",
    "",
    `Corpus fixtures: ${report.corpusSize}`,
    `Output dir: ${normalizeText(report.outputDir)}`,
    `Generated: ${report.generatedAt}`,
  ];
  for (const evaluation of sortEvaluations(report.evaluations)) {
    lines.push(
      "",
      `## ${evaluation.adapterLabel}`,
      `Identity: ${evaluation.identity.parser}/${evaluation.identity.language} · ${evaluation.mode}`,
      `Version: adapter ${evaluation.version.adapter} · parser ${evaluation.version.parser} · language ${evaluation.version.language}`,
      `Capabilities: available ${evaluation.capabilities.available ? "yes" : "no"}, parse tree ${evaluation.capabilities.parseTree ? "yes" : "no"}, bounded ${evaluation.capabilities.boundedInput ? "yes" : "no"}`,
      `Summary: pass ${evaluation.summary.pass}, mismatch ${evaluation.summary.mismatch}, error ${evaluation.summary.error}, timeout ${evaluation.summary.timeout}`,
      "",
      "| Fixture | Expected | Actual | Status | Checks | Git targets | Outcome |",
      "|---|---|---|---|---|---|---|",
    );
    for (const fixture of evaluation.fixtures) {
      lines.push(
        `| ${fixture.fixtureId} | ${fixture.expected.status} · ${fixture.expected.evidenceLevel} · ${fixture.expected.subset} | ${fixture.analysis.status} | ${fixture.comparison.status} | ${fixture.comparison.protectedChecks} | ${fixture.comparison.literalGitTargets} | ${fixture.outcome} |`,
      );
      if (fixture.analysis.projection.parseIssues.length > 0 || fixture.analysis.projection.unresolved.length > 0) {
        lines.push(
          `|  | notes: parse ${fixture.analysis.projection.parseIssues.length}, unresolved ${fixture.analysis.projection.unresolved.length} |  |  |  |  |  |`,
        );
      }
      if (fixture.notes.length > 0) {
        lines.push(`|  | notes: ${fixture.notes.map(normalizeText).join("; ")} |  |  |  |  |  |`);
      }
    }
  }
  return lines.join("\n");
}

export function formatTreeSitterJsonReport(report: TreeSitterCandidateReport): string {
  return `${JSON.stringify(sanitizeTreeSitterProjection(report), null, 2)}\n`;
}

function parseArgs(argv: string[]): { readonly outputDir: string } {
  let outputDir = process.env.BASHGUARD_SHELL_ANALYSIS_OUTPUT_DIR ?? "/tmp/bashguard-shell-analysis/tree-sitter";
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--output-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--output-dir requires a value");
      outputDir = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${option}`);
  }
  return { outputDir };
}

export async function writeTreeSitterCandidateReport(outputDir: string): Promise<TreeSitterCandidateReport> {
  const corpus = shellAnalysisCorpus();
  const native = await createTreeSitterNativeAdapter();
  const wasm = await createTreeSitterWasmAdapter();
  const evaluations = [
    await runTreeSitterCorpus(native, corpus, { timeoutMs: 250 }),
    await runTreeSitterCorpus(wasm, corpus, { timeoutMs: 250 }),
  ];
  const report: TreeSitterCandidateReport = {
    outputDir,
    generatedAt: new Date().toISOString(),
    corpusSize: corpus.length,
    evaluations,
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(`${outputDir}/tree-sitter-candidate-report.md`, formatTreeSitterMarkdownReport(report), "utf8");
  await writeFile(`${outputDir}/tree-sitter-candidate-report.json`, formatTreeSitterJsonReport(report), "utf8");
  return report;
}

async function main(): Promise<void> {
  const { outputDir } = parseArgs(process.argv.slice(2));
  const report = await writeTreeSitterCandidateReport(outputDir);
  process.stdout.write(`${normalizeText(report.outputDir)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    process.stderr.write(`tree-sitter-report: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
