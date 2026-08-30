# Shell-Aware Command Analysis Research Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Produce reproducible evidence selecting or rejecting a shell-analysis and Git-target-verification architecture for #90 without changing production authorization behavior.

**Architecture:** All prototypes live under `scripts/shell-analysis-spike/` and implement one parser-independent research interface. A shared sanitized corpus drives the current matcher baseline, Tree-sitter, narrow tokenizer, and external-analyzer evaluations. Generated raw evidence stays outside the repository; deterministic sanitized matrices and recommendations are committed.

**Tech Stack:** TypeScript, Node.js test runner, current BashGuard matcher, candidate development dependencies (`tree-sitter`, `tree-sitter-bash`, `web-tree-sitter`, `shell-quote` where justified), disposable Git repositories, optional pinned `dcg` build under `/tmp`, Pi package smokes.

---

## Preconditions and constraints

Work only in:

```bash
cd /Users/antoniocheltenham/BashGuard/.worktrees/shell-analysis-research
```

Read:

- `docs/plans/2026-08-28-shell-aware-command-analysis-research-design.md`
- `docs/research/command-resolution-spike-results.md`
- `docs/plans/2026-08-22-destructive-git-approval-design.md`
- `src/command-risk.ts`
- Pi `docs/packages.md`, `docs/extensions.md`, and `docs/security.md`

Do not import research code from `src/` or `extensions/`. Do not change production command matching, authorization, event schemas, or prompts. Do not close #90.

### Task 1: Define the research model and sanitized corpus

**Files:**
- Create: `scripts/shell-analysis-spike/model.ts`
- Create: `scripts/shell-analysis-spike/model.test.ts`
- Create: `scripts/shell-analysis-spike/corpus.ts`
- Create: `scripts/shell-analysis-spike/corpus.test.ts`

**Steps:**

1. Write failing tests for immutable fixture IDs, source spans, relation/status enums, and expectation completeness.
2. Define parser-independent research types for analysis status, command segments, relations, wrappers, redirections, unresolved constructs, diagnostics, adapter identity, and protected-check observations.
3. Create a sanitized corpus covering direct protected forms, inert text, quotes/escapes, chains/lists/pipelines/background/newlines, groups/subshells, assignments/wrappers, redirects/heredocs, Git global options, quoted paths, path-operation collisions, malformed syntax, dynamic sinks, and Command Resolution Spike 2 structures.
4. Require each fixture to label expected structural facts, protected-rule expectation, evidence level, and whether it is in the Stage B supported subset or an explicit unsupported/degraded case.
5. Ensure no fixture contains local usernames, repository names, secrets, or executable destructive targets.
6. Run:

```bash
node --experimental-strip-types --test scripts/shell-analysis-spike/model.test.ts scripts/shell-analysis-spike/corpus.test.ts
npm run check
```

7. Commit:

```bash
git commit -am "research: define shell analysis corpus"
```

### Task 2: Add the current matcher baseline and report skeleton

**Files:**
- Create: `scripts/shell-analysis-spike/adapters/current-matcher.ts`
- Create: `scripts/shell-analysis-spike/adapters/current-matcher.test.ts`
- Create: `scripts/shell-analysis-spike/evaluate.ts`
- Create: `scripts/shell-analysis-spike/evaluate.test.ts`
- Create: `scripts/shell-analysis-spike/report.ts`
- Create: `scripts/shell-analysis-spike/report.test.ts`
- Modify: `package.json`

**Steps:**

1. Test an adapter that calls existing exported matchers without copying their regex/token logic.
2. Record only baseline protected checks and known textual limitations; do not pretend it emits structural segments.
3. Build an evaluator that runs any adapter over the same corpus, records pass/mismatch/error/timeout, and strips host-specific paths/timing noise from committed projections.
4. Build deterministic Markdown/JSON matrix formatting with documented-versus-demonstrated labels.
5. Add explicit npm scripts for corpus validation and report generation; do not add them to normal production startup.
6. Test that importing the production extension does not import any `scripts/shell-analysis-spike` module.
7. Run focused tests and `npm run check`.
8. Commit:

```bash
git commit -m "research: establish command matcher baseline"
```

