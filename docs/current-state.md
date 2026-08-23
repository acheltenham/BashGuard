# BashGuard current state

**Status:** Work in progress / Milestone 0 complete; Phase 3 in progress

BashGuard is an early-stage, local-first Pi companion. It is useful for observing and investigating recorded Pi sessions, but it is not yet a complete command guard, approval system, sandbox, recovery system, or security control.

**Current development focus:** Boundary Reporting Slice 1, Command Resolution Spike 2, the split-pane event browser, and Phase 3 Slice 1 recursive forced-deletion approval are complete. Phase 3 Slice 2 is now explicitly selected under [issue #89](https://github.com/acheltenham/BashGuard/issues/89): the approved [destructive Git approval design](plans/2026-08-22-destructive-git-approval-design.md) adds narrow `git-reset-hard` and `git-clean-forced` checks through a typed static registry. Stronger shell-aware matching and verified Git targeting remain required follow-up work in [#90](https://github.com/acheltenham/BashGuard/issues/90); provider/plugin and human-reviewed AI policy research is tracked in [#91](https://github.com/acheltenham/BashGuard/issues/91). The [Slice 1 deferred-work ledger](plans/2026-08-22-recursive-delete-approval-design.md#explicitly-deferred-work) remains authoritative for other work not included. See the [roadmap's current execution sequence](product/roadmap.md#current-execution-sequence) for the authoritative restart point.

## Available today

When the BashGuard Pi extension is loaded before a session starts:

- records supported Pi lifecycle, prompt, turn, tool, shell, user-bash, read, edit, write, Git snapshot, and shutdown events;
- stores the event stream locally as append-only JSONL;
- uses a per-session ownership lock so redundant BashGuard extension instances do not record duplicate events;
- discovers active and completed BashGuard-recorded sessions;
- selects sessions interactively for selector-less `attach`, `inspect`, and `debrief` when multiple candidates exist and both stdin and stdout are TTYs; a sole eligible session is automatic, while explicit current-snapshot selectors and exact-only `--session-id` values bypass the picker;
- follows a session from another terminal with `bashguard attach`; supported active TTYs print the header, bounded narrated history, and guidance before an adaptive evidence-grounded sticky footer, while every new narrated event still appears above the redrawn footer;
- inspects individual events by sequence or event ID prefix;
- opens an opt-in `inspect --browse` snapshot browser with wide split panes, narrow list/detail replacement, keyboard navigation, interactive activity/search controls, explicit reload, and a durable selected-event command after terminal restoration;
- filters recorded evidence by activity category, exact event type, and case-insensitive text search, with latest-N/all controls and JSONL export;
- reports missing, redacted, truncated, and capture-gap evidence;
- produces active or completed-session debriefs;
- provides a complementary Pi skill so users can ask Pi to list, inspect, and debrief the recorded evidence from inside a Pi session;
- reports through `bashguard boundary` when no supported containment backend was detected in the current environment, with `unknown` evidence and an explicit outer-boundary limitation;
- requires one-time in-Pi approval for agent-initiated `bash` tool calls whose BashGuard-observed command matches the recursive forced-deletion check; Run once allows that call, while decline, unavailable UI, or confirmation failure returns Pi's block result;
- records and projects evaluated, approval-requested, approved, declined, and blocked authorization evidence through attach, inspect/browser, filters, and debrief;
- shows observation-only risky-command notices for the other current risk patterns;
- reports observed file-tool activity without inferring create, overwrite, or delete impact;
- compares session-start and shutdown Git snapshots;
- shows direct path overlap between changed Git files and observed file-tool events with confidence labels;
- summarizes recorded GitHub shell activity and provider-neutral recorded shell activity.

All narrative output is grounded in recorded local events. BashGuard does not live-query GitHub, deployment providers, or other remote systems during debriefing.

## Important limitations

- BashGuard cannot attach retroactively to older Pi sessions that were not recorded by the extension; the extension and skill must be loaded before the Pi session starts.
- Capture can be partial because Pi hooks, event fields, output, or storage writes may be unavailable.
- If BashGuard is loaded from more than one package source, only the first instance records. Other instances warn and remain inactive; remove the redundant source and start a new Pi session. `bashguard doctor` can flag multiple sources visible in `pi list`, but it does not claim configured sources are active runtime instances.
- Git and file correlations are session-level or path-overlap evidence, not proof of causality.
- Only the recursive forced-deletion rule is approval-gated. Other current risk patterns remain non-blocking review notes.
- BashGuard does not and will not implement containment. It does not sandbox commands, restrict the filesystem, or restrict the network; that is the job of a sandbox backend such as Pi's first-party sandbox example. BashGuard describes and reports detectable boundaries rather than enforcing them. See [Decision 005](adr/decision-log.md).
- The first `bashguard boundary` slice recognizes only the no-supported-backend-detected case. It does not yet inspect Anthropic sandbox runtime configuration, observe backend decisions, record session-time boundary evidence, or add boundary claims to debriefs.
- `bashguard boundary` describes the current environment, not a historical session. BashGuard runs inside whatever boundary exists and cannot characterize an outer container or VM from within, so it reports `none detected · unknown` rather than claiming no containment exists. Its full-user-permission warning is explicitly conditional on there being no outer boundary.
- Approval covers the command input visible when BashGuard's handler runs, not a universal resolved command. There is no complete pre-execution resolved-command preview yet. Spike 2 proved that BashGuard currently records the mutable command visible when its `tool_call` handler runs: earlier handlers may already have changed it, later handlers may still change execution, replacement tools can add internal wrappers, and shell runtime determines expansion and child-process behavior. See the [Spike 2 results](research/command-resolution-spike-results.md).
- There are no additional shipped approval rules yet, persistent/always-allow policy, user `!` or file-tool authorization, safer-command mutation, recovery/restore workflow, event replay, hosted browser UI, cloud service, or multi-harness support. Replacement tools, later-handler mutations, shell expansion, child processes, sandbox/network policy, and downstream authorization remain outside Slice 1. Slice 2 Git checks are designed but not yet available. See the [Slice 1 deferred-work ledger](plans/2026-08-22-recursive-delete-approval-design.md#explicitly-deferred-work), [Slice 2 design](plans/2026-08-22-destructive-git-approval-design.md#explicitly-deferred-work), shell/parser follow-up [#90](https://github.com/acheltenham/BashGuard/issues/90), and provider/plugin research [#91](https://github.com/acheltenham/BashGuard/issues/91).
- The `inspect --browse` terminal browser is opt-in and snapshot-only: it never silently follows an active session, and `r` is required to reload. It requires TTY input/output, a non-dumb `TERM`, and at least eight rows; unsupported explicit use exits nonzero with plain command alternatives and no browser ANSI. Plain inspect and JSONL behavior remain unchanged. The active attach footer remains a separate non-alternate-screen surface.
- Selector-less attach considers active sessions first and offers only active rows when any are active; with no active sessions, all discovered completed sessions become candidates. Selector-less inspect and debrief consider all discovered recorded sessions. Non-TTY scripts, pipes, and redirected output never prompt because both stdin and stdout must be TTYs; ambiguity exits nonzero with eligible rows and durable exact `--session-id=<full-session-id>` commands. Automation that allocates a PTY is interactive by contract and must pass an explicit selector to avoid waiting for input. Positional and `--session` numbers/prefixes resolve against the current discovery snapshot; `--session-id` matches only the complete metadata ID and is the durable automation form.
- In supported active TTY mode, accepted event changes update the footer immediately and idle freshness updates at about a one-second cadence. An unmatched correlated request is labelled `awaiting completion evidence`, not asserted to be executing. Capture limitations use compact recorded counts. The layout uses terminal display-cell measurement and grapheme-aware truncation: 72+ columns has three content lines, 40–71 up to four, and below 40 one line.
- Completed sessions, non-TTY output, redirected output, missing `TERM`, `TERM=dumb`, and `--no-live-footer` keep the ordinary completed/plain status presentation and emit no footer-generated ANSI or cursor-control sequences. Resize clears and redraws the footer; recorded shutdown clears it and prints a final ordinary completed block. `Ctrl+C` and synchronous/unaccepted ordinary errors clear the temporary footer and scoped handlers. Any accepted write failure makes stream, cursor, and visible-footer state unknowable, so BashGuard disables the footer, removes scoped handlers/listeners, and does not attempt cursor-up cleanup; an ordinary failure gets only a safe newline/plain fallback if output is subsequently writable. Accepted `EPIPE` additionally stops output quietly without another write or stack trace. Timeline-operation metadata prevents replay after payload acceptance while preserving an event whose clear or synchronous payload write failed before acceptance.
- Local validation measured approximately 251 ms median append-to-attach visibility with the current 250 ms polling interval and approximately 521 JSONL bytes/event for a seven-event representative fixture. These are documented local observations, not performance or storage guarantees. The sticky footer PTY flow was exercised on macOS; its Linux PTY adapter was not exercised locally, so this is not a portability guarantee.
- Provider-specific activity labels are not the core model; recorded commands and outputs are the evidence.

## Recommended reporting language

Use “observed,” “recorded,” “reported,” “partial,” or “missing evidence.” Avoid saying BashGuard caused, prevented, approved, blocked, or fully reconstructed an action unless the evidence and implementation explicitly support that claim.

## Reporting a bug

Open a GitHub issue using the [bug report template](https://github.com/acheltenham/BashGuard/issues/new?template=bug_report.md).

Include, when safe:

- BashGuard version or commit;
- Pi version;
- operating system;
- command run and expected/actual output;
- whether the BashGuard extension was loaded before the Pi session started;
- session selector and `BASHGUARD_DATA_DIR` configuration, but never secrets;
- a minimal sanitized event excerpt or `bashguard inspect` output;
- reproduction steps and relevant `bashguard doctor` output.

Do not attach raw session JSONL if it contains secrets or private content. Redact first.
