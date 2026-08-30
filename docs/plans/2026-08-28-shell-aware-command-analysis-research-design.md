# Shell-Aware Command Analysis Research Design

**Status:** Approved for Stage A research

**Tracking:** [Issue #90](https://github.com/acheltenham/BashGuard/issues/90)

## Summary

Stage A will determine how BashGuard should replace temporary conservative command matching with shell-aware structural analysis and evidence-grounded Git repository targeting. It will not change production authorization behavior.

The research compares established approaches rather than inventing a shell parser: Claude Code's documented compound-command permission model, Destructive Command Guard (`dcg`), ShellCheck, Semgrep's Tree-sitter-derived Bash analysis, Tree-sitter Bash itself, and a narrow tokenizer/analyzer candidate. It evaluates whether BashGuard should embed a parser, integrate an existing analyzer, contribute upstream, or build only a small missing projection layer.

The product priority is user experience without weakened authorization: safe commands stay quiet and fast; protected commands cannot bypass existing checks because a new parser is incomplete; prompts emphasize the matched executable segment and verified or unknown target; parser details remain inspectable rather than noisy.

## Stage split

Issue #90 has two explicit stages:

1. **Stage A — research/design:** corpus, prototypes, packaging and performance measurements, recommendation, implementation migration plan. No production authorization change.
2. **Stage B — implementation:** selected analyzer, stable evidence projection, Git verification, CLI/UI migration, compatibility, and real-Pi validation.

The Stage A PR references but does not close #90. #90 closes only after Stage B satisfies the issue exit criteria.

## Goals

- define a narrow common shell grammar that materially improves executable-position analysis;
- distinguish executable shell structure from quoted or inert text where evidence supports it;
- preserve all material segments in chains, lists, and pipelines;
- identify explicit unknown and unsupported syntax rather than guessing;
- compare credible existing analyzers and parser foundations;
- test a parser-independent minimal BashGuard command representation;
- determine when Git repository identity can be called verified;
- define fast, bounded degraded behavior that preserves current protected-command coverage;
- measure packaging, portability, startup, safe-path, risky-path, and probe costs;
- produce a specific Stage B recommendation or a documented no-go.

## Non-goals

Stage A does not:

- change `tool_call` authorization, prompts, event schemas, or shipped rules;
- add a public parser or authorization plugin API;
- implement full Bash, Zsh, Fish, PowerShell, or active-shell dialect switching;
- execute observed commands, expansions, substitutions, aliases, functions, or sourced files;
- claim original-model input, final runtime argv, final child cwd, or universal resolution;
- add persistent approvals, policy configuration, new risk rules, containment, or recovery;
- make `dcg`, Tree-sitter, or any external binary a production dependency.

## Product and UX contract

Any Stage B recommendation must preserve these requirements:

- **Safe commands remain quiet.** Parse or probe failure alone never prompts for an otherwise unmatched safe command.
- **Protected commands do not regress.** If structural analysis is unavailable but the existing matcher detects a protected command, BashGuard continues requiring approval and labels the evidence degraded/textual.
- **No model call occurs in authorization.** Analysis remains deterministic.
- **No command is executed during parsing.** Repository verification uses only a bounded, argument-vector Git probe after a relevant structural match.
- **Repository verification is conditional.** Failure becomes `unknown`; it does not become a false repository claim or an automatic allow.
- **One observed tool call still receives one decision.** All matches and material segments are summarized in that prompt.
- **Prompts remain concise.** Show full observed input, emphasize matched segment(s), wrapper chain, and verified/unknown target. Parser diagnostics belong in inspectable evidence.
- **No parser-specific AST is persisted.** Recorded evidence uses a stable BashGuard projection.
- **Authorization is not containment.** Later handlers, replacement tools, shell runtime, and descendants remain outside the claim.

## Supported grammar target

The spike targets a common shell structure sufficient for current authorization rules:

- simple commands and words;
- executable command positions;
- single and double quotes and backslash escapes;
- leading environment assignments;
- a fixed, reviewed wrapper set;
- lists separated by newline, `;`, `&&`, `||`, and `&`;
- pipelines using `|` and `|&`;
- grouped commands and subshell boundaries;
- redirects as distinct syntax with literal or unresolved targets;
- Git global options and quoted path words.

The following remain unresolved/unsupported unless the parser can represent them without execution:

- parameter, arithmetic, pathname, tilde, brace, and command-substitution results;
- aliases and shell functions;
- sourced-file contents;
- `eval` and dynamically generated scripts;
- interpreter strings such as `bash -c`, Python/Node one-liners, and remote scripts beyond literal bounded recursion;
- process substitution, coprocesses, and shell-specific extensions outside the selected common subset;
- runtime `PATH`, executable identity, child processes, and effects.

Unsupported does not mean silently safe. It is explicit analysis evidence, and current textual checks remain the protected-command fallback.

## Prior art and candidate approaches

### Claude Code permission segmentation

Claude Code's official permission documentation establishes useful UX patterns:

- split recognized shell operators and evaluate each subcommand;
- use a fixed wrapper list rather than arbitrary wrapper inference;
- treat unparseable commands conservatively;
- distinguish redirection target permission from command permission;
- keep authorization and sandboxing separate.

This is a behavioral reference, not reusable source code.

### Destructive Command Guard (`dcg`)

`dcg` is the closest open-source product analogue. It supports destructive Git/shell checks and a Pi extension bridge. Its documented design uses relevance screening, lexical/context classification, command segmentation, bounded embedded-script analysis, stable rules, explicit indeterminate/fallback states, and performance budgets.

Stage A evaluates:

- invoking its robot/classify protocol as an optional analyzer;
- rule/version/provenance quality;
- startup and per-call process cost;
- install/update/failure behavior;
- whether its broad policy can be constrained without conflicting with BashGuard ownership;
- whether reusable components or upstream contributions are preferable to a runtime dependency;
- its adversarial corpus and architecture as reference material.

No external binary becomes required in Stage A.

### ShellCheck

ShellCheck demonstrates parser → AST → stable analysis → diagnostics separation and provides mature shell fixture concepts. Its implementation is not a production dependency for BashGuard; licensing, Haskell runtime, lint scope, and process cost make direct embedding unsuitable unless evidence overturns that assumption.

### Semgrep and Tree-sitter Bash

Semgrep demonstrates Tree-sitter-derived syntax → normalized representation → structural rules. Tree-sitter Bash is the leading embedded parser candidate because it represents lists, pipelines, subshells, redirections, and substitutions without execution.

Stage A must measure:

- Node native binding versus WASM packaging;
- Pi's production dependency installation path (`npm install --omit=dev`);
- jiti/TypeScript extension loading compatibility;
- package size and install-script/native-build requirements;
- macOS and Linux feasibility;
- parse error/recovery-node behavior;
- cold/warm latency and memory;
- AST stability versus the BashGuard projection boundary.

### Narrow tokenizer/analyzer

A tokenizer plus deliberately narrow structural analyzer is the smaller comparison candidate. It may be acceptable only if the corpus demonstrates reliable quoting, operator, grouping, wrapper, and redirection behavior without recreating a shell parser. Its main purpose is to test whether Tree-sitter's packaging cost buys material correctness.

### Shell subprocess validation

`bash -n`-style validation is expected to be rejected: it is dialect/platform dependent and does not expose a useful structured representation. The spike records evidence rather than assuming this conclusion.

## Parser-independent research projection

Candidate adapters project into a research-only shape equivalent to:

```text
ShellAnalysis
  status: structured | degraded | unsupported | failed
  parser: candidate identity and version
  segments[]
  diagnostics[]

CommandSegment
  index and source span
  relation to neighbors: list | and | or | pipe | background | group
  kind: simple | assignment | redirect | group | subshell | dynamic | unknown
  observed executable word, when literal
  recognized wrapper chain
  observed words/spans, without expansion claims
  redirections with literal/unknown targets
  unresolved constructs
```

The exact TypeScript research model is selected before candidate adapters. It preserves source spans and literal evidence, not a parser's node names. Stage A records only sanitized fixture projections.

## Wrapper policy

The corpus distinguishes:

- transparent candidates such as `command`, `builtin`, `env`, `timeout`, `time`, `nice`, `nohup`, and `stdbuf`;
- query/non-execution forms such as `command -v`;
- option-sensitive wrappers such as `xargs`;
- environment runners such as `direnv exec`, `mise exec`, `devbox run`, and `docker exec`;
- privilege or identity-changing wrappers such as `sudo` and `su`;
- dynamic sinks such as `eval`, `bash -c`, `find -exec`, and interpreter `-c` forms.

Stage A does not assume every wrapper is transparent. Each recognized wrapper needs deterministic argument-boundary evidence and a documented effect on cwd, environment, identity, or executable interpretation. Ambiguous wrappers remain explicit and fall back conservatively.

## Git repository verification

Repository identity can be labelled verified only when all required evidence agrees:

1. structural analysis identifies a relevant literal Git command segment;
2. Git global targeting options can be interpreted without expansion;
3. the initial cwd and literal target produce a bounded candidate path;
4. a no-shell, argument-vector Git probe such as `git rev-parse` succeeds under a strict timeout;
5. returned worktree and Git-directory paths canonicalize successfully and satisfy expected relationships.

The prototype uses fresh disposable repositories, worktrees, bare repositories, nested directories, symlink aliases, missing paths, permission failures, malformed options, `--git-dir`, `--work-tree`, and sequential `-C` options.

Probe requirements:

- use `execFile`/argument vectors, never shell interpolation;
- set `GIT_TERMINAL_PROMPT=0` and `GIT_OPTIONAL_LOCKS=0`;
- pass an abort signal and strict deadline;
- bound stdout/stderr;
- classify timeout, missing Git, non-repository, invalid path, permission failure, and inconsistent output separately;
- never turn probe failure into proof that no repository exists;
- never let repository verification determine whether an already matched destructive command is allowed.

Stage A will verify whether `git rev-parse` has acceptable read-only behavior and identify residual configuration/symlink/TOCTOU limitations.

## Degraded behavior

Candidate results are compared against the current matcher:

- structured match: use structural segment evidence;
- structured no-match: safe for the current protected rules only when corpus coverage supports it;
- unsupported/failed plus current textual match: require approval with degraded textual evidence;
- unsupported/failed with no current textual match: preserve current behavior and emit no prompt;
- Git probe failure after a structural match: keep approval requirement; repository identity is unknown.

Stage A does not change current behavior. These are proposed Stage B semantics requiring review.

## Fixture matrix

The sanitized corpus includes positive, negative, degraded, and unsupported expectations for:

- current recursive deletion and destructive Git forms;
- quoted dangerous text, comments, `printf`, and heredoc data;
- escaped spaces and quoted paths;
- chains, lists, pipelines, background commands, and newlines;
- groups and subshells;
- leading assignments and fixed wrappers;
- redirections and here-documents;
- Git global options, sequential `-C`, `--git-dir`, `--work-tree`, and `-c`;
- path names containing operation words and option-like characters;
- aliases/functions represented as unknown runtime identity;
- `eval`, `source`, substitutions, `bash -c`, interpreter `-c`, `xargs`, and `find -exec`;
- malformed syntax and parser recovery/error nodes;
- long commands and bounded-resource failures;
- every relevant scenario from Command Resolution Spike 2.

Fixtures are synthetic and contain no local secrets or repository names. Expected results distinguish syntax fact, literal evidence, inference, degraded evidence, and runtime unknown.

## Performance and packaging evaluation

The spike measures, on a documented local environment:

- cold adapter initialization;
- warm safe-command p50/p95;
- warm compound/risky-command p50/p95;
- Git probe success/failure/timeout latency;
- process-spawn cost for external analyzers;
- package install time, unpacked size, native compilation, and production-install compatibility;
- clean `npm pack` plus `npm install --omit=dev` behavior;
- clean Pi package loading through both `pi -e <packed/extracted-package>` and an isolated `pi install` data/config root;
- memory delta where practical.

Initial UX targets for recommendation:

- ordinary in-process warm analysis should remain below perceptible interactive latency, provisionally p95 ≤ 10 ms for representative commands;
- a relevant Git probe should provisionally complete p95 ≤ 150 ms locally with a hard deadline no greater than 500 ms;
- external process startup must demonstrate a compelling correctness/maintenance advantage to justify per-call latency;
- candidate failure must be bounded and produce deterministic degraded evidence.

These are local decision thresholds, not product performance guarantees.

## Research implementation layout

All Stage A code stays outside production authorization modules, under a dedicated research path such as:

```text
scripts/shell-analysis-spike/
  model.ts
  corpus.ts
  adapters/
  git-probe.ts
  benchmark.ts
  report.ts
```

Research commands are explicit npm scripts and are not run from BashGuard's production extension. Candidate dependencies remain development-only during Stage A. No prototype import is allowed from `src/` or `extensions/`.

Raw generated outputs remain under `/tmp` or ignored paths. The committed result is a sanitized deterministic report and source corpus.

## Validation

- unit-test corpus schema, expectation completeness, projections, and report generation;
- run every adapter against the same corpus;
- compare every result with the current matcher baseline;
- test malformed/error/timeout paths;
- build a disposable candidate package fixture that places each plausible runtime parser in `dependencies`, then run `npm pack`, extract/install it with `npm install --omit=dev`, and prove its extension can import and initialize the candidate;
- load the packed/extracted BashGuard package with `pi -e` and test an isolated `pi install`/configured-package startup path, without changing the user's real Pi settings;
- run a clean Pi package smoke proving Stage A adds no production extension behavior and no research-only dependency leaks into the shipped extension;
- use disposable Git repositories for probe scenarios;
- independently review the corpus expectations and final recommendation;
- use Perplexity and primary sources for landscape research, and distinguish documentation from demonstrated local evidence.

## Deliverables

Stage A lands:

- this approved design;
- reproducible sanitized fixture corpus;
- candidate adapters/prototypes isolated from production;
- bounded Git verification prototype;
- benchmark and package-install evidence;
- comparative landscape with primary-source links;
- sanitized result matrix;
- architecture decision and Stage B migration plan;
- explicit rejected alternatives and residual limitations;
- updated roadmap/current-state restart point without claiming production support.

## Success criteria

Stage A is complete when:

- the same corpus exercises all candidates and current baseline;
- executable positions, inert text, compounds, wrappers, redirections, dynamic constructs, and Git target failures have explicit expected evidence;
- parser/package/runtime failure behavior is demonstrated rather than assumed;
- Git verification has measured bounded success and degraded states;
- user-visible latency and prompt implications are evaluated;
- a specific architecture is recommended or rejected with evidence;
- production authorization remains byte-for-byte behaviorally unchanged;
- #90 remains open with a concrete Stage B implementation plan;
- #91 remains separate and no public provider/plugin API is introduced.
