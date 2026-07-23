# BashGuard

> The developer flight recorder for Pi coding sessions.

BashGuard is an open-source, local-first Pi extension that helps developers understand what their coding agent did, why it did it, and what changed as a result.

It connects prompts, tool calls, resolved shell commands, policy decisions, command results, file changes, and Git checkpoints into one explainable session timeline.

## Why BashGuard

Pi already provides an extensible coding harness, local sessions, lifecycle hooks, tool interception, and custom terminal UI. BashGuard builds on those capabilities instead of replacing them.

The missing experience is a clear answer to questions such as:

- What exact command did Pi execute?
- Did project configuration or a wrapper change the command?
- Which prompt caused a tool call or file change?
- Why was an action allowed, warned, blocked, or sent for approval?
- Which files changed, and can I safely restore them?
- Where did the session begin to go off course?

## Product Direction

BashGuard begins as a TypeScript extension for Pi.

The MVP focuses on:

- resolved command preview
- explainable command decisions
- prompt-to-action execution timelines
- file and Git change correlation
- Git-backed checkpoints and restore guidance
- local session summaries

The MVP does not require a daemon, cloud service, account, hosted dashboard, or support for other coding harnesses.

## Experience

At the end of a session, BashGuard should make the work understandable at a glance:

```text
Session Summary

18 tool calls
11 shell commands
 6 files modified
 3 decisions explained
 2 Git checkpoints
 1 warning
```

A developer can then inspect a connected timeline:

```text
Prompt
  ↓
Tool request
  ↓
Resolved command
  ↓
Decision and explanation
  ↓
Command result
  ↓
File changes
  ↓
Git checkpoint
```

## Principles

- Pi is the platform.
- Observe before enforcing.
- Never hide the command that will execute.
- Explain every decision.
- Keep the core experience local.
- Use Git as the initial recovery mechanism.
- Prefer a useful developer experience over policy complexity.
- Do not rebuild capabilities Pi already provides.

## Current Status

BashGuard is in product definition and early design. The immediate goal is a narrow Pi extension that proves the event capture, command preview, explanation, and Git-correlation experience.

## Documents

- [Manifesto](MANIFESTO.md)
- [Product Requirements](PRODUCT_REQUIREMENTS.md)
- [Architecture](ARCHITECTURE.md)
- [Roadmap](ROADMAP.md)
- [Competitive Analysis](COMPETITIVE_ANALYSIS.md)
- [UI Vision](docs/vision/ui-vision.md)
- [MVP Scope](docs/vision/mvp.md)
- [Product Principles](docs/vision/principles.md)
- [Decision Log](DECISIONS.md)
- [Changelog](CHANGELOG.md)

## Working Positioning

> BashGuard is the local flight recorder and explainable command guard for Pi.