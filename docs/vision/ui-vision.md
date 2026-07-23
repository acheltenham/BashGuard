# BashGuard UI Vision

**Status:** Draft  
**Last updated:** July 22, 2026

## Design Goal

BashGuard should feel like a developer tool inside Pi, not a security console attached to it.

The experience should help a developer answer:

- What is about to happen?
- Why is BashGuard interrupting me?
- What happened during this session?
- Which files changed?
- How can I recover?

The MVP UI should remain inside Pi's terminal interface.

## Experience Principles

- Show the resolved command, not a simplified approximation.
- Keep safe workflows quiet.
- Interrupt only when the user needs to decide.
- Explain risk in plain language.
- Put the prompt, action, result, and file impact in one timeline.
- Show uncertainty and missing capture honestly.
- Make recovery obvious.
- Avoid dashboard language designed for security analysts.

## 1. Resolved Command Preview

When approval is required:

```text
BashGuard · Approval Required

Risk: High

Command
  rm -rf ./data/*

Working directory
  ~/projects/store-api

Why this needs approval
  Recursively deletes multiple files inside the repository.

Triggered by
  Refactor the local database setup and recreate the fixtures.

Safer option
  Move ./data to ./.bashguard/archive/ before recreating it.

[Approve once]  [Use safer option]  [Cancel]
```

The view should also reveal prefixes or wrappers:

```text
Requested
  npm test

Resolved
  source .env && npm test

Notice
  A project shell prefix adds environment loading before this command.
```

## 2. Explainable Decision

A decision should never be only a severity label.

```text
Blocked

Reason
  This command writes outside the repository into ~/.ssh.

Matched check
  Sensitive home-directory write

Affected path
  /Users/antonio/.ssh/config

Suggested alternative
  Write the generated config to ./tmp/ssh-config for review.
```

## 3. Session Summary

At session end:

```text
BashGuard Session Summary

Duration             18m 42s
Tool calls                 18
Shell commands             11
Files modified              6
Warnings                    1
Approvals                   2
Blocked actions             0
Git checkpoints             2
Capture completeness       92%

[Open timeline]  [View files]  [Restore options]
```

Capture completeness should communicate that provenance can be partial.

## 4. Timeline Browser

```text
09:31:02  Prompt
           Refactor the authentication module and run the tests.

09:31:08  Read
           src/auth.ts

09:31:14  Shell · Allowed
           rg "authenticate" src

09:31:27  Edit
           src/auth.ts
           +42 -19

09:31:28  Git checkpoint
           bashguard/01J2...

09:31:36  Shell · Allowed
           npm test
           Exit 1 · 14.2s

09:31:54  Shell · Approval
           rm -rf ./tmp/auth-fixtures
           Approved once

09:32:06  Files changed
           3 files · +57 -26
```

Filters:

- all
- prompts
- tools
- commands
- decisions
- files
- checkpoints
- warnings

## 5. Event Inspector

Selecting a command reveals:

```text
Command
  npm test

Working directory
  ~/projects/store-api

Started
  09:31:36

Duration
  14.2s

Exit code
  1

Triggered by
  Tool call tc_018 · Turn 7

Why Pi ran it
  Validate the authentication refactor.

Output
  ...

Files changed
  None detected

Capture status
  Prompt and tool linked
  Environment values redacted
```

BashGuard should distinguish model-provided rationale from verified causal data.

## 6. File Impact View

```text
Files changed

src/auth.ts              12 edits   +42 -19
src/auth.test.ts          5 edits    +15  -7
package-lock.json         1 edit     +88 -31

Checkpoint before changes
  bashguard/01J2...

[View diff]  [Restore guidance]
```

A future heatmap may show where the agent concentrated work, but the MVP should begin with a clear list and diff summary.

## 7. Recovery Experience

```text
Restore Options

Checkpoint
  bashguard/01J2...

Created before
  Pi modified src/auth.ts and src/auth.test.ts

Current uncommitted work
  3 files changed after this checkpoint

Recommended
  Review the diff before restoring.

[View diff]  [Copy restore command]  [Cancel]
```

BashGuard should not silently reset the repository.

## 8. Status Indicator

A small persistent status can communicate state without noise:

```text
BashGuard: recording · 8 commands · 1 warning · checkpoint ready
```

## Future UI Opportunities

These are post-MVP:

- compare two sessions
- scrub through a session by turn
- repository activity heatmap
- local browser-based investigation view
- shareable redacted session reports
- team policy and approval interfaces

## What the UI Must Avoid

- dense enterprise dashboards
- unexplained red/yellow/green scoring
- raw JSON as the primary experience
- policy YAML as the first interaction
- confirmation prompts for routine safe commands
- claims of complete provenance when links are missing
- exposing secrets in previews or stored output