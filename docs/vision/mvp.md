# BashGuard MVP

**Status:** Draft  
**Last updated:** July 22, 2026

## Goal

Prove that a Pi extension can give developers a useful, trustworthy explanation of what happened during a coding session and add narrow safeguards before risky shell execution.

## MVP Statement

BashGuard MVP is a TypeScript Pi extension that:

1. captures supported Pi session and tool events;
2. shows the resolved form of risky shell commands before execution;
3. explains why an action is allowed, warned, blocked, or requires approval;
4. correlates shell actions with command results and Git file changes;
5. presents a local session summary and terminal timeline;
6. records optional Git checkpoints and provides recovery guidance.

## Included

### Pi Integration

- TypeScript extension
- session lifecycle hooks
- tool-call and result hooks
- Bash command interception
- Pi terminal UI
- project-local settings where supported

### Command Guard

- command and working-directory display
- prefix and wrapper visibility where observable
- simple path extraction
- a small built-in risk rule set
- allow, notice, approval, and block outcomes
- plain-language explanations
- one-time approval

### Flight Recorder

- normalized append-oriented events
- prompt or turn correlation where available
- tool-call correlation
- command start, result, duration, and exit status
- visible capture-completeness markers
- session summary
- terminal timeline browser
- event detail inspector

### Git Safety Net

- repository and branch detection
- dirty-status capture
- changed-file summaries
- diff summaries
- optional checkpoint before selected risky changes
- checkpoint reference in the timeline
- copyable restore guidance

### Privacy

- local storage
- no required telemetry
- likely-secret redaction
- no full environment capture by default
- reduced capture mode

## Explicitly Excluded

- Rust daemon
- SQLite unless a measured need appears
- browser or React dashboard
- cloud service
- user accounts
- multi-user or team features
- enterprise policy management
- other coding harnesses
- MCP gateway
- OS sandbox
- filesystem or network isolation
- commands outside Pi
- policy recommendation engine
- historical policy simulation
- general-purpose YAML policy language
- automatic repository reset
- hidden-chain-of-thought capture
- perfect provenance claims

## Initial Built-In Risk Checks

The first release should keep the rule set small:

- broad or recursive deletion
- writes outside the repository
- writes to sensitive user directories
- privileged command execution
- destructive database operations
- destructive Git history or remote operations
- unexpected shell prefixes or wrappers

Rules should be individually explainable and testable.

## Required User Flows

### Safe Command

A routine read-only or test command executes without an approval dialog and appears in the timeline.

### Risky Command

The developer sees the resolved command, working directory, risk reason, and outcome choices before execution.

### Unexpected Change

The developer opens the timeline, finds the triggering prompt and command, inspects changed files, and identifies a relevant checkpoint.

### Incomplete Capture

The timeline clearly labels any missing prompt, tool, file, or runtime correlation.

## Definition of Done

The MVP is complete when:

- it installs as a normal Pi extension;
- it captures the majority of shell actions initiated through supported Pi tools;
- risky commands show a materially accurate preview before approval;
- every interruption has a plain-language explanation;
- session summaries and timelines remain usable during real coding work;
- changed files can be correlated to meaningful session windows;
- optional Git checkpoints can be created without silently altering normal Git history;
- secrets are not intentionally persisted in plain text;
- common safe commands do not generate excessive prompts;
- limitations of the in-process trust boundary are documented.

## MVP Validation Questions

- Do developers open the timeline after a surprising result?
- Does resolved-command visibility reveal information Pi's normal UX hides?
- Do explanations help users make better approval decisions?
- Can users identify which session action caused an unexpected file change?
- Do Git checkpoints help recovery without creating repository confusion?
- Is the extension quiet enough during normal work?
- Are Pi's hooks reliable enough for the proposed correlations?

## Stop or Reconsider Criteria

Reconsider the product if:

- Pi ships equivalent first-party functionality;
- an established Pi extension already provides the same integrated experience;
- reliable command interception is not possible;
- file correlation is too inaccurate to be useful;
- users consistently prefer Pi's native history plus Git alone;
- safeguards create more interruption than value.