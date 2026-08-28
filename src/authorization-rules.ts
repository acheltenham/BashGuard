import {
  DESTRUCTIVE_FILESYSTEM_REMOVAL,
  extractLiteralGitTargetOptions,
  matchesForcedGitClean,
  matchesGitResetHard,
  matchesRecursiveForcedDeletion,
} from "./command-risk.ts";

export type AuthorizationRuleContext = {
  observedCommand: string;
  workingDirectory: string;
};

export type AuthorizationRuleLiteralEvidence = Readonly<{
  kind: "git_target_option";
  option: string;
  value: string;
}>;

export type AuthorizationRuleMatch = Readonly<{
  id: string;
  version: number;
  provider: string;
  riskFactor: string;
  reason: string;
  potentialImpact: string;
  literalEvidence: ReadonlyArray<AuthorizationRuleLiteralEvidence>;
}>;

export type AuthorizationRule = {
  readonly id: string;
  readonly version: number;
  readonly provider: string;
  readonly riskFactor: string;
  readonly reason: string;
  readonly potentialImpact: string;
  match(context: AuthorizationRuleContext): AuthorizationRuleMatch | undefined;
};

export interface AuthorizationRuleProvider {
  rules(): readonly AuthorizationRule[];
}

const RULE_VERSION = 1;
const BUILTIN_PROVIDER = "bashguard_builtin";
const HISTORY_OR_WORKING_TREE_REWRITE = "history or working-tree rewrite";

function freezeLiteralEvidence(
  literalEvidence: ReadonlyArray<AuthorizationRuleLiteralEvidence>,
): ReadonlyArray<AuthorizationRuleLiteralEvidence> {
  return Object.freeze(literalEvidence.map((item) => Object.freeze({ ...item })));
}

function freezeMatch(match: AuthorizationRuleMatch): AuthorizationRuleMatch {
  return Object.freeze({ ...match, literalEvidence: freezeLiteralEvidence(match.literalEvidence) });
}

function createRule(rule: {
  readonly id: string;
  readonly riskFactor: string;
  readonly reason: string;
  readonly potentialImpact: string;
  match(context: AuthorizationRuleContext): ReadonlyArray<AuthorizationRuleLiteralEvidence> | undefined;
}): AuthorizationRule {
  const metadata = Object.freeze({
    id: rule.id,
    version: RULE_VERSION,
    provider: BUILTIN_PROVIDER,
    riskFactor: rule.riskFactor,
    reason: rule.reason,
    potentialImpact: rule.potentialImpact,
  });

  return Object.freeze({
    ...metadata,
    match(context: AuthorizationRuleContext) {
      const literalEvidence = rule.match(context);
      if (!literalEvidence) return undefined;
      return freezeMatch({ ...metadata, literalEvidence });
    },
  });
}

function literalGitEvidence(command: string): ReadonlyArray<AuthorizationRuleLiteralEvidence> {
  return extractLiteralGitTargetOptions(command).map((option) => ({
    kind: "git_target_option" as const,
    option: option.option,
    value: option.value,
  }));
}

const RECURSIVE_FORCED_DELETION_RULE = createRule({
  id: "recursive-forced-deletion",
  riskFactor: DESTRUCTIVE_FILESYSTEM_REMOVAL,
  reason: "Recursive forced deletion requires one-time approval.",
  potentialImpact: "Recursively deletes files without a trash or undo step.",
  match(context: AuthorizationRuleContext) {
    if (!matchesRecursiveForcedDeletion(context.observedCommand)) return undefined;
    return [];
  },
});

const GIT_RESET_HARD_RULE = createRule({
  id: "git-reset-hard",
  riskFactor: HISTORY_OR_WORKING_TREE_REWRITE,
  reason: "git reset --hard can rewrite repository state.",
  potentialImpact: "may discard tracked working-tree and index changes.",
  match(context: AuthorizationRuleContext) {
    if (!matchesGitResetHard(context.observedCommand)) return undefined;
    return literalGitEvidence(context.observedCommand);
  },
});

const GIT_CLEAN_FORCED_RULE = createRule({
  id: "git-clean-forced",
  riskFactor: HISTORY_OR_WORKING_TREE_REWRITE,
  reason: "forced git clean can rewrite repository state.",
  potentialImpact: "may permanently delete untracked files and, when requested, directories.",
  match(context: AuthorizationRuleContext) {
    if (!matchesForcedGitClean(context.observedCommand)) return undefined;
    return literalGitEvidence(context.observedCommand);
  },
});

const STATIC_AUTHORIZATION_RULES: readonly AuthorizationRule[] = Object.freeze([
  RECURSIVE_FORCED_DELETION_RULE,
  GIT_RESET_HARD_RULE,
  GIT_CLEAN_FORCED_RULE,
]);

export const STATIC_AUTHORIZATION_RULE_PROVIDER: AuthorizationRuleProvider = Object.freeze({
  rules(): readonly AuthorizationRule[] {
    return STATIC_AUTHORIZATION_RULES;
  },
});
