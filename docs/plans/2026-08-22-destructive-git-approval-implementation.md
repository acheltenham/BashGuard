# Destructive Git Approval Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Add one-time in-Pi approval for BashGuard-observed `git reset --hard` and forced `git clean` calls through an extensible typed static rule registry while preserving recursive-deletion behavior and backward-readable evidence.

**Architecture:** Pure command matchers feed immutable built-in rules supplied by a narrow synchronous provider. The evaluator gathers all rule matches, while one shared authorization orchestrator records evidence and owns Run once, Decline, unavailable-UI, failure, and duplicate-owner behavior. Existing scalar `matchedCheck` evidence remains readable; new events also carry ordered structured `matchedChecks`.

**Tech Stack:** TypeScript on Node.js, Pi extension `tool_call` hooks, append-only JSONL, Node test runner, existing BashGuard CLI projections.

---

## Preconditions

Work only in:

```bash
cd /Users/antoniocheltenham/BashGuard/.worktrees/destructive-git-approval
```

Read before implementation:

- `docs/plans/2026-08-22-destructive-git-approval-design.md`
- `docs/plans/2026-08-22-recursive-delete-approval-design.md`
- `docs/research/command-resolution-spike-results.md`
- `src/command-risk.ts`
- `src/command-authorization.ts`
- `extensions/bashguard/index.ts`