### Task 3: Prototype and evaluate Tree-sitter candidates

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/shell-analysis-spike/adapters/tree-sitter-native.ts`
- Create: `scripts/shell-analysis-spike/adapters/tree-sitter-native.test.ts`
- Create if feasible: `scripts/shell-analysis-spike/adapters/tree-sitter-wasm.ts`
- Create if feasible: `scripts/shell-analysis-spike/adapters/tree-sitter-wasm.test.ts`
- Create: `scripts/shell-analysis-spike/tree-sitter-projection.ts`
- Create: `scripts/shell-analysis-spike/tree-sitter-projection.test.ts`

**Steps:**

1. Add candidate packages as development dependencies only.
2. Write failing projection tests from real parse trees for commands, lists, pipelines, subshells, redirects, quotes, substitutions, error/recovery nodes, and source spans.
3. Project only to the research model; never expose candidate node names as the stable interface.
4. Mark expansion/dynamic nodes unresolved rather than evaluating them.
5. Demonstrate executable positions versus comments, strings, heredoc bodies, and redirection targets.
6. Test parse-error/recovery behavior and bounded input size.
7. Attempt both native and WASM variants. If a variant cannot be made reproducible without product-inappropriate setup, record a demonstrated rejection instead of forcing it.
8. Run the complete corpus and commit adapter source plus sanitized results, not raw AST dumps.
9. Run `npm test`, `npm run check`, and `npm audit`.
10. Commit:

```bash
git commit -m "research: evaluate Tree-sitter shell structure"
```

### Task 4: Prototype the narrow tokenizer/analyzer comparator

**Files:**
- Create: `scripts/shell-analysis-spike/adapters/narrow-analyzer.ts`
- Create: `scripts/shell-analysis-spike/adapters/narrow-analyzer.test.ts`
- Modify development dependencies only if `shell-quote` is justified.

**Steps:**

1. Test the same corpus facts, with particular attention to quotes, escapes, operators, groups, redirects, and command substitutions.
2. Keep the implementation deliberately bounded. Do not add fixes fixture-by-fixture until it becomes an unreviewable shell parser.
3. Record unsupported syntax explicitly.
4. Measure code size and mismatch categories against Tree-sitter and baseline.
5. Reject the candidate if correctness requires recreating parser grammar or if inert/executable distinctions remain unreliable.
6. Run focused tests and full corpus.
7. Commit:

```bash
git commit -m "research: evaluate narrow shell analyzer"
```

### Task 5: Evaluate existing systems and `dcg` integration feasibility

**Files:**
- Create: `docs/research/shell-command-analysis-landscape.md`
- Create: `scripts/shell-analysis-spike/adapters/dcg-process.ts`
- Create: `scripts/shell-analysis-spike/adapters/dcg-process.test.ts`
- Create: `scripts/shell-analysis-spike/dcg-fixture.ts`

**Steps:**

1. Use primary sources and Perplexity where useful, clearly identifying source type and access date.
2. Document Claude Code permission segmentation, `dcg`, ShellCheck, Semgrep/Tree-sitter Bash, OpenAI Codex's approval/containment separation, and current Pi hook/package facts.
3. Pin the evaluated `dcg` commit/version. Clone/build only under an OS temp root; do not vendor it or require it for normal tests.
4. Validate `dcg` license, classify/robot protocol, output stability, rules/provenance, failure codes, missing-binary behavior, and Pi integration claims from source/tests.
5. Adapt its sanitized output to the research model without claiming it supplies BashGuard repository verification.
6. Run a representative and adversarial corpus subset, measuring cold/warm external-process cost.
7. Compare three reuse choices: runtime dependency, optional provider, or architectural/corpus reference plus possible upstream contribution.
8. Ensure missing `dcg` makes optional tests skip visibly while deterministic fixture-protocol tests still run in normal CI.
9. Commit:

```bash
git commit -m "research: compare existing command guard approaches"
```

### Task 6: Prototype bounded Git repository verification

**Files:**
- Create: `scripts/shell-analysis-spike/git-target.ts`
- Create: `scripts/shell-analysis-spike/git-target.test.ts`
- Create: `scripts/shell-analysis-spike/git-probe.ts`
- Create: `scripts/shell-analysis-spike/git-probe.test.ts`

**Steps:**

1. Test literal targeting interpretation for initial cwd, repeated `-C`, equals/separate `--git-dir` and `--work-tree`, quoted words from structural projection, missing values, expansions, and conflicting options.
2. Return `literal`, `candidate`, `verified`, or `unknown` evidence explicitly.
3. Implement a no-shell `execFile`/spawn argument-vector `git rev-parse` probe with `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, bounded output, abort signal, and deadline.
4. Use fresh disposable normal, nested, worktree, bare, symlink, missing, malformed, and permission-failure fixtures.
5. Canonicalize returned paths and record `/tmp` versus `/private/tmp` aliases without treating lexical mismatch as failure.
6. Prove timeout/missing Git/non-repository/inconsistent output produce distinct unknown states and never an allow decision.
7. Measure whether local p95 and hard-deadline targets are plausible.
8. Commit:

