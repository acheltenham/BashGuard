# BashGuard Product Requirements Document

**Status:** Draft v0.4  
**Project:** BashGuard  
**Last updated:** July 23, 2026

## Executive Summary

BashGuard is an open-source, local-first terminal companion and TypeScript extension for Pi.

It helps developers understand what Pi is doing while it happens, investigate what happened afterward, and recover safely when something goes wrong. The primary experience is a second terminal attached to a Pi session, supported by focused approval interactions inside Pi.

The MVP connects prompts, tool requests, resolved shell commands, decisions, results, file changes, and Git checkpoints into one explainable event stream.

## Vision

Build the terminal flight recorder for Pi coding sessions.

## Core Product Relationship

> Pi is where the developer talks to and acts through the agent. BashGuard is where the developer understands the execution.

BashGuard should feel like instrumentation for Pi, not a separate enterprise security console.

## Problem

Pi provides extension hooks, local sessions, tool interception, and terminal UI, but developers still lack a coherent way to answer:

- What is Pi doing right now?
- What exact command is about to execute?
- Did a prefix, wrapper, alias, or project setting change it?
- Which prompt and tool call caused the action?
- Why was the action allowed, warned, blocked, or sent for approval?
- Which files changed after the action?
- What Git state existed before and after it?
- Can the developer safely recover from a mistaken edit?
- Where did a session begin to diverge from the intended task?

Pi history, shell output, approval dialogs, and Git logs each expose part of the story. BashGuard joins those fragments into a developer-facing execution narrative.

## Positioning

> BashGuard is the local terminal companion, flight recorder, and explainable command guard for Pi.

The adoption wedge is understanding and confidence. Narrow safeguards grow from the same event evidence rather than dominating the first experience.

## Primary User

A developer who uses Pi for meaningful coding work and wants to retain its flexibility without losing visibility or control.

Success statement:

> I can glance at BashGuard to see what Pi is doing, inspect why something happened, and recover without guessing.

## Product Goals

- Provide a live narrated view of a running Pi session in a separate terminal.
- Attach to active or completed sessions using Pi's session identity.
- Show the exact resolved command before risky execution.
- Correlate prompts, tools, commands, results, files, and Git state.
- Explain every warning, approval request, and block in plain language.
- Support investigation and event replay without rerunning commands.
- Produce a concise evidence-based session debrief.
- Show capture gaps, redactions, and inferred relationships honestly.
- Work locally without required accounts, cloud services, or telemetry.
- Keep routine safe work quiet.

## MVP Non-Goals

The MVP will not include:

- a hosted or required browser dashboard;
- cloud synchronization;
- user accounts or billing;
- team approval workflows;
- organization-wide policy administration;
- SIEM or enterprise identity integrations;
- support for other coding harnesses;
- operating-system sandboxing;
- kernel or process-level enforcement;
- network isolation;
- commands executed outside supported Pi hooks;
- a general-purpose policy language;
- autonomous policy recommendations;
- historical policy simulation;
- a custom source-control or rollback system;
- automatic repository reset;
- hidden model reasoning capture;
- a synthetic trust score as the primary result;
- perfect provenance claims.

A lightweight local event transport is allowed. A long-running daemon, database, and network API are not MVP requirements.

## Core User Experience

### 1. Session Discovery and Attachment

The developer can run:

```bash
bashguard attach
bashguard attach <pi-session-id>
bashguard sessions
```

Requirements:

- discover the active Pi session for the current repository when unambiguous;
- list recorded sessions with repository, status, start time, and warnings;
- use the Pi session ID as the canonical identifier;
- reconnect to a session after the companion starts late;
- read completed sessions without Pi still running;
- avoid requiring a browser or additional account setup.

### 2. Live Narration

The separate terminal companion follows meaningful session activity:

```text
09:41  Reading src/auth.ts
09:42  Running tests
09:43  Tests failed · 2 failures
09:44  Editing src/auth.ts · +42 -19
09:45  Focused tests passed
09:45  Git checkpoint created
```

Requirements:

- group low-level lifecycle events into meaningful statements;
- show current activity, recent outcome, warnings, and capture completeness;
- avoid streaming raw payloads and full command output by default;
- remain glanceable during normal work;
- ground every narrative statement in recorded events;
- avoid claiming task success solely from an exit code.

