import {
  STATIC_AUTHORIZATION_RULE_PROVIDER,
  type AuthorizationRuleMatch,
  type AuthorizationRuleProvider,
} from "./authorization-rules.ts";

export type AuthorizationInput = {
  toolCallId?: string;
  toolName: string;
  input: unknown;
  cwd: string;
  hasUI: boolean;
};

export type AuthorizationEvaluation =
  | { outcome: "allow" }
  | {
      outcome: "evaluation_failure";
      observedCommand: string;
      workingDirectory: string;
      reason: string;
      limitations: readonly string[];
    }
  | {
      outcome: "approval";
      observedCommand: string;
      workingDirectory: string;
      matchedCheck: string;
      matchedChecks: readonly AuthorizationRuleMatch[];
      riskFactors: readonly string[];
      reason: string;
      potentialImpact: string;
      overrideAvailable: true;
      evidence: "bashguard_tool_call_input";
      limitations: readonly string[];
    };

export type AuthorizationRuntime = {
  record(type: string, payload: Record<string, unknown>): Promise<void>;
  confirm(title: string, body: string): Promise<boolean>;
};

export type AuthorizationBlock = { block: true; reason: string };

async function safelyRecord(runtime: AuthorizationRuntime, type: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await runtime.record(type, payload);
  } catch {
    // Authorization remains governed by the user's decision when evidence persistence degrades.
  }
}

function isApproval(evaluation: AuthorizationEvaluation): evaluation is Extract<AuthorizationEvaluation, { outcome: "approval" }> {
  return evaluation.outcome === "approval";
}

function isRecursiveOnly(matches: readonly AuthorizationRuleMatch[]): boolean {
  return matches.length === 1 && matches[0]?.id === "recursive-forced-deletion";
}

function authorizationSubject(matches: readonly AuthorizationRuleMatch[]): string {
  if (isRecursiveOnly(matches)) return "recursive forced deletion";
  if (matches.length > 0 && matches.every((match) => match.id.startsWith("git-"))) return "destructive Git operation";
  return "risky command/tool call";
}

function blockReason(matches: readonly AuthorizationRuleMatch[], cause: "approval_unavailable" | "approval_error" | "declined"): string {
  if (isRecursiveOnly(matches)) {
    if (cause === "approval_unavailable") return "BashGuard blocked recursive forced deletion because approval UI is unavailable.";
    if (cause === "approval_error") return "BashGuard blocked recursive forced deletion because approval UI failed.";
    return "BashGuard blocked recursive forced deletion because approval was declined.";
  }

  const subject = authorizationSubject(matches);
  if (cause === "approval_unavailable") return `BashGuard blocked this ${subject} because approval UI is unavailable.`;
  if (cause === "approval_error") return `BashGuard blocked this ${subject} because approval UI failed.`;
  return `BashGuard blocked this ${subject} because approval was declined.`;
}

function evaluationFailureReason(): string {
  return "BashGuard blocked this risky command/tool call because authorization rule evaluation failed.";
}

function approvalPrompt(evaluation: Extract<AuthorizationEvaluation, { outcome: "approval" }>): { title: string; body: string } {
  const literalGitTargetOptions = uniqueLiteralGitTargetOptions(evaluation.matchedChecks);
  return {
    title: "BashGuard approval required",
    body: [
      "BashGuard observed this command:",
      "",
      evaluation.observedCommand,
      "",
      `Working directory: ${evaluation.workingDirectory}`,
      "",
      "One decision covers this entire BashGuard-observed tool call.",
      "",
      "Matched checks:",
      ...evaluation.matchedChecks.flatMap((match) => [
        `- ${match.id}`,
        `  Reason: ${match.reason}`,
        `  Impact: ${match.potentialImpact}`,
      ]),
      "",
      "Literal Git target options:",
      ...(literalGitTargetOptions.length > 0 ? literalGitTargetOptions.map((option) => `- ${option}`) : ["- none observed"]),
      "",
      "Run once means BashGuard will approve only this one BashGuard-observed tool call.",
      "Decline blocks it.",
      "Later extension handlers may mutate this tool call after BashGuard observes it.",
      "Replacement tools may add internal wrappers that BashGuard does not observe here.",
      "Shell runtime expansion and child-process behavior may differ from this command text.",
    ].join("\n"),
  };
}

function isValidCommandString(command: unknown): command is string {
  return typeof command === "string" && command.trim().length > 0;
}

function freezeStringArray(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]);
}

function freezeLiteralEvidence(
  literalEvidence: AuthorizationRuleMatch["literalEvidence"],
): AuthorizationRuleMatch["literalEvidence"] {
  return Object.freeze(literalEvidence.map((item) => Object.freeze({ ...item })));
}

function freezeMatch(match: AuthorizationRuleMatch): AuthorizationRuleMatch {
  return Object.freeze({ ...match, literalEvidence: freezeLiteralEvidence(match.literalEvidence) });
}

function dedupeRiskFactors(matches: readonly AuthorizationRuleMatch[]): readonly string[] {
  const seen = new Set<string>();
  const riskFactors: string[] = [];
  for (const match of matches) {
    if (seen.has(match.riskFactor)) continue;
    seen.add(match.riskFactor);
    riskFactors.push(match.riskFactor);
  }
  return Object.freeze(riskFactors);
}

function combineMatchText(matches: readonly AuthorizationRuleMatch[], key: "reason" | "potentialImpact"): string {
  if (matches.length === 1) return matches[0]![key];
  return matches.map((match) => `- ${match[key]}`).join("\n");
}

