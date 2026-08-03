# BashGuard Roadmap

**Status:** Draft v0.4  
**Last updated:** July 23, 2026

## Milestone 0: Observe a Real Pi Session

Goal: build the smallest end-to-end BashGuard experience that can observe a real Pi session from a second terminal.

- complete the Pi capability matrix;
- build lifecycle and correlation spikes;
- create the Pi TypeScript extension skeleton;
- create the shared event-model package;
- create the BashGuard CLI skeleton;
- implement append-only local event transport;
- implement active and recent session discovery;
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

Goal: make a running Pi session understandable at a glance.

- refine the CLI and TUI architecture from Milestone 0 usage;
- improve active-session selection;
- add split-pane timeline and event detail views;
- add grounded narrative projection;
- add current activity and session status footer;
- improve capture-completeness indicators;
- support graceful narrow-terminal layouts;
- retain plain-text output mode;
- test simultaneous active sessions;
- make installation and local development straightforward.

Exit criteria:

- a developer can attach from a second terminal and follow meaningful activity with low local latency;
- narration is more useful than raw logs during real coding work;
- the companion can reconnect without losing the execution story;
- the experience works well enough for daily use by the project author.

## Phase 2: Investigation and Debrief

Goal: make a Pi session understandable after it happens.

- `bashguard open <session-id>`;
- `bashguard inspect <session-id>`;
- chronological timeline browser;
- deterministic search and filters;
- expandable event details;
- prompt, turn, and tool correlations;
- observed, reported, and inferred evidence labels;
- command output references;
- non-blocking risk-notice counts and notes for explicit risky shell command patterns with event, cwd, and command-result evidence context;
- richer session debrief;
- items-worth-reviewing summary;
- completed-session browsing.

Exit criteria:

- a developer can find a surprising command or file and identify the strongest available causal evidence;
- timeline gaps and redactions are visible rather than hidden;
- the debrief provides useful evidence without an unexplained trust score;
- risky-command summaries are clearly observation-only until the pre-execution guard exists.

## Phase 3: Resolved Command Guard

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

Evaluate only when the in-process extension is demonstrably insufficient:

- optional local execution broker or daemon;
- filesystem and network restrictions;
- stronger tamper resistance;
- process observation beyond Pi hooks;
- additional coding-harness adapters;
- team sharing and centralized governance.

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
