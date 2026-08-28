import assert from "node:assert/strict";
import test from "node:test";

import {
  STATIC_AUTHORIZATION_RULE_PROVIDER,
} from "./authorization-rules.ts";

const EXPECTED_RULE_IDS = [
  "recursive-forced-deletion",
  "git-reset-hard",
  "git-clean-forced",
] as const;

test("static provider returns built-in rules in deterministic order", () => {
  const rules = STATIC_AUTHORIZATION_RULE_PROVIDER.rules();
  assert.deepEqual(rules.map((rule) => rule.id), EXPECTED_RULE_IDS);
  assert.ok(Object.isFrozen(STATIC_AUTHORIZATION_RULE_PROVIDER));
  assert.ok(Object.isFrozen(rules));
  for (const rule of rules) assert.ok(Object.isFrozen(rule));
});

test("built-in rules expose stable metadata and representative matches", () => {
  const rules = STATIC_AUTHORIZATION_RULE_PROVIDER.rules();
  const [recursive, gitResetHard, gitCleanForced] = rules;

  assert.ok(recursive);
  assert.ok(gitResetHard);
  assert.ok(gitCleanForced);

  assertRuleMetadata(recursive, {
    id: "recursive-forced-deletion",
    riskFactor: "destructive filesystem removal",
    reason: "Recursive forced deletion requires one-time approval.",
    potentialImpact: "Recursively deletes files without a trash or undo step.",
  });
  assertRuleMetadata(gitResetHard, {
    id: "git-reset-hard",
    riskFactor: "history or working-tree rewrite",
    reason: "git reset --hard can rewrite repository state.",
    potentialImpact: "may discard tracked working-tree and index changes.",
  });
  assertRuleMetadata(gitCleanForced, {
    id: "git-clean-forced",
    riskFactor: "history or working-tree rewrite",
    reason: "forced git clean can rewrite repository state.",
    potentialImpact: "may permanently delete untracked files and, when requested, directories.",
  });

  assertMatch(
    recursive.match({ observedCommand: "rm -rf build", workingDirectory: "/tmp/project" }),
    {
      id: "recursive-forced-deletion",
      riskFactor: "destructive filesystem removal",
      reason: "Recursive forced deletion requires one-time approval.",
      potentialImpact: "Recursively deletes files without a trash or undo step.",
      literalEvidence: [],
      version: 1,
      provider: "bashguard_builtin",
    },
  );
  assert.equal(recursive.match({ observedCommand: "git reset --hard", workingDirectory: "/tmp/project" }), undefined);

  assertMatch(
    gitResetHard.match({ observedCommand: "git -C ../repo reset HEAD~1 --hard", workingDirectory: "/tmp/project" }),
    {
      id: "git-reset-hard",
      riskFactor: "history or working-tree rewrite",
      reason: "git reset --hard can rewrite repository state.",
      potentialImpact: "may discard tracked working-tree and index changes.",
      literalEvidence: [{ kind: "git_target_option", option: "-C", value: "../repo" }],
      version: 1,
      provider: "bashguard_builtin",
    },
  );
  assert.equal(gitResetHard.match({ observedCommand: "git reset --soft HEAD~1", workingDirectory: "/tmp/project" }), undefined);

  assertMatch(
    gitCleanForced.match({ observedCommand: "git --git-dir=.git --work-tree /tmp/tree clean -fd", workingDirectory: "/tmp/project" }),
    {
      id: "git-clean-forced",
      riskFactor: "history or working-tree rewrite",
      reason: "forced git clean can rewrite repository state.",
      potentialImpact: "may permanently delete untracked files and, when requested, directories.",
      literalEvidence: [
        { kind: "git_target_option", option: "--git-dir", value: ".git" },
        { kind: "git_target_option", option: "--work-tree", value: "/tmp/tree" },
      ],
      version: 1,
      provider: "bashguard_builtin",
    },
  );
  assert.equal(gitCleanForced.match({ observedCommand: "git clean --dry-run -f", workingDirectory: "/tmp/project" }), undefined);
});

test("built-in rules and returned registry are immutable", () => {
  const rules = STATIC_AUTHORIZATION_RULE_PROVIDER.rules();

  assert.throws(() => {
    (rules as Array<(typeof rules)[number]>).push(rules[0]!);
  });

  assert.throws(() => {
    (rules[0] as { id: string }).id = "mutated";
  });

  const match = rules[1]!.match({ observedCommand: "git -C ../repo reset HEAD~1 --hard", workingDirectory: "/tmp/project" });
  assert.ok(match);
  assert.ok(Object.isFrozen(match));
  assert.ok(Object.isFrozen(match.literalEvidence));
  assert.throws(() => {
    (match as { id: string }).id = "mutated";
  });
  assert.throws(() => {
    (match.literalEvidence as Array<(typeof match.literalEvidence)[number]>).push({
      kind: "git_target_option",
      option: "-C",
      value: "mutated",
    });
  });
  assert.throws(() => {
    (match.literalEvidence[0] as { option: string }).option = "mutated";
  });

  assert.equal(STATIC_AUTHORIZATION_RULE_PROVIDER.rules().map((rule) => rule.id).join(","), EXPECTED_RULE_IDS.join(","));
});

function assertRuleMetadata(
  rule: {
    readonly id: string;
    readonly version: number;
    readonly provider: string;
    readonly riskFactor: string;
    readonly reason: string;
    readonly potentialImpact: string;
  },
  expected: {
    id: string;
    riskFactor: string;
    reason: string;
    potentialImpact: string;
  },
) {
  assert.equal(rule.id, expected.id);
  assert.equal(rule.version, 1);
  assert.equal(rule.provider, "bashguard_builtin");
  assert.equal(rule.riskFactor, expected.riskFactor);
  assert.equal(rule.reason, expected.reason);
  assert.equal(rule.potentialImpact, expected.potentialImpact);
}

type ExpectedMatch = {
  readonly id: string;
  readonly version: number;
  readonly provider: string;
  readonly riskFactor: string;
  readonly reason: string;
  readonly potentialImpact: string;
  readonly literalEvidence: ReadonlyArray<{
    readonly kind: "git_target_option";
    readonly option: string;
    readonly value: string;
  }>;
};

function assertMatch(match: ExpectedMatch | undefined, expected: ExpectedMatch) {
  assert.ok(match);
  assert.deepEqual(match, expected);
}
