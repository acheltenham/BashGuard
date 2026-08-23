import {
  DESTRUCTIVE_FILESYSTEM_REMOVAL,
  RECURSIVE_FORCED_DELETION_CHECK,
  classifyCommandRisk,
} from "./command-risk.ts";

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
      outcome: "approval";
      observedCommand: string;
      workingDirectory: string;
      matchedCheck: typeof RECURSIVE_FORCED_DELETION_CHECK;
      riskFactors: [typeof DESTRUCTIVE_FILESYSTEM_REMOVAL];
      reason: string;
      potentialImpact: string;
      overrideAvailable: true;
      evidence: "bashguard_tool_call_input";
      limitations: string[];
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

export function evaluateToolCallAuthorization(input: AuthorizationInput): AuthorizationEvaluation {
  if (input.toolName !== "bash" || typeof input.input !== "object" || input.input === null) return { outcome: "allow" };
  const command = (input.input as Record<string, unknown>).command;
  if (typeof command !== "string") return { outcome: "allow" };
  if (!classifyCommandRisk(command).includes(DESTRUCTIVE_FILESYSTEM_REMOVAL)) return { outcome: "allow" };

  return {
    outcome: "approval",
    observedCommand: command,
    workingDirectory: input.cwd,
    matchedCheck: RECURSIVE_FORCED_DELETION_CHECK,
    riskFactors: [DESTRUCTIVE_FILESYSTEM_REMOVAL],
    reason: "Recursive forced deletion requires one-time approval.",
    potentialImpact: "Recursively deletes files without a trash or undo step.",
    overrideAvailable: true,
    evidence: "bashguard_tool_call_input",
    limitations: [
      "Later extension handlers may mutate this tool call after BashGuard observes it.",
      "Replacement tools may add internal wrappers that BashGuard does not observe here.",
      "Shell runtime expansion and child-process behavior may differ from this command text.",
    ],
  };
}

export async function authorizeToolCall(input: AuthorizationInput, runtime: AuthorizationRuntime): Promise<AuthorizationBlock | undefined> {
  const evaluation = evaluateToolCallAuthorization(input);
  if (evaluation.outcome === "allow") return undefined;

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
