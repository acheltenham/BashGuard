# The BashGuard Experience

**Status:** North star draft  
**Last updated:** July 23, 2026

## Purpose

This document describes what using BashGuard should feel like.

It is not an architecture specification or a list of features. It follows a developer through a real Pi session and defines the experience the product must preserve as implementation decisions are made.

## The Core Relationship

Pi is where the developer talks to the agent.

BashGuard is where the developer understands the execution.

BashGuard should feel like Pi gained a transparent companion, not like a security product was bolted onto the workflow.

## Starting a Session

The developer opens Pi in a repository and begins working normally.

In a second terminal, they run:

```bash
bashguard attach
```

BashGuard finds the active Pi session in the current repository and asks for confirmation only when more than one session is plausible.

```text
Active Pi session found

Session     bg-102
Repository  ~/projects/store-api
Started     09:40

Attached · recording live
```

The developer may also attach directly:

```bash
bashguard attach <pi-session-id>
```

BashGuard must not require a browser, account, cloud service, or separate project setup for the normal workflow.

## Live Mode

Live Mode is designed for glancing, not constant attention.

```text
BASHGUARD · LIVE · bg-102
store-api · main · 03m 42s

09:41  Reading src/auth.ts
09:41  Searching for authenticate()
09:42  Running tests
       npm test -- --runInBand
09:42  Tests failed · 2 failures
09:43  Editing src/auth.ts · +42 -19
09:44  Running focused tests
09:44  Tests passed
09:45  Git checkpoint created

Current
  Reviewing the resulting diff

Commands 6 · Files 3 · Warnings 0 · Capture 94%
```

This is narration, not a raw event dump.

Routine implementation details should be grouped into meaningful actions. The default display should answer:

- what Pi is doing now;
- what just completed;
- whether anything needs attention;
- whether BashGuard can see the whole execution chain.

## Quiet by Default

Safe commands should not create approval fatigue.

A read, search, test, or narrowly scoped development command should normally execute without interruption and appear in the live narrative.

BashGuard should become prominent only when:

- the developer needs to make a decision;
- the command shown by Pi differs materially from what will execute;
- the action can cause broad or difficult-to-recover impact;
- capture has degraded enough to affect trust;
- a failure changes the likely direction of the session.

## A Risky Command

Pi prepares a command that deletes generated fixtures.

The Pi terminal receives the approval interaction because that is where the developer is acting. The BashGuard companion simultaneously shows the expanded context.

```text
APPROVAL REQUIRED

Requested
  npm run reset-fixtures

Resolved
  source .env.local && rm -rf ./tmp/auth-fixtures && npm run seed

Working directory
  ~/projects/store-api

Potential impact
  Deletes 34 files under tmp/auth-fixtures before rebuilding them.

Why this needs attention
  The requested script contains a recursive delete and loads project-controlled
  environment configuration before execution.

Triggered by
  "Recreate the authentication fixtures and rerun the tests."

Safer option
  Create a Git checkpoint and archive the fixture directory before rebuilding.
```

The developer should never approve a simplified label while a materially different command executes.

## Investigating an Unexpected Change

The developer notices that `package.json` changed even though the task concerned authentication code.

They press `/` in the BashGuard companion and search for the file, or run:

```bash
bashguard inspect bg-102
```

The investigation view opens:

```text
┌ Timeline ─────────────────────┬ Event details ──────────────────────────┐
│ 09:41 Prompt                  │ File changed                            │
│ 09:41 Read src/auth.ts        │ package.json                            │
│ 09:42 npm test                │                                         │
│ 09:43 Edit src/auth.ts        │ First observed after                    │
│ 09:44 npm install zod   ◀     │ npm install zod                         │
│ 09:44 File package.json       │                                         │
│ 09:45 Tests passed            │ Triggered by                            │
│                               │ Tool call tc-018 · Turn 7                │
│                               │                                         │
│                               │ Reason reported by Pi                   │
│                               │ Add validation used by the refactor.    │
│                               │                                         │
│                               │ Verified                                │
│                               │ Command/result/file window linked       │
└───────────────────────────────┴─────────────────────────────────────────┘
```

BashGuard distinguishes verified causal links from explanations supplied by the model. It does not present inferred intent as fact.

The key question is always easy to ask and answer:

> Why did Pi change this file?

## Progressive Disclosure

The experience has three levels.

### Glance

Live narration, current activity, warnings, and a small session status line.

### Expand

A selected event reveals command, working directory, duration, result, affected files, decision explanation, and capture status.

### Investigate

The developer opens the full timeline, filters events, searches files and commands, examines diffs, reviews checkpoints, and follows prompt-to-effect relationships.

BashGuard should not force investigation-level detail into the live view.

## Replay

After the session, the developer can run:

```bash
bashguard replay bg-102
```

Replay walks through the recorded execution story in order. It does not rerun commands and does not claim to reveal hidden model reasoning.

```text
00:00  Prompt received
00:08  Read authentication module
00:21  Initial tests failed
00:46  Modified src/auth.ts
01:12  Added validation dependency
01:31  Focused tests passed
01:48  Reviewed Git diff
01:55  Session completed
```

The developer can pause, move between meaningful events, and expand any step.

Replay is useful for debugging, learning, review, and incident reconstruction. It is not a video recording of terminal output.

## Recovery

When a change is unwanted, BashGuard connects the event to Git state.

```text
RECOVERY OPTIONS

Unexpected change
  package.json and package-lock.json

Relevant checkpoint
  bashguard/bg-102/pre-dependency-change

Created before
  npm install zod

Current work after checkpoint
  3 files changed

Recommended
  Review the checkpoint diff before restoring.

Actions
  View diff · Copy restore command · Return to timeline
```

BashGuard never silently resets the repository or discards work.

## Session Debrief

At the end of every recorded session, BashGuard produces a concise debrief.

```text
SESSION COMPLETE · bg-102

Duration             18m 42s
Commands                   9
Files read                 42
Files modified              6
Tests                3 passed
Approvals                   1
Warnings                    0
Git checkpoints             2
Capture completeness      94%

Outcome
  Pi refactored the authentication flow and the final test suite passed.

Worth reviewing
  package.json changed when a validation dependency was added.

Next
  bashguard inspect bg-102
```

The debrief is not a trust score. It provides evidence a developer can use to form their own judgment.

## Finding Past Sessions

```bash
bashguard sessions
```

```text
TODAY

bg-102  running    store-api   09:40   18m   1 approval
bg-101  completed  bashguard   08:12   31m   no warnings

YESTERDAY

bg-100  completed  store-api   16:44   22m   2 warnings
```

A developer can open any session by ID:

```bash
bashguard open bg-101
```

Session IDs should map clearly to Pi's underlying session identifiers. BashGuard must not create a confusing second identity system.

## Product Personality

BashGuard changes tone according to the situation:

- **Live:** calm narrator;
- **Decision:** concise advisor;
- **Investigation:** precise investigator;
- **Configuration:** practical teacher.

It should not sound alarmist, anthropomorphic, or corporate.

## The Standard

When something unexpected happens, BashGuard should make it obvious:

1. what happened;
2. why it happened;
3. what changed;
4. what the developer can do next.

Every MVP feature must strengthen that experience.