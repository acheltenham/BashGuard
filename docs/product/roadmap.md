# BashGuard Roadmap

**Status:** Draft v0.5; Milestone 0 and Boundary Reporting Slice 1 complete; Command Resolution Spike 2 in progress
**Last updated:** August 22, 2026

## Current execution sequence

This section is the source of truth for near-term sequencing. The numbered product phases below still describe the long-term capability order; this queue records the intentional interruption and exact resumption point.

1. **Complete — Boundary Reporting Slice 1:** `SandboxAdapter`, `NoSandboxAdapter`, and the current-environment `bashguard boundary` command shipped together.
2. **In progress — Command Resolution Spike 2:** establish what BashGuard can distinguish among requested, wrapped, and materially executed commands. See the [approved spike design](../plans/2026-08-22-command-resolution-spike-design.md).
3. **Resume Phase 1 — Split-pane event browser:** return to the existing `bashguard inspect --browse` design after the spike.
4. **Then — Phase 3 authorization:** begin narrow allow, notice, approve, and block behavior only after the spike and resumed Phase 1 slice.
5. **Later — Backend integration:** implement the Anthropic sandbox runtime adapter and grounded session/debrief boundary evidence after the first authorization slice.

When work pauses mid-slice, update the status here and the corresponding plan before starting a different slice. Completed items should remain visible until the next item has started, so the restart point is unambiguous.

## Milestone 0: Observe a Real Pi Session

The recording, attach, inspect, debrief, capture-completeness, risk-notice, file-activity, Git-snapshot, provider-neutral shell-activity, filtering, JSONL export, duplicate-recorder protection, and measurable validation foundation is implemented. Latency, storage, failure behavior, active attach, and inside-Pi workflows are documented in [`docs/testing/milestone-0-validation-baseline.md`](../testing/milestone-0-validation-baseline.md). The split-pane TUI is explicitly deferred to Phase 1. See [`docs/current-state.md`](../current-state.md) for public capability and limitation wording.

Goal: build the smallest end-to-end BashGuard experience that can observe a real Pi session from a second terminal.

- complete the Pi capability matrix;
- build lifecycle and correlation spikes;
- create the Pi TypeScript extension skeleton;
- create the shared event-model package;
- create the BashGuard CLI skeleton;
- implement append-only local event transport;
- implement discovery of all readable stored sessions, active and completed;
- implement `bashguard sessions`;
- implement `bashguard attach [session-id]`;
- narrate prompts, tool calls, commands, results, and file-tool activity;
- support reconnect without duplicate events;
- expose event details and capture-completeness labels;
- produce an evidence-based session debrief;
- measure event latency, storage overhead, and failure behaviour.

Exit criteria:

- a real Pi session emits normalized BashGuard events;
- Pi session ID is the canonical BashGuard session identity;
- a second terminal reliably follows a running session without terminal scraping, a daemon, or a network service;
- reconnect does not duplicate events;
- observed, reported, inferred, redacted, and missing evidence are distinguishable;
- BashGuard failure does not prevent Pi from running;
- technical limitations are recorded in the capability matrix.

Implementation reference: [`Milestone 0 plan`](../plans/milestone-0-observe-a-real-pi-session.md).

## Phase 1: Live Terminal Companion

**Status:** Intentionally paused after the live attach footer. Resume with the split-pane event browser immediately after Boundary Reporting Slice 1 and Command Resolution Spike 2, as recorded in the current execution sequence above.

Deterministic evidence filtering and JSONL export shipped during Milestone 0. Bounded startup history, a grounded attach status snapshot, interactive selection for ambiguous selector-less session commands, and the active-TTY adaptive sticky footer are implemented Phase 1 slices.

Goal: make a running Pi session understandable at a glance.

- bound attach startup history while preserving complete live follow and inspect/JSONL evidence;
- show an evidence-grounded startup snapshot in plain mode and an adaptive sticky status footer for supported active TTY attach, with immediate event changes, approximately one-second freshness, resize handling, and clean shutdown/opt-out behavior; **implemented**
- refine the CLI and TUI architecture from Milestone 0 usage;
- continue refining active-session selection after shipping the structured-text TTY picker with snapshot-local numbers and durable unique-prefix selectors;
- add split-pane timeline and event detail views (the picker is not this full-screen TUI);
- add grounded narrative projection;
- add current activity and session status footer; **implemented for active supported TTY attach**
- improve capture-completeness indicators;
- support graceful narrow-terminal layouts; **implemented for the attach footer; broader TUI remains planned**
- retain plain-text output mode; **implemented for completed/non-TTY/missing-or-dumb-TERM/opt-out attach**
- retain regression and real-TTY smoke coverage for simultaneous active sessions;
- make installation and local development straightforward.