### 3. Resolved Command Preview

Before risky shell execution, BashGuard should show:

- requested command;
- resolved command;
- command segments in pipelines or chains;
- working directory and project root;
- shell prefixes or wrappers;
- paths or resources targeted;
- relevant redacted environment context;
- detected risk factors;
- triggering prompt or turn where available;
- safer alternative where useful.

The developer must never approve a simplified label while a materially different command executes.

Approval remains in the active Pi interaction. The companion terminal mirrors and enriches the context.

### 4. Explainable Decisions

Each evaluated action receives one outcome:

- allow;
- allow with notice;
- require approval;
- block.

Every interrupted action includes:

- plain-language reason;
- matched transparent check;
- affected path or resource;
- potential impact;
- safer alternative where useful;
- whether an explicit one-time override is available;
- capture limitations relevant to the decision.

The MVP uses a small built-in rule set rather than a general policy engine.

Initial checks may include:

- recursive or broad deletion;
- writes outside the repository;
- sensitive home-directory access;
- destructive database commands;
- privileged execution;
- destructive Git history or remote operations;
- hidden or unexpected command prefixes or wrappers.

### 5. Inspect Mode

The developer can run:

```bash
bashguard inspect <pi-session-id>
```

Requirements:

- browse events chronologically;
- filter by prompt, command, file, result, warning, decision, or checkpoint;
- search deterministic recorded fields;
- expand an event for evidence and detail;
- inspect command output and exit status;
- inspect changed files and diff summaries;
- follow prompt-to-effect relationships;
- distinguish observed, model-reported, and inferred information;
- identify incomplete correlations honestly;
- support wide two-pane and narrow single-pane terminal layouts.

### 6. Event Replay

The developer can run:

```bash
bashguard replay <pi-session-id>
```

Replay must:

- walk through meaningful recorded events in sequence;
- support pause, next, previous, and event expansion;
- never rerun commands;
- never claim to replay hidden reasoning;
- use derived narrative events only when their source evidence is available;
- remain useful for debugging, learning, review, and incident reconstruction.

### 7. File and Git Correlation

The MVP should support:

- repository root and branch;
- dirty or clean status;
- before-and-after status windows;
- changed-file list;
- diff summary;
- correlation method and confidence;
- optional checkpoint before selected risky changes;
- checkpoint reference in the timeline;
- reviewable restoration guidance.

BashGuard should use Git rather than creating a custom filesystem snapshot system. It must never silently reset the repository.

### 8. Session Debrief

At session completion, BashGuard presents:

- duration;
- commands and meaningful tool activity;
- files read and modified;
- tests observed and their final state;
- approvals, warnings, and blocks;
- Git checkpoints;
- capture completeness;
- concise outcome summary grounded in evidence;
- items worth reviewing;
- the next inspection command.

The debrief should not reduce the session to an unexplained trust percentage.

## Required User Journeys

### Normal Coding Session

1. The developer opens Pi in a Git repository.
2. The BashGuard Pi extension begins local recording.
3. The developer runs `bashguard attach` in another terminal.
4. BashGuard follows the active session and narrates meaningful activity.
5. Routine safe work proceeds without approval prompts.
6. The session ends with a concise debrief.

### Risky Command

1. Pi requests a shell command.
2. BashGuard resolves available execution context.
3. A built-in check identifies material risk.
4. Pi presents the decision interaction.
5. The companion shows the complete explanation.
6. The developer approves once, declines, or follows a safer alternative.
7. The outcome appears in the event stream.

### Unexpected File Change

1. The developer notices an unexpected file.
2. They search in the live companion or open Inspect Mode.
3. BashGuard shows when the change was first observed.
4. The UI links it to a direct tool call or a clearly labelled inferred window.
5. The developer reviews the command, prompt, diff, and checkpoint.
6. BashGuard provides safe recovery guidance.

### Incomplete Capture

1. BashGuard cannot observe a material causal link.
2. The live view shows degraded capture.
3. Inspect Mode identifies exactly what is missing or inferred.
4. The debrief reflects the incomplete evidence.

## Event and Data Requirements

The event model is append-oriented and session-scoped.

A normalized event includes:

- event ID and sequence;
- timestamp;
- Pi session ID;
- turn, message, and tool-call identifiers where available;
- event type;
- source;
- evidence classification: observed, reported, or inferred;
- summary;
- type-specific payload;
- correlation identifiers;
- capture completeness, missing fields, and redactions.

