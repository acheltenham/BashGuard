import {
  DESTRUCTIVE_FILESYSTEM_REMOVAL,
  RECURSIVE_FORCED_DELETION_CHECK,
  classifyCommandRisk,
} from "./command-risk.ts";

export type AuthorizationInput = {
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
