import { fileURLToPath } from "node:url";

import {
  type CorpusEvaluation,
  sanitizeEvaluationProjection,
  evaluateCorpus,
} from "./evaluate.ts";
import { shellAnalysisCorpus } from "./corpus.ts";
import { analyzeWithCurrentMatcher } from "./adapters/current-matcher.ts";

export interface ReportProjection {
  readonly adapterId: string;
  readonly adapterLabel: string;
  readonly summary: CorpusEvaluation["summary"];
  readonly fixtures: readonly {
    readonly fixtureId: string;
    readonly outcome: string;
    readonly documented: {
      readonly status: string;
      readonly evidenceLevel: string;
      readonly subset: string;
      readonly protectedChecks: readonly { readonly checkId: string; readonly outcome: string }[];
      readonly runtimeUnknowns: readonly string[];
    };
    readonly demonstrated?: {
      readonly status: string;
      readonly protectedChecks: readonly { readonly checkId: string; readonly outcome: string }[];
      readonly textualEvidence: readonly string[];
      readonly limitations: readonly string[];
    };
    readonly notes: readonly string[];
  }[];
}

export function projectReport(evaluation: CorpusEvaluation): ReportProjection {
  return sanitizeEvaluationProjection({
    adapterId: evaluation.adapterId,
    adapterLabel: evaluation.adapterLabel,
    summary: evaluation.summary,
    fixtures: evaluation.fixtures.map((fixture) => ({
      fixtureId: fixture.fixtureId,
      outcome: fixture.outcome,
      documented: {
        status: fixture.documented.status,
        evidenceLevel: fixture.documented.evidenceLevel,
        subset: fixture.documented.subset,
        protectedChecks: fixture.documented.protectedChecks.map((check) => ({ checkId: check.checkId, outcome: check.outcome })),
        runtimeUnknowns: fixture.documented.runtimeUnknowns,
      },
      demonstrated: fixture.demonstrated
        ? {
            status: fixture.demonstrated.status,
            protectedChecks: fixture.demonstrated.protectedChecks.map((check) => ({ checkId: check.checkId, outcome: check.outcome })),
            textualEvidence: fixture.demonstrated.textualEvidence,
            limitations: fixture.demonstrated.limitations,
          }
        : undefined,
      notes: fixture.notes,
    })),
  });
}

export function formatMarkdownReport(evaluation: CorpusEvaluation): string {
  const report = projectReport(evaluation);
  const lines = [
    `# Shell analysis baseline report`,
    "",
    `Adapter: **${report.adapterLabel}** (${report.adapterId})`,
    `Summary: pass ${report.summary.pass}, mismatch ${report.summary.mismatch}, error ${report.summary.error}, timeout ${report.summary.timeout}`,
    "",
    "| Fixture | Documented | Demonstrated | Outcome |",
    "|---|---|---|---|",
  ];
  for (const fixture of report.fixtures) {
    const documented = `${fixture.documented.status} · ${fixture.documented.evidenceLevel} · ${fixture.documented.subset}`;
    const demonstrated = fixture.demonstrated
      ? `${fixture.demonstrated.status} · ${fixture.demonstrated.protectedChecks.map((check) => check.checkId).join(", ") || "<none>"}`
      : "<none>";
    lines.push(`| ${fixture.fixtureId} | ${documented} | ${demonstrated} | ${fixture.outcome} |`);
    if (fixture.notes.length > 0) lines.push(`|  | notes: ${fixture.notes.join("; ")} |  |  |`);
  }
  return lines.join("\n");
}

export function formatJsonReport(evaluation: CorpusEvaluation): string {
  return `${JSON.stringify(projectReport(evaluation), null, 2)}\n`;
}

function parseReportArgs(argv: string[]): { format: "markdown" | "json" } {
  let format: "markdown" | "json" = "markdown";
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--format") {
      const value = argv[index + 1];
      if (value !== "markdown" && value !== "json") throw new Error("--format must be markdown or json");
      format = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown report option: ${option}`);
  }
  return { format };
}

async function main(): Promise<void> {
  const { format } = parseReportArgs(process.argv.slice(2));
  const evaluation = await evaluateCorpus(
    {
      id: "current-matcher",
      label: "Current matcher baseline",
      analyze: (fixture) => analyzeWithCurrentMatcher(fixture.command),
    },
    shellAnalysisCorpus(),
    { timeoutMs: 250 },
  );
  const output = format === "json" ? formatJsonReport(evaluation) : formatMarkdownReport(evaluation);
  process.stdout.write(output);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    process.stderr.write(`shell-analysis-report: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
