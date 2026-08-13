# BashGuard Terminal UX

**Status:** Draft  
**Last updated:** July 23, 2026

## UX Decision

The primary BashGuard interface is a separate terminal companion attached to a Pi session.

Pi owns conversation and action. BashGuard owns visibility, explanation, investigation, and recovery.

BashGuard may also enrich approval interactions inside Pi, but it should not force the full observability experience into the Pi conversation terminal.

## Primary Modes

### Live Mode

Command:

```bash
bashguard attach [session-id]
```

Purpose:

- show a bounded recent narrated history, defaulting to the latest 50 events;
- follow every new narrated event in a running Pi session;
- narrate meaningful activity;
- surface warnings and approval context;
- show current state and capture completeness;
- remain useful at a glance.

Default layout:

```text
Header
  Session · repository · branch · elapsed time · connection state

Status snapshot
  current activity only from an unmatched correlated tool request
  otherwise latest narrated activity
  evidence wording · capture state · event count · freshness

Narrative stream
  grouped meaningful events in chronological order

Current activity
  one clear statement of what Pi is doing now

Footer
  commands · files · warnings · checkpoints · capture completeness
```

The initial status snapshot is deterministic and evidence-grounded. It must not infer execution from recency alone: current activity requires a recorded tool request without a later matching completion, and the UI must say completion is not recorded yet. The first slice is a startup snapshot; continuous status redraw remains later Phase 1 work.

Live Mode should avoid raw payloads, noisy lifecycle events, full-history terminal floods, and continuously scrolling command output. Users can request a custom startup history, no startup history, or explicit full history; complete evidence remains available through inspect and JSONL export.

### Open Mode

Command:

```bash
bashguard open <session-id>
```

Purpose:

- show a concise snapshot of a running or completed session;
- present the prompt, current or final outcome, major actions, warnings, changed files, and checkpoints;
- offer a path into Inspect or Replay.

### Inspect Mode

Command:

```bash
bashguard inspect <session-id>
```

Purpose:

- investigate a surprising action or change;
- browse and filter the full event timeline;
- follow correlations between prompt, tool, command, result, file, decision, and checkpoint;
- examine evidence and capture gaps.

Suggested layout:

```text
┌ Timeline / filtered events ───┬ Selected event details ───────────┐
│                               │                                   │
│ chronological event list      │ explanation                       │
│                               │ command and result                │
│                               │ files and Git state               │
│                               │ provenance and completeness       │
└───────────────────────────────┴───────────────────────────────────┘

Status / key help / active filters
```

The layout must collapse cleanly in narrow terminals. A single-pane mode should show the event list first and open details as a replacement view.

### Replay Mode

Command:

```bash
bashguard replay <session-id>
```

Purpose:

- walk through meaningful recorded events in sequence;
- pause, step forward, step backward, and expand details;
- reconstruct the execution story without rerunning actions.

Replay is event replay, not hidden-reasoning capture, shell re-execution, or video playback.

### Sessions Mode

Command:

```bash
bashguard sessions
```

Purpose:

- find active and recent Pi sessions;
- show repository, status, start time, duration, warnings, and attachment state;
- copy or use the underlying session identifier.

## Interaction Model

The terminal experience should be keyboard-first and understandable without memorizing shortcuts.

Suggested keys:

```text
↑ / ↓     move between events
Enter     expand selected event
Esc       return or close details
/         search
f         filter
p         prompts
c         commands
e         errors and warnings
g         Git and checkpoints
r         replay from selected event
?         help
q         quit
```

These are design candidates, not a frozen API.

## Progressive Disclosure

### Level 1: Narration

```text
09:42  Running tests
09:43  Tests failed · 2 failures
09:44  Editing src/auth.ts
```

### Level 2: Event Summary

```text
npm test -- --runInBand
Exit 1 · 14.2s · no files changed
Triggered by tool call tc-018
```

### Level 3: Evidence

```text
working directory
resolved command
redacted execution context
stdout and stderr
policy evaluation
prompt or turn link
file correlation window
Git state
capture completeness
```

The default view should never start at Level 3.

## Narration Rules

BashGuard should group technical events into user-meaningful statements.

Examples:

- multiple file-read tool calls may become `Reading authentication code`;
- a command start and result become `Running tests` followed by `Tests passed`;
- a write tool call and Git diff become `Editing src/auth.ts · +42 -19`;
- a checkpoint operation becomes `Checkpoint created`;
- degraded capture becomes `Some file activity could not be linked`.

Narration must remain grounded in recorded evidence. BashGuard must not invent reasons or claim that a task succeeded solely because commands exited successfully.

## Approval UX

Approvals should happen in the active Pi interaction so the developer does not have to switch terminals to continue.

The BashGuard companion should mirror and enrich the decision context:

- requested command;
- resolved command;
- working directory;
- targeted paths;
- potential impact;
- matched rule or heuristic;
- safer alternative;
- capture limitations.

Routine safe actions should not request approval.

## Search and Questions

The MVP should support deterministic search over recorded fields:

```text
/auth.ts
rm -rf
exit:1
risk:approval
file:package.json
```

Natural-language questions such as `Why did auth.ts change?` are a valuable direction, but should not be required for the first release unless answers can remain local, grounded, and clearly attributed.

## Session Debrief

The debrief should contain:

- duration;
- commands and tool activity;
- files read and modified;
- tests observed;
- approvals, warnings, and blocks;
- Git checkpoints;
- capture completeness;
- concise outcome summary;
- items worth reviewing;
- next inspection command.

Do not present an unexplained percentage called a trust score. Evidence is more useful than a synthetic judgment.

## Accessibility and Terminal Compatibility

- support narrow and wide terminals;
- do not rely on colour alone;
- provide text labels for states and risk;
- degrade gracefully when Unicode drawing characters are unavailable;
- respect terminal theme and contrast;
- avoid mouse-only interactions;
- avoid animation that makes logs difficult to read;
- preserve a non-interactive text output mode for scripts and accessibility tools.

## What the UX Must Avoid

- a browser dashboard as the required primary interface;
- dense security-console language;
- raw JSON as the default view;
- constant approval prompts;
- unexplained red, yellow, and green scoring;
- streaming every lifecycle callback as a log line;
- claims of complete provenance when capture is partial;
- automatic repository restoration;
- a second session identity that obscures the Pi session ID.