Do not broaden the slice to rebase, force push, external plugins, persistent policy, filesystem repository resolution, or shell parsing. Keep [#90](https://github.com/acheltenham/BashGuard/issues/90) and [#91](https://github.com/acheltenham/BashGuard/issues/91) visible.

### Task 1: Add precise pure Git command matchers

**Files:**
- Modify: `src/command-risk.ts`
- Modify: `src/command-risk.test.ts`

**Step 1: Write failing matcher tests**

Add table-driven tests for exported helpers with these minimum cases:

```ts
assert.equal(matchesGitResetHard("git reset --hard"), true);
assert.equal(matchesGitResetHard("git -C ../repo reset HEAD~1 --hard"), true);
assert.equal(matchesGitResetHard("git --work-tree=/tmp/w reset --hard"), true);
assert.equal(matchesGitResetHard("git reset --soft HEAD~1"), false);
assert.equal(matchesGitResetHard("git reset HEAD file.txt"), false);

assert.equal(matchesForcedGitClean("git clean -f"), true);
assert.equal(matchesForcedGitClean("git clean -fd"), true);
assert.equal(matchesForcedGitClean("git clean -xdf"), true);
assert.equal(matchesForcedGitClean("git -C ../repo clean --force -d"), true);
assert.equal(matchesForcedGitClean("git clean -n"), false);
assert.equal(matchesForcedGitClean("git clean --dry-run"), false);
```

Also lock conservative behavior for compound calls and quoted examples. The quoted-text test must document an accepted temporary over-prompt rather than imply shell parsing:

```ts
assert.equal(matchesGitResetHard("npm test && git reset --hard"), true);
assert.equal(matchesGitResetHard("echo 'git reset --hard'"), true); // tracked by #90
```

Test literal option extraction for separated and equals forms:

```ts
assert.deepEqual(extractLiteralGitTargetOptions(
  "git -C ../repo --git-dir=.git --work-tree /tmp/tree reset --hard",
), [
  { option: "-C", value: "../repo" },
  { option: "--git-dir", value: ".git" },
  { option: "--work-tree", value: "/tmp/tree" },
]);
```

**Step 2: Run the focused tests and confirm RED**

```bash
node --experimental-strip-types --test src/command-risk.test.ts
```

Expected: failure because the new helpers are not exported.

**Step 3: Implement minimal pure helpers**

In `src/command-risk.ts`, export:

```ts
export type LiteralGitTargetOption = {
  option: "-C" | "--git-dir" | "--work-tree";
  value: string;
};

export function matchesRecursiveForcedDeletion(command: string): boolean;
export function matchesGitResetHard(command: string): boolean;
export function matchesForcedGitClean(command: string): boolean;
export function extractLiteralGitTargetOptions(command: string): LiteralGitTargetOption[];
```

Use bounded conservative textual patterns. Stop Git operation matching at ordinary newline, `;`, `|`, and `&` boundaries where practical. Permit text between `git` and the operation so common global options work. Forced clean must require `--force` or a short option token containing `f`; `-n`/`--dry-run` alone must not match.

Refactor `classifyCommandRisk()` to reuse these helpers for recursive deletion and reset/clean while preserving observation-only classification for rebase and force push. Do not remove any existing risk classification.

Literal extraction must preserve textual values only. It must not call `realpath`, `git`, or filesystem APIs and must not label the value resolved.

**Step 4: Run focused tests and confirm GREEN**

```bash
node --experimental-strip-types --test src/command-risk.test.ts
```

Expected: all command-risk tests pass.

**Step 5: Commit**

```bash
git add src/command-risk.ts src/command-risk.test.ts
git commit -m "feat: match local destructive Git commands"
```

### Task 2: Introduce the typed static authorization rule provider

**Files:**
- Create: `src/authorization-rules.ts`
- Create: `src/authorization-rules.test.ts`

**Step 1: Write failing provider and rule tests**

Test that the static provider returns exactly these rule IDs in stable order:

```ts
assert.deepEqual(
  STATIC_AUTHORIZATION_RULE_PROVIDER.rules().map((rule) => rule.id),
  ["recursive-forced-deletion", "git-reset-hard", "git-clean-forced"],
);
```

For every rule, assert a stable version (`1`), provider (`bashguard_builtin`), nonempty category/reason/impact, and a pure matcher result. Test that Git matches carry literal target options and recursive deletion retains its existing wording.

Test provider immutability by confirming consumers cannot mutate the returned registry or rule definitions.

**Step 2: Run and confirm RED**

```bash
node --experimental-strip-types --test src/authorization-rules.test.ts
```

Expected: module-not-found failure.

**Step 3: Implement the provider**

Create these core types:

```ts
export type AuthorizationRuleContext = {
  observedCommand: string;
  workingDirectory: string;
};

export type AuthorizationRuleMatch = {
  id: string;
  version: number;
  provider: string;
  riskFactor: string;
  reason: string;
  potentialImpact: string;
  literalEvidence: Array<{
    kind: "git_target_option";
    option: string;
    value: string;
  }>;
};

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
```

Implement and freeze the three built-in rules. Rule matchers delegate to Task 1 helpers. Only Git rules attach literal Git target evidence. Export a frozen `STATIC_AUTHORIZATION_RULE_PROVIDER`.

Do not add dynamic loading, async hooks, configuration, classes, or public plugin discovery.

**Step 4: Run and confirm GREEN**

```bash
node --experimental-strip-types --test src/authorization-rules.test.ts
```

Expected: all provider tests pass.

**Step 5: Commit**

```bash
git add src/authorization-rules.ts src/authorization-rules.test.ts
git commit -m "feat: add static authorization rule provider"
```

### Task 3: Gather all matches in the pure evaluator

**Files:**
- Modify: `src/command-authorization.ts`
- Modify: `src/command-authorization.test.ts`

**Step 1: Replace and extend evaluator tests**

Remove `git reset --hard` from the safe-call table. Add table-driven approval cases for both Git checks and global targeting options.

Assert the compatibility and structured fields:

```ts
assert.equal(result.matchedCheck, "git-reset-hard");
assert.deepEqual(result.matchedChecks.map((match) => match.id), ["git-reset-hard"]);
assert.deepEqual(result.riskFactors, ["history or working-tree rewrite"]);
```

Add a multi-match command:

```ts
const command = "rm -rf build && git reset --hard && git clean -fd";
```

Expect all three matches in provider order, one deduplicated risk-factor list, full observed command, cwd, and Git literal evidence where present.

Inject a test provider with a throwing matcher and assert a typed evaluation-failure result rather than an unhandled exception.

**Step 2: Run and confirm RED**

```bash
node --experimental-strip-types --test src/command-authorization.test.ts
```

Expected: Git calls are still allowed and `matchedChecks` is absent.

**Step 3: Refactor evaluation minimally**

Update `AuthorizationEvaluation` to support:

```ts
| { outcome: "allow" }
| { outcome: "evaluation_failure"; observedCommand: string; workingDirectory: string; reason: string; limitations: string[] }
| {
    outcome: "approval";
    observedCommand: string;
    workingDirectory: string;
    matchedCheck: string;
    matchedChecks: AuthorizationRuleMatch[];
    riskFactors: string[];
    reason: string;
    potentialImpact: string;
    overrideAvailable: true;
    evidence: "bashguard_tool_call_input";
    limitations: string[];
  };
```

Allow an optional provider parameter defaulting to `STATIC_AUTHORIZATION_RULE_PROVIDER`. Gather all matches in provider order. Combine reason/impact text without losing per-rule details. Deduplicate `riskFactors` while preserving first-seen order.

Unsupported tools and malformed/no-match Bash input remain `{ outcome: "allow" }`.

**Step 4: Run and confirm GREEN**

```bash
node --experimental-strip-types --test src/command-authorization.test.ts
```

Expected: evaluator tests pass.

**Step 5: Commit**

```bash
git add src/command-authorization.ts src/command-authorization.test.ts
git commit -m "feat: evaluate all authorization rule matches"
```

### Task 4: Generalize one-prompt authorization orchestration

**Files:**
- Modify: `src/command-authorization.ts`
- Modify: `src/command-authorization.test.ts`

**Step 1: Write failing lifecycle and prompt tests**

Add tests proving:

- a multi-rule call produces exactly one confirmation;
- the prompt lists the full command, every check, every impact, cwd, and literal Git options;
- Run once records ordered structured evidence on evaluated/requested/approved events;
- decline records declined then blocked;
- no UI and UI failure block Git and multi-rule calls;
- evaluation failure blocks with cause `authorization_evaluation_error` without opening UI;
- recursive-only exact block reasons remain unchanged;
- Git/multi-rule reasons accurately identify matched risky commands;
- recorder rejection still does not reverse Run once or Decline.

**Step 2: Run and confirm RED**

```bash
node --experimental-strip-types --test src/command-authorization.test.ts
```

Expected: prompt and generic lifecycle assertions fail.

**Step 3: Implement shared generic orchestration**

Render one prompt from `matchedChecks`. Keep the title `BashGuard approval required`. Include:

```text
One decision covers this entire BashGuard-observed tool call.
```

Render literal targeting options as literal evidence, not resolved repositories.

Keep existing recursive-only block strings exactly. Add stable Git/multi-rule decline, unavailable-UI, UI-failure, and evaluation-error strings. Continue using `safelyRecord()` so persistence does not govern the decision.

For evaluation failure, record `command.blocked` with `cause: "authorization_evaluation_error"` when possible and return Pi's block result. Do not prompt.

**Step 4: Run and confirm GREEN**

```bash
node --experimental-strip-types --test src/command-authorization.test.ts
```

Expected: all authorization unit tests pass.

**Step 5: Commit**

```bash
git add src/command-authorization.ts src/command-authorization.test.ts
git commit -m "feat: authorize multiple matched rules once"
```

### Task 5: Verify active-owner extension integration

**Files:**
- Modify: `src/extension-authorization.test.ts`
- Modify only if necessary: `extensions/bashguard/index.ts`

**Step 1: Write failing extension tests**

Add active-owner tests for:

- Run once on `git -C <disposable> reset --hard`;
- Decline on `git clean -fd`;
- one prompt for a command matching reset and clean;
- recorded `tool.requested` before decision events;
- structured rule/provider/version evidence;
- duplicate owner neither prompts nor blocks the new Git calls.

Keep all existing recursive and safe-call tests.

**Step 2: Run and confirm RED**

```bash
node --experimental-strip-types --test src/extension-authorization.test.ts
```

Expected: Git-specific assertions fail before generalized authorization is wired correctly.

**Step 3: Make the smallest extension change**

The extension should continue calling the shared `authorizeToolCall()` only after `tool.requested` recording and only when it owns active recorder state. Do not move authorization to module top level or allow duplicate instances to evaluate.

If the shared default provider makes no extension code change necessary, commit tests alone; do not add needless adapter code.

**Step 4: Run and confirm GREEN**

```bash
node --experimental-strip-types --test src/extension-authorization.test.ts src/extension-failure.test.ts
```

Expected: extension authorization and failure tests pass.

**Step 5: Commit**

```bash
git add src/extension-authorization.test.ts extensions/bashguard/index.ts
git commit -m "test: cover destructive Git extension authorization"
```

### Task 6: Project structured matches through every CLI surface

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/cli.test.ts`

**Step 1: Write failing projection tests**

Create old scalar-only and new structured event fixtures. Assert:

- timeline/browser narration names all matched checks without duplicate text;
- inspect renders rule ID, version, provider, risk, impact, and literal targeting options;
- old `matchedCheck` events retain their current output;
- risk and tool filters include Git decision events;
- debrief counts one approval decision, not one per matched rule;
- debrief lists all checks and exact inspect links;
- blocked Git calls say they were blocked before execution by recorded authorization decision;
- approved calls do not claim every runtime layer was approved;
- attach closes declined/blocked Git calls and keeps approved calls pending completion.

**Step 2: Run and confirm RED**

```bash
node --experimental-strip-types --test --test-name-pattern="authorization|matched checks|blocked requests" src/cli.test.ts
```

Expected: structured match fields are not rendered.

**Step 3: Implement backward-compatible normalization**

Add one helper in `src/cli.ts` that reads `payload.matchedChecks` when valid and otherwise projects the scalar `payload.matchedCheck`. Sanitize malformed array entries as missing evidence rather than throwing or inventing fields.

Reuse this helper in timeline rendering, event inspection, filtering metadata, and debrief aggregation. Count decision events, not matches. Keep plain text and JSONL workflows stable.

**Step 4: Run and confirm GREEN**

```bash
node --experimental-strip-types --test src/cli.test.ts
```

Expected: all CLI tests pass.

**Step 5: Commit**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat: render multi-rule authorization evidence"
```

### Task 7: Prove extension-writer to CLI-reader compatibility

**Files:**
- Modify: `src/authorization.integration.test.ts`

**Step 1: Write the failing integration scenario**

Use the real extension handler to write a blocked no-UI event for a disposable command containing both:

```bash
git -C <repo> reset --hard && git -C <repo> clean -fd
```

The test must not execute the command. Assert the disposable repository sentinels remain present. Invoke the real CLI and assert risk-filter, inspect, browser projection model/output, and debrief show both checks, literal `-C`, block cause, limitations, and inspect evidence.

Retain the existing recursive-deletion integration scenario.

**Step 2: Run and confirm RED**

```bash
node --experimental-strip-types --test src/authorization.integration.test.ts
```

Expected: output lacks structured Git match evidence.

**Step 3: Make only integration-discovered fixes**

Fix writer/reader schema mismatches in production code. Do not special-case fixture text in the CLI.

**Step 4: Run and confirm GREEN**

```bash
node --experimental-strip-types --test src/authorization.integration.test.ts
```

Expected: integration tests pass and sentinels remain intact.

**Step 5: Commit**

```bash
git add src/authorization.integration.test.ts src/cli.ts src/command-authorization.ts
git commit -m "test: integrate destructive Git authorization evidence"
```

### Task 8: Validate with disposable real Pi sessions

**Files:**
- Create: `docs/testing/destructive-git-approval-validation.md`

**Step 1: Prepare isolated repositories and data roots**

Create fresh temporary repositories for each scenario. Commit one sentinel, modify it, and add an untracked sentinel. Print and record the exact temporary paths before invoking Pi. Never point validation at the BashGuard repository or another valuable checkout.

**Step 2: Run non-interactive fail-closed validation**

Run Pi with the local package and isolated `BASHGUARD_DATA_DIR` in print mode against `git reset --hard` and forced `git clean`. Confirm unavailable UI blocks before execution and all sentinels remain.

Use an available OpenAI model, not Anthropic, for the Pi session.

**Step 3: Run interactive PTY Decline validation**

In a fresh disposable repository, invoke the supported Git command, choose Decline, and confirm modified/untracked sentinels remain. Inspect JSONL and CLI projections.

**Step 4: Run interactive PTY Run once validation**

In separate fresh repositories, approve `git reset --hard` and forced `git clean` only against disposable sentinels. Confirm expected local effects and `tool.completed` evidence. Also run a safe Git command and confirm no prompt.

**Step 5: Record evidence and limitations**

Document Pi/model version, commands, isolated paths in sanitized form, expected/actual sentinel state, event order, CLI inspection commands, and command-identity limitations. Do not include secrets or valuable local paths.

**Step 6: Commit**

```bash
git add docs/testing/destructive-git-approval-validation.md
git commit -m "test: validate destructive Git approval in real Pi"
```

### Task 9: Synchronize product, architecture, skill, and release documentation

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/current-state.md`
- Modify: `docs/product/roadmap.md`
- Modify if semantics need clarification: `docs/product/requirements.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/event-model.md`
- Modify: `docs/cli/evidence-filtering.md`
- Modify: `docs/research/pi-capability-matrix.md`
- Modify: `docs/release/checklist.md`
- Modify: `docs/testing/milestone-0-smoke-checklist.md`
- Modify: `skills/bashguard/SKILL.md`
- Modify: `docs/plans/2026-08-22-destructive-git-approval-design.md`

**Step 1: Update shipped-capability language**

Mark Slice 2 implemented only after real validation passes. State precisely:

- which two Git checks ship;
- one decision covers the complete observed tool call;
- structured matches and literal targeting evidence are recorded;
- conservative matching may over-prompt;
- literal targeting is not verified repository identity;
- authorization is not containment or recovery.

**Step 2: Preserve the deferred ledger**

Keep #90 and #91 linked from the design, roadmap, and current state. Preserve all Slice 1 deferred items. Do not describe external providers or AI-managed policy as implemented.

**Step 3: Update operational guidance**

Add safe disposable Git approval checks to smoke/release guidance and teach the BashGuard skill how to explain multi-rule decisions, missing evidence, and limitations.

**Step 4: Check documentation diffs**

```bash
git diff --check
git diff -- README.md CHANGELOG.md docs skills/bashguard/SKILL.md
```

Expected: no whitespace errors; no universal resolved-command, containment, or verified-repository claims.

**Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs skills/bashguard/SKILL.md
git commit -m "docs: document destructive Git authorization"
```

### Task 10: Independent review and final verification

**Files:**
- Review all changes from `5e9073f..HEAD`

**Step 1: Run focused authorization suites**

```bash
node --experimental-strip-types --test \
  src/command-risk.test.ts \
  src/authorization-rules.test.ts \
  src/command-authorization.test.ts \
  src/extension-authorization.test.ts \
  src/authorization.integration.test.ts \
  src/cli.test.ts
```

Expected: all pass.

**Step 2: Run full verification**

```bash
npm test
npm run check
npm audit
git diff --check origin/main...HEAD
git status --short --branch
```

Expected: all tests pass, TypeScript passes, zero known vulnerabilities, no whitespace errors, and clean worktree.

**Step 3: Run independent OpenAI review**

Spawn a clean Pi review session using an available OpenAI model. Ask it to review `5e9073f..HEAD` for Critical/Important correctness, safety, event compatibility, false negatives in supported forms, multi-match decision semantics, duplicate ownership, CLI grounding, and documentation drift. It must not edit.

**Step 4: Triage review technically**

Use the receiving-code-review and systematic-debugging workflows. Reproduce every finding before changing code. Add a failing regression test first for valid findings, implement the minimum fix, and rerun focused tests.

**Step 5: Re-review and rerun full verification**

Require no remaining reproducible Critical/Important findings and fresh passing verification before claiming completion.

**Step 6: Create and merge the PR**

Push `feature/destructive-git-approval`, open a PR closing #89, include real-Pi evidence and explicit deferred links #90/#91, wait for checks, merge, verify #89 closed, update local `main`, and remove the worktree/branches using the finishing-a-development-branch workflow.