Exit criteria:

- a developer can attach from a second terminal and follow meaningful activity with low local latency;
- narration is more useful than raw logs during real coding work;
- the companion can reconnect without losing the execution story;
- the experience works well enough for daily use by the project author.

## Phase 2: Investigation and Debrief

**Implemented foundation:** individual event inspection, evidence completeness, debrief review sections, activity/type filters, case-insensitive recorded-evidence search, latest-N/all controls, and JSONL export. Interactive timeline browsing and expandable details remain planned.

Goal: make a Pi session understandable after it happens.

- `bashguard open <session-id>`;
- `bashguard inspect <session-id>`;
- chronological timeline browser;
- deterministic search and filters;
- expandable event details;
- prompt, turn, and tool correlations;
- observed, reported, and inferred evidence labels;
- command output references;
- non-blocking risk-notice counts and notes for explicit risky shell command patterns with event, cwd, command-result evidence context, and plain-language risk explanations;
- file tool activity summaries for observed read, edit, and write-tool events without inferring create, overwrite, or delete impact;
- session start/shutdown Git status snapshots with branch, worktree path, changed-file status, available line counts, changed line ranges, observed matching file-tool events, and direct-path-match correlation confidence for before/after working-tree comparison;
- temporal-only risk/Git correlation notes when risky shell commands occur before a shutdown Git snapshot that shows changed paths;
- evidence completeness summaries covering capture gaps, redaction, truncation, missing fields, Git snapshots, and command-result evidence;
- next-inspect-command summaries that point users from debriefs to relevant recorded events;
- richer session debrief;
- items-worth-reviewing summary;
- completed-session browsing.

Exit criteria:

- a developer can find a surprising command or file and identify the strongest available causal evidence;
- timeline gaps and redactions are visible rather than hidden;
- the debrief provides useful evidence without an unexplained trust score;
- risky-command summaries are clearly observation-only until the pre-execution guard exists.

## Phase 2.5: Boundary Reporting

**Status:** Slice 1 is implemented. Later backend and historical-session slices remain deferred.

