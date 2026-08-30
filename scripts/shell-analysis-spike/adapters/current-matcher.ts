import {
  extractLiteralGitTargetOptions,
  matchesForcedGitClean,
  matchesGitResetHard,
  matchesRecursiveForcedDeletion,
} from "../../../src/command-risk.ts";

import {
  type CorpusFixture,
  type ProtectedCheckObservation,
  protectedCheck,
} from "../model.ts";

export interface CurrentMatcherAnalysis {
  readonly adapterId: "current-matcher";
  readonly adapterLabel: string;
  readonly command: string;
  readonly status: "structured" | "degraded" | "unsupported" | "failed";
  readonly textualEvidence: readonly string[];
  readonly protectedChecks: readonly ProtectedCheckObservation[];
  readonly literalGitTargetOptions: readonly { option: "-C" | "--git-dir" | "--work-tree"; value: string }[];
  readonly limitations: readonly string[];
}

function appendCheck(
  checks: ProtectedCheckObservation[],
  command: string,
  matched: boolean,
  checkId: ProtectedCheckObservation["checkId"],
  text: string,
): void {
  if (!matched) return;
  checks.push(protectedCheck(checkId, "matched", "observed", text));
}

export function analyzeWithCurrentMatcher(command: string): CurrentMatcherAnalysis {
  const textualEvidence: string[] = [];
  const checks: ProtectedCheckObservation[] = [];
  appendCheck(checks, command, matchesRecursiveForcedDeletion(command), "recursive-forced-deletion", "recursive filesystem removal text matched");
  appendCheck(checks, command, matchesGitResetHard(command), "git-reset-hard", "git reset --hard text matched");
  appendCheck(checks, command, matchesForcedGitClean(command), "git-clean-forced", "git clean -f text matched");
  if (checks.length > 0) {
    textualEvidence.push(...checks.map((check) => `${check.checkId}: matched by current text matcher`));
  } else {
    textualEvidence.push("no baseline destructive checks matched");
  }
  const literalGitTargetOptions = extractLiteralGitTargetOptions(command);
  if (literalGitTargetOptions.length > 0) {
    textualEvidence.push(...literalGitTargetOptions.map((option) => `${option.option} ${option.value}`));
  }
  return {
    adapterId: "current-matcher",
    adapterLabel: "Current matcher baseline",
    command,
    status: checks.length > 0 ? "structured" : "degraded",
    textualEvidence,
    protectedChecks: checks,
    literalGitTargetOptions,
    limitations: [
      "text-only matcher; no syntax tree, wrapper, or heredoc structure",
      "quoted or inert text can still be matched by textual patterns",
      "no runtime argv, cwd, alias, or expansion verification",
    ],
  };
}

export function analyzeCorpusWithCurrentMatcher(fixtures: readonly CorpusFixture[]): readonly CurrentMatcherAnalysis[] {
  return fixtures.map((fixture) => analyzeWithCurrentMatcher(fixture.command));
}
