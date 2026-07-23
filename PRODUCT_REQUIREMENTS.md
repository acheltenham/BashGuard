# BashGuard Product Requirements Document

**Status:** Draft v0.3  
**Project:** BashGuard  
**Last updated:** July 22, 2026

## Executive Summary

BashGuard is an open-source, local-first TypeScript extension for Pi that makes coding-agent execution understandable.

It connects prompts, tool requests, resolved shell commands, decisions, results, file changes, and Git checkpoints into one explainable timeline. It also adds narrow, human-friendly command safeguards where visibility alone is insufficient.

The MVP is deliberately small. It does not include a Rust daemon, cloud service, hosted dashboard, team controls, policy simulation, automatic recommendations, or support for other coding harnesses.

## Vision

Build the developer flight recorder for Pi coding sessions.

## Problem

Pi gives developers strong extension hooks and local session data, but developers still need a coherent way to answer:

- What exact command was executed?
- Did a prefix, wrapper, alias, or project setting change it?
- Which prompt and tool call caused the action?
- Why was the action allowed, warned, blocked, or sent for approval?
- Which files changed after the action?
- What Git state existed before and after it?
- Can the developer safely recover from a mistaken edit?
- Where did a session begin to diverge from the intended task?

Pi's native session tree is valuable, but it is not a complete prompt-to-filesystem execution narrative. Shell history, approval dialogs, and Git logs each show only part of the story.

## Positioning

> BashGuard is the local flight recorder and explainable command guard for Pi.

BashGuard is not primarily an enterprise security platform. It is a developer experience for understanding, debugging, and safely reviewing AI coding sessions.

## Primary User

A developer who uses Pi for meaningful coding work and wants to retain its flexibility without losing visibility or control.

Success statement:

> I can see exactly what Pi did, understand why, and recover when necessary.

## Product Goals

- Show the exact resolved command before risky execution.
- Correlate prompts, tools, commands, results, and file changes.
- Explain every warning, approval request, and block in plain language.
- Produce a useful local session summary and timeline.
- Correlate session events with Git state and checkpoints.
- Work entirely as a Pi TypeScript extension for the MVP.
- Preserve developer control over captured data.

## MVP Non-Goals

The MVP will not include:

- a Rust daemon or external local service
- a separate React or browser dashboard
- operating-system sandboxing
- commands executed outside Pi
- kernel or process-level enforcement
- network isolation
- cloud synchronization
- user accounts or billing
- team approval workflows
- organization-wide policy administration
- SIEM or enterprise identity integrations
- support for Claude Code, Cursor, Codex, Gemini CLI, or other harnesses
- autonomous policy recommendations
- policy simulation against historical sessions
- a general-purpose policy language
- a custom source-control or rollback system
- full replay of hidden model reasoning

## Core Experience

### 1. Resolved Command Preview

Before a risky shell action, BashGuard should show the command that will actually execute.

The preview should include, where available:

- resolved command text
- command segments in pipelines or chains
- working directory
- project root
- shell prefix or wrapper
- paths targeted by the command
- relevant redacted environment context
- detected risk factors

The developer should never approve a simplified command while a materially different command executes.

### 2. Explainable Decision

Each evaluated command receives one outcome:

- allow
- allow with notice
- require approval
- block

The explanation should include:

- outcome
- plain-language reason
- matched rule or heuristic
- affected path or resource
- safer alternative when useful
- whether an explicit override is available

The MVP should use a small built-in rule set rather than a general policy engine.

Initial risk categories may include:

- recursive or broad deletion
- writes outside the repository
- access to sensitive user directories
- destructive database commands
- privileged execution
- changes to Git history or remotes
- commands with hidden prefixes or wrappers

### 3. Execution Timeline

BashGuard should create a connected local timeline from Pi lifecycle and tool events.

Candidate events:

- session started
- prompt received
- tool requested
- command resolved
- decision made
- approval requested
- approval accepted or declined
- command started
- command completed
- tool result returned
- file changes detected
- Git checkpoint recorded
- session ended

Each event should carry stable correlation identifiers where Pi exposes enough context.

### 4. File and Git Correlation

BashGuard should capture Git state around meaningful write actions.

The MVP should support:

- repository root and branch
- dirty or clean status
- changed-file list
- diff summary
- optional checkpoint before a risky write sequence
- checkpoint reference in the timeline
- restoration guidance or command

BashGuard should use Git rather than creating a custom filesystem snapshot system.