See [Event Model](../architecture/event-model.md).

## Local Transport and Storage

The Pi extension must expose the session event stream to the separate terminal companion.

The MVP should prefer:

- Pi extension entries and session-associated data where readable;
- an append-only local JSONL event file for live tailing and completed sessions;
- a small local session index when needed for discovery.

Requirements:

- atomic or recoverable appends;
- schema versioning;
- local file permissions suitable for sensitive data;
- reconnect and tail-from-sequence support;
- graceful handling of partial writes;
- no required SQLite database, long-running daemon, or network API.

## Privacy

BashGuard may encounter prompts, source code, command output, environment values, and secrets.

The MVP must:

- store data locally;
- avoid required telemetry;
- redact likely secrets before persistence where practical;
- avoid storing full environment values by default;
- make capture limitations visible;
- provide reduced content capture;
- document retention and deletion behavior;
- prevent terminal previews from exposing redacted values.

## Technical Direction

### Runtime

- TypeScript Pi extension for event capture, command interception, and in-Pi approvals;
- TypeScript terminal companion for sessions, attach, live, inspect, and replay;
- shared event schemas and rendering logic where practical.

### Terminal UI

- keyboard-first;
- readable in narrow and wide terminals;
- no colour-only meaning;
- progressive disclosure;
- plain text or non-interactive output mode;
- no required mouse interaction.

### Git Integration

Use local Git commands with explicit timeouts and error handling. BashGuard must operate in observation-only mode when the directory is not a Git repository.

## Success Criteria

A successful MVP allows a developer to answer:

- What is Pi doing right now?
- What exact shell command did Pi execute?
- What context changed the resolved command?
- Which prompt or turn led to the action?
- Why did BashGuard allow, warn, request approval, or block it?
- What output did the command produce?
- Which files changed afterward?
- How strong is the causal link?
- What Git checkpoint can help me recover?
- Which parts of the chain could not be captured?

## Initial Metrics

- percentage of sessions successfully attached from a second terminal;
- live event latency from Pi to companion;
- percentage of shell calls with resolved-command capture;
- percentage of risky actions with useful explanations;
- percentage of commands linked to a session and tool call;
- percentage of change sets with a stated correlation method;
- rate of successful Git checkpoint creation;
- time to answer why an unexpected file changed;
- number of false or unnecessary interruptions;
- percentage of completed sessions where users open the debrief, inspect, or replay;
- number of sessions where BashGuard helps explain or recover from an unexpected action.

## Risks

### Pi Hook Limitations

Pi may not expose every causal link needed for perfect provenance. BashGuard must show missing links instead of inventing them.

### Separate Process Coordination

The companion terminal needs a reliable local stream without introducing heavy infrastructure. File tailing, session discovery, locking, and partial writes must be proven early.

### In-Process Trust Boundary

The Pi extension runs inside Pi and with the launching user's permissions. BashGuard is not a security boundary against a compromised process.

### Noisy Narration

A terminal that emits every event becomes another log window. Narration and grouping must be validated with real sessions.

### Noisy Guardrails

Overly broad warnings will make the extension annoying. The MVP must keep interruption narrow and favor observation for ambiguous cases.

### Git Assumptions

Not every repository is clean or suitable for automated checkpoints. Checkpoints must be visible, optional, and conservative.

## Evidence That Would Invalidate the MVP

Reconsider the direction if:

- Pi adds a first-party attached terminal flight recorder with the same execution narrative;
- an existing Pi extension delivers the integrated experience with strong adoption;
- Pi's hooks cannot reliably connect tool calls, commands, and results;
- a separate terminal cannot follow sessions reliably without a heavy service;
- file-impact correlation is too inaccurate to be useful;
- users find live narration distracting rather than helpful;
- safeguards create unacceptable friction;
- users consistently prefer Pi history and Git alone.

## Deferred Opportunities

Only after the MVP proves useful should BashGuard consider:

- natural-language questions over recorded events;
- session comparison;
- repository activity heatmaps;
- richer local indexing or SQLite;
- optional browser investigation views;
- user-authored policy files;
- reviewed recommendations;
- an optional stronger local execution boundary;
- team sharing and centralized governance;
- support for other coding harnesses.