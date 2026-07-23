# BashGuard UI Vision

**Status:** Draft  
**Last updated:** July 23, 2026

## Design Goal

BashGuard should feel like a transparent companion to Pi, not a security console attached to it.

The primary interface is a separate terminal that follows a Pi session live. Focused approval interactions remain inside Pi so developers do not switch terminals to continue their work.

The experience should answer:

- What is Pi doing now?
- What just happened?
- Why does this action need my attention?
- Why did this file change?
- What evidence supports that explanation?
- How can I recover?

## Experience Model

```text
Pi terminal                         BashGuard terminal

Conversation and approvals          Narration and understanding
Tool execution                      Live event stream
Developer decisions                 Investigation and replay
                                    Debrief and recovery
```

## Experience Principles

- Narrate meaningful activity instead of dumping raw logs.
- Keep safe workflows quiet.
- Interrupt only when the user needs to decide.
- Show the resolved command, not a simplified approximation.
- Explain risk in plain language.
- Put prompt, action, result, file impact, and Git state in one event story.
- Use progressive disclosure: glance, expand, investigate.
- Show uncertainty, inference, redaction, and missing capture honestly.
- Make recovery obvious and intentional.
- Avoid dashboard language designed for security analysts.
- Preserve Pi's session ID as the canonical identity.

## 1. Live Companion

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

The live view is designed for glancing. It should not continuously stream full stdout, raw JSON, or every lifecycle callback.

## 2. Session Discovery

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

```bash
bashguard attach
bashguard attach <pi-session-id>
```

Automatic discovery should use the current repository and active Pi sessions. It should ask only when the match is ambiguous.

## 3. Resolved Command Preview

When approval is required, the active decision remains in Pi. The BashGuard companion shows enriched context:

```text
APPROVAL REQUIRED

Requested
  npm run reset-fixtures

Resolved
  source .env.local && rm -rf ./tmp/auth-fixtures && npm run seed

Working directory
  ~/projects/store-api

Potential impact
  Deletes 34 files before rebuilding fixtures.

Why this needs attention
  The script contains a recursive delete and loads project-controlled
  environment configuration before execution.

Triggered by
  "Recreate the authentication fixtures and rerun the tests."

Safer option
  Create a checkpoint and archive the fixture directory first.
```

The developer should never approve a simplified command while a materially different command executes.

## 4. Inspect Mode

```bash
bashguard inspect bg-102
```

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

Inspect Mode should support:

- chronological browsing;
- deterministic search;
- filters for prompts, commands, files, warnings, decisions, and checkpoints;
- event expansion;
- command output;
- changed-file and diff summaries;
- correlation method and confidence;
- capture gaps and redactions;
- narrow-terminal single-pane fallback.

## 5. Event Detail

```text
Command
  npm test -- --runInBand

Working directory
  ~/projects/store-api

Started
  09:31:36

Duration
  14.2s

Exit code
  1

Triggered by
  Tool call tc-018 · Turn 7

Reason reported by Pi
  Validate the authentication refactor.

Evidence
  Prompt and tool directly linked
  No file changes observed
  Environment values redacted
```

BashGuard must distinguish model-reported rationale from verified causal data.

## 6. Replay Mode

```bash
bashguard replay bg-102
```

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

Replay walks through meaningful recorded events. It does not rerun commands, expose hidden reasoning, or simulate a video recording.

## 7. File Impact

```text
FILES CHANGED

src/auth.ts              direct tool link    +42 -19
src/auth.test.ts         Git time window      +15  -7
package.json             command window        +1  -0
package-lock.json        command window       +88 -31

Checkpoint before dependency change
  bashguard/bg-102/pre-dependency-change
```

The UI should show how each relationship was established, not only the file list.

## 8. Recovery

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

BashGuard should never silently reset the repository.

## 9. Session Debrief

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

The debrief should present evidence rather than an unexplained trust score.

## 10. Progressive Disclosure

### Glance

- live narration;
- current activity;
- warning state;
- capture completeness.

### Expand

- command;
- result;
- duration;
- files;
- decision explanation;
- evidence type.

### Investigate

- full timeline;
- prompt and tool relationships;
- output and diffs;
- Git state;
- inferred and missing links;
- recovery options.

## Keyboard Direction

Candidate interactions:

```text
↑ / ↓     move between events
Enter     expand
Esc       return
/         search
f         filter
p         prompts
c         commands
e         errors and warnings
g         Git and checkpoints
r         replay from selection
?         help
q         quit
```

These are design candidates, not a frozen public API.

## Terminal Compatibility

- support narrow and wide layouts;
- do not rely on colour alone;
- support non-interactive text output;
- preserve readable output without Unicode box drawing;
- avoid mouse-only interactions;
- respect terminal themes and contrast;
- do not use distracting animation.

## Future UI Opportunities

Post-MVP possibilities:

- natural-language questions over recorded evidence;
- compare two sessions;
- repository activity heatmaps;
- richer cross-session search;
- optional local browser investigation view;
- shareable redacted session reports;
- team policy and approval interfaces.

## What the UI Must Avoid

- a required browser dashboard;
- dense enterprise dashboards;
- unexplained red, yellow, and green scoring;
- raw JSON as the primary experience;
- policy YAML as the first interaction;
- confirmation prompts for routine safe commands;
- streaming every Pi callback as a log line;
- claims of complete provenance when links are missing;
- exposing secrets in previews or stored output;
- a second session identity that obscures the Pi session ID.