# Milestone 0: Observe a Real Pi Session

**Status:** In implementation  
**Last updated:** August 3, 2026

## Objective

Build the smallest end-to-end BashGuard experience that can observe a real Pi session from a second terminal.

Milestone 0 is complete when BashGuard can answer:

> What is Pi doing right now, and what just happened?

This milestone intentionally excludes policy engines, replay animation, advanced recovery, cross-session analytics, and browser UI.

## User Flow

```text
Start Pi in a repository
  ↓
BashGuard extension begins recording
  ↓
Run `bashguard sessions`
  ↓
Run `bashguard attach [session-id]`
  ↓
Observe prompts, tool calls, commands, results, and edits live
  ↓
Select an event to inspect its evidence
  ↓
End the Pi session
  ↓
Review a concise debrief
```

## Deliverables

### 1. Repository Skeleton

Proposed structure:

```text
packages/
  pi-extension/
    src/
  cli/
    src/
  event-model/
    src/
fixtures/
  sessions/
docs/
```

The exact package tooling can change during implementation, but event types must not be duplicated between the extension and CLI.

### 2. Pi Extension Spike

The extension must capture supported forms of:

- session start;
- prompt or turn received;
- tool call requested;
- shell command requested;
- tool result;
- file read;
- file write or edit;
- session end.

Every event must include an evidence state and capture-completeness metadata.

### 3. Append-Only Event Stream

Initial transport:

```text
.bashguard/sessions/<pi-session-id>/events.jsonl
```

Requirements:

- one normalized event per line;
- monotonic sequence number per session;
- stable event ID;
- atomic append behavior where practical;
- tolerant reader for incomplete final lines;
- no secrets intentionally persisted;
- explicit schema version;
- no daemon.

The implementation may use a user-level BashGuard data directory instead of a repository-local directory if Pi session discovery or repository cleanliness makes that safer. The decision must be documented.

### 4. CLI Session Discovery

Implement:

```bash
bashguard sessions
```

Initial output should show:

- Pi session ID or short ID;
- repository name;
- running or completed state;
- start time;
- last event time;
- event count;
- capture state.

Implement:

```bash
bashguard attach [session-id]
```

When no session ID is supplied, BashGuard should attach automatically only when exactly one active session is discoverable. Otherwise it should present a deterministic selection list.

### 5. Live Terminal Companion

The first interface may begin as a structured terminal stream before the full split-pane TUI is implemented.

Minimum live narration:

```text
12:04:01  Session started · BashGuard
12:04:08  Prompt · Refactor the authentication module
12:04:11  Reading · README.md
12:04:14  Running · npm test
12:04:22  Failed · npm test · exit 1 · 8.2s
12:04:31  Editing · src/auth.ts
12:04:49  Passed · npm test · exit 0 · 7.9s
```

Requirements:

- live updates with low local latency;
- reconnect without duplicate events;
- graceful handling of narrow terminals;
- plain-text mode suitable for logs and debugging;
- no raw JSON as the default experience;
- no alarmist language.

### 6. Event Inspection

Selecting or opening an event should show available evidence:

- event type;
- timestamp and sequence;
- Pi session ID;
- prompt or turn link;
- tool-call link;
- command and working directory;
- duration and exit code;
- file path where applicable;
- observed, reported, inferred, redacted, or missing labels;
- capture limitations.

The first implementation may expose this through:

```bash
bashguard inspect <session-id> --event <event-id>
```

before interactive event selection is complete.

### 7. Session Debrief

At session completion, show an evidence-based summary:

```text
Session complete

Duration             18m 42s
Prompts                     3
Tool calls                 18
Shell commands             11
Files observed              6
Failed commands             1
Missing correlations        2
Capture state         Partial

Worth reviewing
- npm test failed before src/auth.ts was edited
- one shell command could not be linked to a prompt
```

Do not calculate an unexplained trust or confidence score.

## Implementation Progress

Completed foundation work:

1. Pi lifecycle capture spike records session, prompt, agent, turn, message, tool, user-bash, and shutdown events.
2. Append-only JSONL is written under the user-level BashGuard data directory, defaulting to `~/.bashguard/sessions/<session-id>/`.
3. `bashguard sessions` discovers active and completed recorded sessions from a separate process.
4. `bashguard attach [session-id]` renders historical events and follows live JSONL updates without a daemon.
5. Session completion is detected from recorded `session.shutdown`, avoiding PID-only liveness claims.

Next implementation order:

1. Replace or enhance the stream with the first interactive TUI.
2. Run a final Milestone 0 manual session and docs pass.

Current hardening branch status:

- Automated tests now cover JSONL parsing, session discovery/liveness, narration rendering, event lookup, event detail formatting, debrief aggregation, and capture-completeness defaults/rendering.
- The first `inspect` implementation prints one event by ID or sequence with evidence, capture metadata, session, cwd, tool, command/path, exit code, and pretty-printed payload.
- The first `debrief` implementation summarizes duration, prompt count, tool calls, shell commands, observed files, failed commands, capture state, and review notes, including missing/redacted/truncated capture metadata.
- Redacted-field review notes are informational: values were intentionally hidden before persistence; use `inspect` to see which payload paths were redacted, not the secret values themselves.
- Truncated-field review notes are informational: large values were shortened before persistence; use `inspect` to see which edit text, diff, patch, or output paths are partial.
- Targeted `edit` tool capture is confirmed: BashGuard records `tool.requested` and `tool.completed` with matching `toolCallId`, edited path, edit blocks, and diff/patch details.
- `capture.gap` events are supported in timeline/debrief output for degraded recorder behavior. Recorder write failures attempt a best-effort gap event with failed event type, tool name, tool-call ID, and command/path context when available; if the stream cannot be written at all, BashGuard notifies inside Pi instead of blocking Pi.

## Testing Strategy

### Unit Tests

- event schema validation;
- sequence handling;
- incomplete-line handling;
- redaction;
- narration projection;
- debrief aggregation;
- evidence-state rendering.

### Integration Tests

- extension writes and CLI tails the same session;
- reconnect resumes from the correct sequence;
- completed sessions remain readable;
- malformed events do not crash the companion;
- non-Git directories remain usable;
- capture failure does not stop Pi.

### Manual Test Session

Use BashGuard itself to observe a task that:

1. reads repository instructions;
2. searches source files;
3. runs a failing test;
4. edits one file;
5. reruns the test successfully;
6. ends the Pi session.

Record friction and missing context as GitHub issues.

## Definition of Done

Milestone 0 is complete when:

- BashGuard installs as a local Pi extension and CLI;
- a real Pi session emits normalized events;
- `bashguard sessions` lists active and completed sessions;
- `bashguard attach` follows an active session from another terminal;
- reconnect does not duplicate previously rendered events;
- prompts, tool calls, shell commands, results, and file-tool activity appear when Pi exposes them;
- event details distinguish observed, reported, inferred, redacted, and missing evidence;
- session completion produces a useful debrief;
- all core data remains local;
- BashGuard failure does not make Pi unusable;
- known Pi limitations are added to the capability matrix.

## Explicitly Deferred

- command blocking and approval;
- general policy configuration;
- resolved-command guarantees;
- Git checkpoints and restore;
- animated replay;
- cross-session search;
- natural-language investigation;
- browser UI;
- daemon or OS boundary;
- other coding harnesses.