```bash
git commit -m "research: verify bounded Git target evidence"
```

### Task 7: Measure packaging, latency, and clean Pi installation

**Files:**
- Create: `scripts/shell-analysis-spike/benchmark.ts`
- Create: `scripts/shell-analysis-spike/benchmark.test.ts`
- Create: `scripts/shell-analysis-spike/package-smoke.ts`
- Create: `scripts/shell-analysis-spike/package-smoke.test.ts`
- Create: `docs/research/shell-analysis-spike-results.md`

**Steps:**

1. Benchmark adapters with warmup and bounded iterations; report p50/p95, cold initialization, error latency, and external process cost.
2. Record host/load/tool versions and label numbers local observations, not guarantees.
3. Measure dependency unpacked size, install scripts/native compilation, and memory where practical.
4. Generate a disposable package fixture with each plausible runtime candidate in `dependencies`; run `npm pack`, extract, `npm install --omit=dev`, and import/initialize it.
5. Pack BashGuard from the branch and load the clean extracted package with `pi -e`.
6. Exercise an isolated Pi install/config root without modifying real user settings, and prove Stage A adds no production authorization behavior or runtime dependency.
7. Sanitize every path and generated result before committing.
8. Produce a matrix comparing baseline, native Tree-sitter, WASM Tree-sitter, narrow analyzer, and `dcg` where available.
9. Commit:

```bash
git commit -m "research: measure shell analysis candidates"
```

### Task 8: Publish the architecture recommendation and Stage B plan

**Files:**
- Complete: `docs/research/shell-analysis-spike-results.md`
- Modify: `docs/product/roadmap.md`
- Modify: `docs/current-state.md`
- Modify: `docs/plans/2026-08-28-shell-aware-command-analysis-research-design.md`
- Create: `docs/plans/2026-08-28-shell-aware-command-analysis-stage-b-implementation.md`

**Steps:**

1. State which facts are documented versus demonstrated.
2. Select one architecture or no-go using correctness, UX, packaging, latency, maintenance, provenance, and failure evidence.
3. Record rejected candidates and counterevidence.
4. Define exact Stage B supported grammar, degraded behavior, stable event projection, prompt changes, compatibility, and rollout tests.
5. Preserve command-resolution limitations, boundary evidence rules, and #91 separation.
6. Keep #90 open and update its restart point to Stage B.
7. Run full tests, check, audit, and diff checks.
8. Commit:

```bash
git commit -m "docs: recommend shell analysis architecture"
```

### Task 9: Independent review and research PR

**Steps:**

1. Run:

```bash
npm test
npm run check
npm audit
git diff --check origin/main...HEAD
git status --short --branch
```

2. Run all explicit research scripts from a clean temporary output root.
3. Spawn independent OpenAI reviews for corpus expectation correctness, security/UX architecture, package evidence, Git probe behavior, and documentation claims.
4. Reproduce findings; add regression tests before valid fixes.
5. Push `research/shell-analysis`, open a PR referencing (not closing) #90, and include the demonstrated matrix and recommendation.
6. Merge only with no remaining Critical/Important issues and passing verification.
7. Update #90 with Stage A results and the exact Stage B restart document.
