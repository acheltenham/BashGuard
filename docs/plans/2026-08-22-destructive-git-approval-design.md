# Destructive Git Approval Design

**Status:** Approved for implementation

**Tracking:** [Issue #89](https://github.com/acheltenham/BashGuard/issues/89)

## Summary

Phase 3 Slice 2 adds one-time in-Pi approval for agent-initiated Bash tool calls whose BashGuard-observed command conservatively matches either `git reset --hard` or forced `git clean`. It also migrates the existing recursive forced-deletion rule into a small typed static rule registry.

The registry makes built-in authorization checks straightforward to add and test without introducing external policy loading, persistent approvals, or a generic policy engine. One Run once or Decline decision covers the complete BashGuard-observed tool call and lists every rule matched by that call.

Authorization remains distinct from containment. BashGuard asks Pi to block the supported tool call; it does not provide an operating-system boundary or claim that the observed command is the universal resolved command.

Implementation on this branch is complete; the validation record documents the real no-UI block, combined decline, reset Run once success, safe Git pass, the dogfood matcher false negative fix, the `run_once` redaction fix, and the incomplete post-fix interactive forced-clean Run once caused by environmental PTY/model stalls.

## Goals

- require one-time approval for `git reset --hard` and forced `git clean` variants;
- recognize direct invocations and common Git global targeting options;
- preserve safe Git workflows without approval prompts;
- support multiple rule matches in one observed Bash tool call with one decision;
- migrate recursive forced deletion to the same typed registry without changing its user-visible behavior;
- keep old scalar decision evidence readable while adding structured multi-match evidence;
- preserve a narrow provider seam for later plugin research;
- ground every prompt, event, and CLI statement in evidence BashGuard actually has.

## Non-goals

This slice does not add:

- approval for rebase, force push, user `!` commands, file tools, replacement tools, aliases, child processes, or commands outside supported Pi hooks;
- shell-aware parsing or a universal resolved-command claim;
- verified repository identity, canonical path resolution, or filesystem inspection during evaluation;
- persistent approvals, always-allow policy, project configuration, custom rules, or a policy language;
- external provider/plugin loading;
- automatic activation of AI-generated rules;
- checkpoints, restore workflows, sandboxing, network policy, or operating-system containment.

## User-visible behavior

### Supported Git checks

Two independent built-in checks have stable identities:

- `git-reset-hard`: may discard tracked working-tree and index changes;
- `git-clean-forced`: may permanently delete untracked files and, when requested, directories.

They share a broader local destructive Git risk category but retain separate reason and impact text.

Supported forms include ordinary direct commands and commands using common Git targeting options, for example:

```bash
git reset --hard
git reset --hard HEAD~1
git clean -f
git clean -fd
git clean -xdf
git clean --force -d
git -C other/repo reset --hard
git --git-dir=.git --work-tree=. clean -fd
```

Safe forms such as `git reset`, `git reset --soft`, `git clean -n`, `git clean --dry-run`, `git status`, and `git diff` remain non-blocking.

### Compound and multi-rule calls

Approval covers the entire BashGuard-observed Bash tool call. A call such as:

```bash
npm test && git reset --hard && git clean -fd
```

produces one prompt that displays the full observed command and both matched Git checks. Run once permits that complete tool call; Decline blocks it. BashGuard does not split, rewrite, or partially authorize shell text.

A call that also contains recursive forced deletion similarly receives one prompt listing all matches.

### Prompt

The prompt shows:

- the complete command input observed by BashGuard's handler;
- current working directory;
- every matched check and potential impact;
- literal `-C`, `--git-dir`, and `--work-tree` evidence when found;
- that one decision covers the whole displayed tool call;
- that later handlers, replacement tools, and shell runtime behavior may change what executes.

The prompt does not describe literal targeting text as a canonical repository or resolved path.

## Architecture

### Rule provider seam

Authorization uses a narrow synchronous provider boundary:

```text
StaticAuthorizationRuleProvider
  -> AuthorizationEvaluator
  -> Shared authorization lifecycle
```

The initial provider returns three immutable built-in rules in deterministic order:

1. `recursive-forced-deletion`
2. `git-reset-hard`
3. `git-clean-forced`

The provider seam is not a public plugin API in this slice. It exists so future research can evaluate Pi package providers, project policies, or human-reviewed AI-assisted rule proposals without coupling rule discovery to decision orchestration.

### Rule shape

Each typed rule supplies:

- stable rule ID;
- rule version;
- provider identity;
- risk category;
- reason;
- potential impact;
- pure matcher;
- optional literal evidence extracted from the observed command.

Matchers receive the BashGuard-observed command and working directory. They perform no filesystem access, model calls, or asynchronous work.

### Evaluation

The evaluator runs rules in provider order and gathers every match rather than stopping at the first. Unsupported tools, malformed Bash input, and calls with no matches remain allowed without authorization events.

An approval evaluation contains a structured `matchedChecks` array. For compatibility, the existing `matchedCheck` field remains populated with the first matched check. Readers accept both older scalar-only events and newer structured events.

### Shared lifecycle

Rules describe matches; they do not prompt, record, or decide. The shared orchestrator continues to own:

- one Run once/Decline interaction;
- unavailable-UI and UI-failure blocking;
- event ordering;
- decision recording;
- persistence-failure behavior;
- duplicate-recorder inertness;
- command-identity limitations.

This prevents rule additions from duplicating safety-critical lifecycle code.

## Matching model and limitations

Matching remains conservative and textual, consistent with Slice 1. Git matchers identify a `git` command segment, permit intervening global options, and then identify:

- `reset` with `--hard`; or
- `clean` with `--force` or a short-option group containing `f`.

Matching stops at ordinary shell command boundaries where practical. It does not claim complete knowledge of quoting, aliases, functions, substitutions, sourced configuration, expansion, later extension mutation, replacement tools, child processes, or runtime argv.

This can over-prompt on quoted or otherwise non-executed Git text. It can also miss unsupported runtime forms. The approval surface must state what BashGuard observed rather than implying complete shell interpretation.

Shell-aware parsing and verified repository targeting are required follow-up work, tracked in [issue #90](https://github.com/acheltenham/BashGuard/issues/90). The limitation must remain visible in the roadmap and current-state documentation until that work lands.

## Decision evidence

Every new decision event includes, where available:

- `matchedCheck`: first rule ID for backward compatibility;
- `matchedChecks`: ordered structured matches;
- rule ID, version, and provider;
- risk category, reason, and potential impact;
- literal targeting-option evidence;
- observed command and working directory;
- decision source and command-identity limitations.

Event order remains:

Approval:

```text
tool.requested
command.evaluated
command.approval_requested
command.approved
```

Decline:

```text
tool.requested
command.evaluated
command.approval_requested
command.declined
command.blocked
```

Unavailable UI omits `command.approval_requested` because no prompt was shown and records `command.blocked` after evaluation.

Recursive-deletion-only calls retain existing exact block wording where compatibility requires it. Git-only and multi-rule decisions use accurate combined wording.

## Failure behavior

- Decline blocks the complete tool call.
- Missing or failed approval UI blocks conservatively.
- A built-in provider or matcher exception visibly blocks the Bash tool call as an authorization evaluation failure and records that cause when possible.
- Recording failure never reverses a user decision.
- A duplicate extension instance that does not own the recorder lock neither evaluates, prompts, nor blocks.
- Safe and unsupported calls do not emit authorization decision events.

These are Pi tool-call controls, not proof of operating-system containment or downstream prevention.

## CLI projection

Attach, inspect, browser detail, risk/tool filters, and debrief render all structured matches when present and retain compatibility with old scalar events. Output distinguishes:

- observed command;
- literal targeting options;
- matched checks and impacts;
- user decision or conservative block cause;
- command-identity limitations;
- tool completion evidence when recorded.

A blocked decision closes outstanding attach activity. An approved call remains pending until tool completion or another terminal decision event is recorded.

## Testing strategy

Implementation follows TDD and covers:

- provider order, stable metadata, and migration of recursive deletion;
- direct and globally targeted Git variants;
- combined and long force flags;
- safe reset, dry-run clean, and routine Git commands;
- documented quoted-text and unsupported-runtime limitations;
- single-rule and multi-rule evaluations;
- one prompt containing every match;
- backward compatibility for scalar-only events;
- Run once, decline, unavailable UI, UI failure, matcher failure, recorder failure, and duplicate ownership;
- extension-writer-to-CLI-reader integration;
- attach, inspect/browser, filters, and debrief projections.

Real-Pi tests use fresh disposable repositories with committed, modified, and untracked sentinel files. Decline and unavailable UI must preserve every sentinel. Run once may alter only the isolated repository and must record completion evidence. No validation targets a repository containing valuable data.

## Documentation and delivery

Delivery updates:

- README and changelog;
- current state, roadmap, and relevant requirements;
- architecture overview and event model;
- capability matrix;
- evidence-filtering guidance;
- release and smoke-test checklists;
- BashGuard skill guidance;
- a dedicated real-Pi validation record;
- the explicit deferred-work ledger.

Independent review and full test, type-check, audit, and diff verification are required before merge.

## Future provider and AI-assisted rule work

Rule-provider/plugin feasibility is tracked in [issue #91](https://github.com/acheltenham/BashGuard/issues/91). Slice 2 does not commit to a public API.

The governing principle is:

- AI may propose a rule, examples, rationale, and tests;
- a human must review and explicitly enable every persistent rule before enforcement;
- active rules remain deterministic, versioned, inspectable, and attributable;
- no model call occurs in the authorization path by default.

## Explicitly deferred work

The Slice 1 deferred ledger remains in force. Slice 2 additionally keeps visible:

- shell-aware parsing and executable-position analysis;
- verified Git repository and canonical target resolution;
- Git aliases, shell aliases/functions, wrappers, substitutions, expansion, and child processes;
- approval for rebase, force push, and other Git operations;
- target-resource extraction beyond literal evidence;
- external providers/plugins and a provider trust model;
- AI-assisted proposals beyond research, review, and explicit enablement;
- persistent policy lifecycle and custom configuration;
- checkpoints, recovery, sandbox/network controls, and downstream authorization.

The parsing/resolution work is tracked in #90 and provider/plugin research in #91. These links must remain in roadmap/current-state documentation when Slice 2 is marked complete.

## Success criteria

Slice 2 is complete when:

- both Git checks request one-time approval for supported observed forms;
- one prompt lists every rule matched by the complete observed tool call;
- Run once, decline, unavailable UI, and UI failure behave conservatively and are grounded in recorded evidence;
- recursive forced deletion uses the same registry without behavior regression;
- old and new decision events render correctly;
- safe Git workflows remain non-blocking;
- direct/global-option, multi-match, integration, and disposable real-Pi validation pass;
- no output claims universal resolution, verified repository identity, containment, or recovery;
- #90 and #91 remain linked as explicit follow-up work.