### 5. Session Summary

At session end, BashGuard should present a concise terminal summary such as:

```text
Session Summary

18 tool calls
11 shell commands
 6 files modified
 3 decisions explained
 2 Git checkpoints
 1 warning
```

The summary should allow the developer to open the detailed timeline inside Pi.

### 6. Timeline Inspector

The initial UI should live in Pi's terminal interface.

A developer should be able to:

- browse events chronologically
- filter by command, file, risk, or decision
- expand an event for details
- inspect command output
- inspect changed-file and diff summaries
- see the prompt or turn associated with an action
- identify incomplete correlations honestly

## User Journey

1. Install the BashGuard Pi extension.
2. Open Pi inside a Git repository.
3. BashGuard begins capturing supported lifecycle and tool events locally.
4. Safe actions proceed without interruption.
5. Risky commands show a resolved preview and explanation.
6. The developer approves, declines, or follows a safer alternative.
7. BashGuard correlates results and file changes with the triggering event.
8. At session end, the developer receives a concise summary.
9. The developer opens the timeline to investigate, debug, or recover.

## Data Model

The MVP should use append-oriented extension entries or local JSONL data compatible with Pi's session model where practical.

A normalized event should contain:

- event ID
- timestamp
- project ID or repository root
- Pi session ID
- turn or prompt correlation when available
- tool call correlation when available
- event type
- command details when applicable
- decision and explanation when applicable
- result metadata
- changed-file metadata
- Git checkpoint reference
- capture completeness flags

## Privacy

BashGuard may encounter prompts, source code, command output, environment values, and secrets.

The MVP must:

- store data locally
- avoid required telemetry
- redact likely secrets before persistence where practical
- avoid storing full environment values by default
- make capture limitations visible
- provide a way to disable or reduce content capture

## Technical Direction

### Runtime

- TypeScript
- Pi extension APIs
- no external daemon in the MVP

### Storage

Prefer Pi extension entries and session-local data first.

Use a separate local file only when Pi's extension state is insufficient for timeline indexing or retention. Do not introduce SQLite until measurements demonstrate a real need.

### UI

- Pi terminal UI using `ctx.ui`
- confirmation dialogs
- status indicators
- custom timeline browser or inspector
- no separate web dashboard for the MVP

### Git Integration

Use local Git commands with explicit timeouts and error handling. BashGuard must work in observation-only mode when the directory is not a Git repository.

## Success Criteria

A successful MVP allows a developer to answer:

- What exact shell command did Pi execute?
- What context changed the resolved command?
- Which prompt or turn led to the action?
- Why did BashGuard allow, warn, request approval, or block it?
- What output did the command produce?
- Which files changed afterward?
- What Git checkpoint can help me recover?
- Which parts of the chain could not be captured?

## Initial Metrics

- percentage of Pi shell calls with resolved-command capture
- percentage of risky actions with useful explanations
- percentage of recorded commands linked to a session and tool call
- percentage of write actions with changed-file correlation
- rate of successful Git checkpoint creation
- timeline load and interaction latency
- number of false or unnecessary interruptions reported by users
- number of sessions where BashGuard helped explain or recover from an unexpected action

## Risks

### Pi Hook Limitations

Pi may not expose every causal link needed for perfect provenance. BashGuard must show missing links instead of inventing them.

### In-Process Trust Boundary

A Pi extension runs inside the Pi process and with the launching user's permissions. It is not a security boundary against a compromised process.

### Noisy Guardrails

Overly broad warnings will make the extension annoying. The MVP must keep interruption narrow and favor observation for ambiguous cases.

### Git Assumptions

Not every repository is clean or suitable for automated checkpoints. Checkpoints must be visible, optional, and conservative.

## Evidence That Would Invalidate the MVP

The direction should be reconsidered if:

- Pi adds a first-party resolved-command preview and complete prompt-to-file timeline
- an existing Pi extension already delivers the same integrated UX with strong adoption
- Pi's hooks cannot reliably connect tool calls, commands, and results
- users do not find session explanation or Git correlation useful
- required capture adds unacceptable latency or instability

## Deferred Product Opportunities

Only after the MVP proves useful should BashGuard consider:

- richer repository visualizations
- session comparison
- learned recommendations
- user-authored policy files
- optional local indexing or SQLite
- an optional browser UI
- a separate OS-level daemon or sandbox
- team sharing and centralized governance
- support for other coding harnesses