**Direction set by** [Decision 005](../adr/decision-log.md) and [issue #79](https://github.com/acheltenham/BashGuard/issues/79). **Designed in** [`docs/plans/2026-08-22-sandbox-adapter-and-boundary-reporting-design.md`](../plans/2026-08-22-sandbox-adapter-and-boundary-reporting-design.md).

Goal: tell the developer what containment boundary is detectable, and what it does not cover, before BashGuard adds any control of its own.

BashGuard owns the authorization and observability controls and delegates containment and network policy to external sandbox backends. Integration happens through a narrow two-method `SandboxAdapter` — `describe()` and `observe()` — that never executes or orchestrates.

### Slice 1 — Current-environment reporting — Implemented August 22, 2026

- define the `SandboxAdapter` shape; **implemented**
- ship `NoSandboxAdapter`, reporting "no containment boundary detected" for the common undetected case; **implemented**
- add `bashguard boundary` for current-environment evidence; **implemented**
- preserve the limit that BashGuard cannot prove an outer container or VM is absent; **implemented**
- do not add a historical debrief claim from current configuration; **implemented**

Slice 1 is complete when `bashguard boundary` honestly reports that no supported containment backend was detected, explains the resulting full-user-permission exposure, and preserves the outer-boundary limitation in interactive and plain output.

### Later slices — Deferred

- ship the Anthropic sandbox runtime adapter for Pi's first-party sandbox example;
- report which Pi tools the backend mediates and, critically, which it does not;
- distinguish a boundary reported from configuration from one observed in recorded events;
- record session-time boundary evidence before adding a grounded debrief boundary section.

Phase exit criteria:

- a developer can see the composite detectable boundary around a session rather than assuming one;
- coverage gaps, such as a backend mediating `bash` but not `write`, are stated rather than implied;
- a configuration-only detection is never presented as a proven active boundary;
- BashGuard never claims to characterize an outer container or VM it runs inside.

## Phase 3: Resolved Command Guard

**Scope note:** this phase is the *authorization* control — allow, notice, approve, or block a specific tool call, with an explanation. It is not containment. Pi's `tool_call` hook supports blocking and input mutation directly, and BashGuard already subscribes to that hook for capture. Spike 2 (Command Resolution) should complete first, because sandbox backends rewrite commands before execution.

Goal: make risky execution understandable before it happens.

- requested and resolved command preview;
- working-directory and project-root context;
- prefix and wrapper visibility;
- target-path extraction;
- small built-in risk rule set;
- allow, notice, approval, and block outcomes;
- approval interaction inside Pi;
- mirrored context in the terminal companion;
- plain-language explanations;
- potential-impact descriptions;
- safer alternatives where useful;
- secret-aware display and persistence.

Exit criteria:

- risky commands show the materially relevant command and context before approval;
- every interrupted action includes a useful explanation;
- common safe workflows are not burdened by excessive prompts;
- the user never has to switch to the companion terminal to approve or decline.

## Phase 4: Git Checkpoints and File Impact

Goal: connect agent execution to the repository changes it caused.

- repository and branch detection;
- before-and-after Git status capture;
- changed-file and diff summaries;
- direct and inferred correlation methods;
- correlation confidence labels;
- optional checkpoints before selected risky write sequences;
- checkpoint references in the timeline;
- recovery view and copyable restore guidance;
- explicit protection against silent reset or work loss.

Exit criteria:

- a developer can identify the files affected by a session;
- a developer can understand how BashGuard linked a file to an action;
- a developer can locate a relevant Git recovery point after a mistaken change.

## Phase 5: Event Replay

Goal: reconstruct the execution story without rerunning actions.

- `bashguard replay <session-id>`;
- meaningful event stepping;
- pause, forward, backward, and expand controls;
- replay from a selected timeline event;
- source-evidence links for every narrative step;
- explicit language that replay does not include hidden reasoning or command re-execution.

Exit criteria:

- a developer can reconstruct the major path through a completed session;
- replay remains understandable without becoming a video or raw-log player;
- every replay step can be traced to recorded evidence.

## Phase 6: Repository-Aware Context

Goal: improve explanations and risk context using explicit local repository signals.

- protected-path configuration;
- instruction-file discovery;
- repository-local BashGuard settings;
- branch and environment awareness;
- framework-specific hints where evidence supports them;
- improved file-impact presentation;
- optional suggestions to create rules only after repeated user-approved behaviour.

Exit criteria:

- BashGuard can distinguish common repository-specific risks using explicit, inspectable local signals;
- recommendations never silently change policy.

## Phase 7: Advanced Local Observability

Only after the core terminal workflow proves useful:

- session comparison;
- repository activity heatmaps;
- richer cross-session filtering and search;
- natural-language questions grounded in recorded events;
- optional local index or SQLite storage;
- exportable debugging or incident reports;
- rule testing against recorded events;
- user-reviewed recommendations;
- optional browser investigation view.

## Phase 8: Optional Stronger Boundaries

Per [Decision 005](../adr/decision-log.md), BashGuard does not implement containment. Filesystem, network, and process isolation are delegated to sandbox backends through the `SandboxAdapter` defined in Phase 2.5. This phase covers only what remains after that delegation.

Evaluate only when the in-process extension plus a containment backend are demonstrably insufficient:

- additional `SandboxAdapter` implementations, driven by demonstrated demand rather than anticipated breadth;
- upstream contributions where a backend cannot expose decisions as structured evidence;
- downstream authorization — the one control neither BashGuard nor current backends address;
- stronger tamper resistance;
- process observation beyond Pi hooks;
- additional coding-harness adapters;
- team sharing and centralized governance.

Explicitly not planned: BashGuard implementing its own filesystem, network, or process sandbox, or placing itself on the execution path as a broker or daemon.

## Explicitly Not Planned for the MVP

- hosted browser dashboard;
- cloud service;
- accounts and billing;
- enterprise control plane;
- SIEM integrations;
- multi-harness support;
- general-purpose policy language;
- autonomous policy changes;
- custom filesystem rollback engine;
- hidden-reasoning capture;
- unexplained trust scoring.