function uniqueLiteralGitTargetOptions(matches: readonly AuthorizationRuleMatch[]): string[] {
  const seen = new Set<string>();
  const options: string[] = [];

  for (const match of matches) {
    for (const evidence of match.literalEvidence) {
      if (evidence.kind !== "git_target_option") continue;
      const rendered = `${evidence.option} ${evidence.value}`;
      if (seen.has(rendered)) continue;
      seen.add(rendered);
      options.push(rendered);
    }
  }

  return options;
}

function evaluationFailure(observedCommand: string, workingDirectory: string, error: unknown): AuthorizationEvaluation {
  const limitation = error instanceof Error ? error.message : String(error);
  return Object.freeze({
    outcome: "evaluation_failure",
    observedCommand,
    workingDirectory,
    reason: evaluationFailureReason(),
    limitations: Object.freeze([limitation]),
  });
}

function collectRuleMatches(
  observedCommand: string,
  workingDirectory: string,
  provider: AuthorizationRuleProvider,
): AuthorizationRuleMatch[] | AuthorizationEvaluation {
  let rules: readonly { match(context: { observedCommand: string; workingDirectory: string }): AuthorizationRuleMatch | undefined }[];
  try {
    const candidateRules = provider.rules();
    if (!Array.isArray(candidateRules)) {
      throw new Error("Authorization rule provider returned a malformed registry.");
    }
    rules = candidateRules;
  } catch (error) {
    return evaluationFailure(observedCommand, workingDirectory, error);
  }

  const matches: AuthorizationRuleMatch[] = [];
  for (const rule of rules) {
    try {
      const match = rule.match({ observedCommand, workingDirectory });
      if (match) matches.push(freezeMatch(match));
    } catch (error) {
      return evaluationFailure(observedCommand, workingDirectory, error);
    }
  }

  return matches;
}

export function evaluateToolCallAuthorization(
  input: AuthorizationInput,
  provider: AuthorizationRuleProvider = STATIC_AUTHORIZATION_RULE_PROVIDER,
): AuthorizationEvaluation {
  if (input.toolName !== "bash") return { outcome: "allow" };
  if (!input.input || typeof input.input !== "object") return { outcome: "allow" };

  const command = (input.input as Record<string, unknown>).command;
  if (!isValidCommandString(command)) return { outcome: "allow" };

  const matches = collectRuleMatches(command, input.cwd, provider);
  if (!Array.isArray(matches)) return matches;
  if (matches.length === 0) return { outcome: "allow" };

  const matchedChecks = Object.freeze([...matches]);
  return Object.freeze({
    outcome: "approval",
    observedCommand: command,
    workingDirectory: input.cwd,
    matchedCheck: matchedChecks[0]!.id,
    matchedChecks,
    riskFactors: dedupeRiskFactors(matchedChecks),
    reason: combineMatchText(matchedChecks, "reason"),
    potentialImpact: combineMatchText(matchedChecks, "potentialImpact"),
    overrideAvailable: true,
    evidence: "bashguard_tool_call_input",
    limitations: freezeStringArray([
      "Later extension handlers may mutate this tool call after BashGuard observes it.",
      "Replacement tools may add internal wrappers that BashGuard does not observe here.",
      "Shell runtime expansion and child-process behavior may differ from this command text.",
    ]),
  });
}

async function recordBlock(
  runtime: AuthorizationRuntime,
  evidence: Record<string, unknown>,
  reason: string,
  cause: "approval_unavailable" | "approval_error" | "declined" | "authorization_evaluation_error",
  extra: Record<string, unknown> = {},
): Promise<void> {
  await safelyRecord(runtime, "command.blocked", {
    ...evidence,
    ...extra,
    outcome: "block",
    cause,
    reason,
  });
}

export async function authorizeToolCall(
  input: AuthorizationInput,
  runtime: AuthorizationRuntime,
  provider: AuthorizationRuleProvider = STATIC_AUTHORIZATION_RULE_PROVIDER,
): Promise<AuthorizationBlock | undefined> {
  const evaluation = evaluateToolCallAuthorization(input, provider);
  if (evaluation.outcome === "allow") return undefined;

  const evidence = {
    ...(isApproval(evaluation)
      ? evaluation
      : {
          observedCommand: evaluation.observedCommand,
          workingDirectory: evaluation.workingDirectory,
          limitations: evaluation.limitations,
        }),
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    decisionSource: "bashguard_authorization",
  };

  if (evaluation.outcome === "evaluation_failure") {
    await recordBlock(runtime, evidence, evaluation.reason, "authorization_evaluation_error");
    return { block: true, reason: evaluation.reason };
  }

  await safelyRecord(runtime, "command.evaluated", evidence);

  if (!input.hasUI) {
    const reason = blockReason(evaluation.matchedChecks, "approval_unavailable");
    await recordBlock(runtime, evidence, reason, "approval_unavailable");
    return { block: true, reason };
  }

  const prompt = approvalPrompt(evaluation);
  await safelyRecord(runtime, "command.approval_requested", evidence);
  let approved: boolean;
  try {
    approved = await runtime.confirm(prompt.title, prompt.body);
  } catch (error) {
    const reason = blockReason(evaluation.matchedChecks, "approval_error");
    await recordBlock(runtime, evidence, reason, "approval_error", {
      approvalError: error instanceof Error ? error.message : String(error),
    });
    return { block: true, reason };
  }

  if (approved) {
    await safelyRecord(runtime, "command.approved", { ...evidence, outcome: "allow", authorization: "run_once" });
    return undefined;
  }

  const reason = blockReason(evaluation.matchedChecks, "declined");
  await safelyRecord(runtime, "command.declined", { ...evidence, outcome: "block", cause: "declined", reason });
  await recordBlock(runtime, evidence, reason, "declined");
  return { block: true, reason };
}
