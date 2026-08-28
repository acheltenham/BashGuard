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

function approvalPrompt(evaluation: Extract<AuthorizationEvaluation, { outcome: "approval" }>): { title: string; body: string } {
  return {
    title: "BashGuard approval required",
    body: [
      "BashGuard observed this command input:",
      "",
      evaluation.observedCommand,
      "",
      `Working directory: ${evaluation.workingDirectory}`,
      `Matched check: ${evaluation.matchedCheck}`,
      `Potential impact: ${evaluation.potentialImpact}`,
      "",
      "Run once permits only this tool call. Decline blocks it.",
      "Later extensions, replacement tools, and shell runtime behavior may change what executes.",
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

function evaluationFailure(observedCommand: string, workingDirectory: string, error: unknown): AuthorizationEvaluation {
  const limitation = error instanceof Error ? error.message : String(error);
  return Object.freeze({
    outcome: "evaluation_failure",
    observedCommand,
    workingDirectory,
    reason: "BashGuard authorization rule evaluation failed.",
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
    rules = provider.rules();
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

export async function authorizeToolCall(
  input: AuthorizationInput,
  runtime: AuthorizationRuntime,
  provider: AuthorizationRuleProvider = STATIC_AUTHORIZATION_RULE_PROVIDER,
): Promise<AuthorizationBlock | undefined> {
  const evaluation = evaluateToolCallAuthorization(input, provider);
  if (evaluation.outcome !== "approval") return undefined;

  const evidence = {
    ...evaluation,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    decisionSource: "bashguard_authorization",
  };
  await safelyRecord(runtime, "command.evaluated", evidence);

  if (!input.hasUI) {
    const reason = "BashGuard blocked recursive forced deletion because approval UI is unavailable.";
    await safelyRecord(runtime, "command.blocked", { ...evidence, outcome: "block", cause: "approval_unavailable", reason });
    return { block: true, reason };
  }

  const prompt = approvalPrompt(evaluation);
  await safelyRecord(runtime, "command.approval_requested", evidence);
  let approved: boolean;
  try {
    approved = await runtime.confirm(prompt.title, prompt.body);
  } catch (error) {
    const reason = "BashGuard blocked recursive forced deletion because approval UI failed.";
    await safelyRecord(runtime, "command.blocked", {
      ...evidence,
      outcome: "block",
      cause: "approval_error",
      reason,
      approvalError: error instanceof Error ? error.message : String(error),
    });
    return { block: true, reason };
  }

  if (approved) {
    await safelyRecord(runtime, "command.approved", { ...evidence, outcome: "allow", authorization: "run_once" });
    return undefined;
  }

  const reason = "BashGuard blocked recursive forced deletion because approval was declined.";
  await safelyRecord(runtime, "command.declined", { ...evidence, outcome: "block", cause: "declined", reason });
  await safelyRecord(runtime, "command.blocked", { ...evidence, outcome: "block", cause: "declined", reason });
  return { block: true, reason };
}
