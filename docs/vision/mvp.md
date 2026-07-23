# BashGuard MVP

**Status:** Draft  
**Last updated:** July 23, 2026

## Goal

Prove that BashGuard can make a Pi coding session understandable in real time and afterward without pulling the developer out of the terminal workflow.

## MVP Statement

BashGuard MVP consists of:

1. a TypeScript Pi extension that captures supported session and tool events, intercepts risky Bash commands, and records Git context;
2. a local TypeScript terminal companion that discovers, attaches to, inspects, replays, and debriefs Pi sessions;
3. a shared append-oriented event model using the Pi session ID as canonical identity.

The MVP should let a developer run Pi in one terminal and BashGuard in another.

## Included

### Pi Integration

- TypeScript extension;
- session lifecycle hooks;
- tool-call and result hooks;
- Bash command interception;
- focused approval UI inside Pi;
- project-local settings where supported;
- event recording tied to the Pi session ID.

### Terminal Companion

- `bashguard sessions`;
- `bashguard attach [session-id]`;
- `bashguard open <session-id>`;
- `bashguard inspect <session-id>`;
- `bashguard replay <session-id>`;
- live session narration;
- current activity and recent outcomes;
- wide and narrow terminal layouts;
- deterministic search and filtering;
- non-interactive text output mode.

### Flight Recorder

- normalized append-oriented events;
- monotonic session sequence numbers;
- prompt or turn correlation where available;
- tool-call correlation;
- command start, result, duration, and exit status;
- observed, reported, and inferred evidence labels;
- visible capture-completeness markers;
- grounded narrative projection;
- session debrief;
- event detail inspector;
- event replay without command re-execution.

### Command Guard

- requested and resolved command display;
- working-directory and project-root context;
- prefix and wrapper visibility where observable;
- simple path extraction;
- a small built-in risk rule set;
- allow, notice, approval, and block outcomes;
- plain-language explanations;
- potential-impact descriptions;
- safer alternatives where useful;
- one-time approval.

### Git Safety Net

- repository and branch detection;
- dirty-status capture;
- changed-file summaries;
- diff summaries;
- file-correlation method and confidence;
- optional checkpoint before selected risky changes;
- checkpoint reference in the timeline;
- copyable restore guidance;
- no silent reset or automatic loss of work.

### Local Transport

- an append-only local event stream readable by a second process;
- a small session index where needed for discovery;
- reconnect and tail-from-sequence support;
- schema versioning;
- graceful handling of partial writes;
- no required network API or long-running daemon.

### Privacy

- local storage;
- no required telemetry;
- likely-secret redaction before persistence where practical;
- no full environment capture by default;
- reduced capture mode;
- clear retention and deletion behavior;
- restrictive local permissions where supported.

## Explicitly Excluded

- hosted or required browser dashboard;
- cloud service;
- user accounts;
- multi-user or team features;
- enterprise policy management;
- other coding harnesses;
- MCP gateway;
- OS sandbox;
- filesystem or network isolation;
- commands outside supported Pi hooks;
- autonomous policy recommendation engine;
- historical policy simulation;
- general-purpose YAML policy language;
- automatic repository reset;
- hidden chain-of-thought capture;
- perfect provenance claims;
- unexplained trust scoring;
- SQLite unless a measured need appears.

## Initial Built-In Risk Checks

The first release should keep the rule set small:

- broad or recursive deletion;
- writes outside the repository;
- writes to sensitive user directories;
- privileged command execution;
- destructive database operations;
- destructive Git history or remote operations;
- unexpected shell prefixes or wrappers.

Rules should be individually explainable and testable.

## Required User Flows

### Attach to Active Session

The developer starts Pi, opens another terminal, runs `bashguard attach`, and sees meaningful activity from the active Pi session with low latency.

### Safe Command

A routine read-only or test command executes without an approval dialog and appears as concise narration.

### Risky Command

The developer sees the resolved command, working directory, potential impact, risk reason, and available choices before execution. Approval happens inside Pi while the companion mirrors the context.

### Unexpected Change

The developer opens Inspect Mode, finds the triggering prompt and command or the strongest available inferred window, inspects changed files, and identifies a relevant checkpoint.

### Replay

The developer steps through meaningful recorded events without rerunning commands or exposing hidden reasoning.

### Incomplete Capture

The live view, inspector, and debrief clearly label missing, redacted, or inferred prompt, tool, file, or runtime correlations.

### Companion Disconnect

Pi continues running and recording. The companion reconnects and continues from its last known sequence.

## Definition of Done

The MVP is complete when:

- it installs with a normal Pi extension and local CLI workflow;
- it discovers and attaches to active Pi sessions using their canonical session IDs;
- live narration remains useful during real coding work;
- event latency and extension overhead are acceptable;
- the companion can reconnect after disconnect;
- it captures the majority of shell actions initiated through supported Pi tools;
- risky commands show a materially accurate preview before approval;
- every interruption has a plain-language explanation;
- session debriefs and inspection remain usable for completed sessions;
- event replay is grounded in recorded evidence;
- changed files can be correlated using a visible method and confidence;
- optional Git checkpoints can be created without silently altering normal Git history;
- secrets are not intentionally persisted in plain text;
- common safe commands do not generate excessive prompts;
- limitations of the in-process trust boundary are documented.

## MVP Validation Questions

- Do developers keep the companion terminal visible during a session?
- Does narration help them understand current activity without becoming another noisy log?
- Can users attach and reconnect without setup friction?
- Does resolved-command visibility reveal information Pi's normal UX hides?
- Do explanations help users make better approval decisions?
- Can users identify why an unexpected file changed?
- Is the distinction between observed and inferred evidence clear?
- Does replay help reconstruct a failed or surprising session?
- Do Git checkpoints help recovery without creating repository confusion?
- Are Pi's hooks and the local event transport reliable enough?

## Stop or Reconsider Criteria

Reconsider the product if:

- Pi ships an equivalent attached terminal flight recorder;
- an established Pi extension provides the same integrated experience;
- reliable command interception is not possible;
- a second terminal cannot follow sessions reliably without heavy infrastructure;
- file correlation is too inaccurate to be useful;
- live narration is consistently ignored or considered distracting;
- users consistently prefer Pi's native history plus Git alone;
- safeguards create more interruption than value.