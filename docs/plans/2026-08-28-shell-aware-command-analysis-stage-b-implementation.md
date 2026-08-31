# Shell-Aware Command Analysis — Stage B Implementation Plan

**Status:** Deferred restart point
**Tracking:** [Issue #90](https://github.com/acheltenham/BashGuard/issues/90)
**Last updated:** August 31, 2026

This is the only acceptable Stage B shape if later evidence reverses the current no-production-adoption decision. It does not change production authorization behavior today. #90 stays open until Stage B satisfies its exit criteria. #91 stays separate and no public provider/plugin API is introduced.

## Invariants

- No model calls in authorization.
- No runtime tracing.
- No general policy language.
- No public parser-specific AST.
- No public provider/plugin API.
- No full AST persistence.
- Authorization is not containment.
- Prompts must say **observed command**, not universal resolved command.

## Supported grammar

Stage B may only claim support for a narrow common shell subset that materially improves executable-position analysis:

- simple commands and word lists;
- executable command positions;
- single and double quotes, plus backslash escaping;
- leading environment assignments;
- a fixed, reviewed wrapper set;
- lists separated by newline, `;`, `&&`, `||`, and `&`;
- pipelines using `|` and `|&`;
- grouped commands and subshell boundaries;
- redirects as distinct syntax with literal or unresolved targets;
- Git global options and quoted path words.

The following remain unsupported or explicitly unresolved unless the chosen adapter can represent them without executing anything:

- parameter, arithmetic, pathname, tilde, brace, and command-substitution expansion;
- aliases and shell functions;
- sourced-file contents;
- `eval` and dynamically generated scripts;
- interpreter strings such as `bash -c`, Python/Node `-c`, and remote scripts;
- process substitution and coprocesses;
- runtime `PATH`, executable identity, child-process argv/cwd, and side effects.

Unsupported does not mean silently safe. It means explicit analysis evidence and degraded fallback.

## Parser-independent minimal projection

All supported adapters must project into the same stable BashGuard IR. Parser details stay inspectable, not persisted as product state.

```text
ShellAnalysis
  status: structured | degraded | unsupported | failed
  parser: { kind, version }
  segments[]
  diagnostics[]

CommandSegment
  id, span
  relation: list | and | or | pipe | background | group | subshell
  kind: simple | assignment | redirect | wrapper | executable | inert | dynamic | unknown
  literal: observed text only
  wrappers: known wrapper chain, when directly evidenced
  redirections: literal or unresolved target notes
  unresolved: explicit unknown constructs
```

The IR must preserve source spans and literal evidence, not parser node names.

## Degraded fallback

- Safe commands stay quiet.
- If structure is unavailable but the current textual matcher still sees a protected command, BashGuard must keep the existing approval behavior and label the evidence degraded/textual.
- If structure is available but a Git identity probe fails, the target stays `unknown`; failure never becomes an allow decision or a false repository claim.
- If neither structure nor a protected textual match exists, BashGuard stays quiet.
- One observed tool call still receives one decision.

## Git verification

Git verification is only allowed after a relevant structural destructive-Git match.

Required shape:

- use `execFile` / argument-vector `git rev-parse` only;
- no shell interpolation;
- set `GIT_TERMINAL_PROMPT=0` and `GIT_OPTIONAL_LOCKS=0`;
- use an abort signal and a hard deadline;
- bound stdout/stderr;
- canonicalize returned paths;
- classify timeout, missing Git, non-repository, invalid path, permission failure, and inconsistent output separately;
- never let probe failure rewrite the approval decision;
- never infer that a failed probe proves no repository exists.

Repository identity is `verified` only when the literal structural evidence, current cwd, and bounded probe all agree. Otherwise it is `literal`, `candidate`, or `unknown`.

## Prompt and event compatibility

Prompts should remain concise and should show:

- the observed command;
- known wrappers or prefixes, when directly evidenced;
- the working directory;
- the matched protected check(s);
- whether repository identity is verified or unknown;
- the explicit limitation that later handlers, replacement tools, and shell runtime may still change execution.

Event compatibility requirements:

- preserve `matchedCheck` for legacy readers;
- continue populating `matchedChecks` for multi-match decisions;
- keep `command.requested`, `command.evaluated`, `command.approval_requested`, `command.approved`, `command.declined`, and `command.blocked` compatible with the current projections;
- do not change the meaning of existing evidence labels.

## Performance and package gates

Stage B is blocked unless the chosen analyzer can meet all of these gates in local repeatable smokes:

- safe-command latency remains effectively quiet; do not regress the current matcher's near-zero safe path into visible lag;
- protected-command evaluation stays comfortably interactive;
- Git target probing stays bounded and below the current local p95 evidence band;
- production install works through `npm install --omit=dev` and the Pi package smoke;
- offline Pi startup is demonstrated, not assumed;
- the mandatory runtime dependency story does not depend on an unproven 20 MB grammar package unless a smaller install path is proved first.

The current `tree-sitter-bash` footprint is the working warning sign here, not a target to ignore.

## Rollout tests

Stage B should not ship until all of the following pass:

- corpus validation for every supported and unsupported fixture;
- protected textual fallback tests when structure is degraded or unsupported;
- safe-command quiet tests;
- Git probe tests on fresh disposable repos, nested repos, worktrees, bare repos, symlink aliases, missing paths, malformed options, and permission failures;
- old/new decision event compatibility tests for attach, inspect, filters, and debrief;
- package smoke for the production package and any candidate package;
- real-Pi validation that keeps authorization behavior stable while adding no model calls, no runtime tracing, and no public API.

## Exit criteria

Stage B only succeeds if it can prove all of the following:

- exact supported grammar is documented and covered by tests;
- degraded fallback preserves current protected textual matches;
- safe commands remain quiet;
- structural destructive-Git matches can be verified with bounded probe evidence;
- probe failure yields `unknown`, not a false repository claim;
- prompt and event wording stay compatible with current readers;
- performance and package gates are met on the default local install path;
- #90 can close without introducing #91 or any public provider/plugin API.
