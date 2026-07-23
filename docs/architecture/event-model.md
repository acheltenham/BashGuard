# BashGuard Event Model

**Status:** Draft  
**Last updated:** July 23, 2026

## Purpose

BashGuard treats the session event stream as the product foundation.

Live narration, command previews, investigation, replay, debriefs, search, Git recovery, and future exports are different views over the same recorded evidence.

## Design Goals

The event model must:

- preserve Pi session identity;
- support append-oriented local recording;
- correlate prompts, tools, commands, results, files, decisions, and Git state;
- distinguish observed facts from model-reported explanations and local inference;
- represent missing capture honestly;
- remain useful without a database or cloud service;
- support live tailing from a separate terminal process.

## Session Identity

A BashGuard recording belongs to one Pi session.

The Pi session ID is canonical. BashGuard may display a shortened friendly form, but it must retain and expose the underlying identifier.

A session record should include:

```text
pi_session_id
repository_root
working_directory
branch
started_at
ended_at
status
capture_mode
bashguard_schema_version
```

## Event Envelope

Every event should use a common envelope:

```typescript
interface BashGuardEvent {
  id: string;
  sequence: number;
  timestamp: string;
  type: BashGuardEventType;

  piSessionId: string;
  turnId?: string;
  messageId?: string;
  toolCallId?: string;
  parentEventId?: string;
  correlationId?: string;

  source: "pi" | "bashguard" | "git" | "shell";
  evidence: "observed" | "reported" | "inferred";
  confidence?: "high" | "medium" | "low";

  summary: string;
  payload: Record<string, unknown>;
  capture: CaptureStatus;
}
```

The exact TypeScript shape may change, but these concepts are required.

## Capture Status

Capture completeness is recorded per event, not guessed only at session end.

```typescript
interface CaptureStatus {
  complete: boolean;
  captured: string[];
  missing: string[];
  redacted: string[];
  notes?: string[];
}
```

Examples:

- command and working directory captured, environment redacted;
- tool result captured, file correlation unavailable;
- file change observed, triggering tool inferred from time window;
- event summary derived from several observed child events.

## Event Types

### Session

- `session.started`
- `session.attached`
- `session.detached`
- `session.completed`
- `session.interrupted`
- `session.capture_degraded`

### Intent and Conversation

- `prompt.received`
- `turn.started`
- `turn.completed`
- `agent.summary_reported`

BashGuard does not capture or claim hidden chain of thought.

### Tool Activity

- `tool.requested`
- `tool.started`
- `tool.completed`
- `tool.failed`

### Shell Execution

- `command.requested`
- `command.resolved`
- `command.evaluated`
- `command.approval_requested`
- `command.approved`
- `command.declined`
- `command.blocked`
- `command.started`
- `command.completed`
- `command.failed`

### Filesystem and Repository

- `file.read`
- `file.created`
- `file.modified`
- `file.deleted`
- `files.change_set`
- `git.status_captured`
- `git.diff_captured`
- `git.checkpoint_created`
- `git.checkpoint_failed`
- `git.restore_guidance_created`

### Narration and Debrief

- `narrative.activity`
- `narrative.warning`
- `debrief.created`

Narrative events summarize other events for presentation. They must reference their source event IDs and may not replace the underlying evidence.

## Command Payload

Command-related events should support:

```text
requested_command
resolved_command
working_directory
repository_root
shell
prefixes_or_wrappers
target_paths
redacted_environment_keys
started_at
completed_at
duration_ms
exit_code
stdout_reference
stderr_reference
```

Large output may be stored separately and referenced to keep the event stream usable.

## Decision Payload

```text
outcome: allow | notice | approval | block
reason
matched_check
risk_factors
affected_resources
safer_alternative
override_available
```

Every interruption must be explainable from this payload.

## File Correlation

File causality is often imperfect. BashGuard should record how a relationship was established:

```text
correlation_method:
  direct_tool_reference
  git_before_after_window
  filesystem_observation
  timestamp_window
  user_confirmed

confidence:
  high
  medium
  low
```

The UI must distinguish direct links from inferred windows.

## Event Relationships

Events can be connected using:

- Pi session ID;
- turn or message ID;
- tool call ID;
- explicit parent event ID;
- correlation ID for one execution chain;
- source event IDs for narrative summaries;
- sequence and timestamps as a fallback.

A typical chain is:

```text
prompt.received
  -> tool.requested
  -> command.requested
  -> command.resolved
  -> command.evaluated
  -> command.started
  -> command.completed
  -> files.change_set
  -> git.diff_captured
```

Missing links remain missing. BashGuard should not fabricate a complete chain.

## Local Transport

The Pi extension must make the append-only event stream available to the separate BashGuard terminal companion.

The first implementation should prefer the smallest reliable local mechanism, such as:

- a session-associated JSONL event file that can be tailed;
- atomic append plus a small session index;
- Pi extension entries mirrored to a BashGuard-readable local path.

The transport must support:

- live tailing;
- reconnecting after the companion starts late;
- reading completed sessions;
- local permissions appropriate for sensitive project data;
- schema versioning;
- graceful handling of partial writes.

A long-running daemon, SQLite database, and network API are not required for the MVP.

## Ordering

Each session event receives a monotonically increasing sequence number assigned by the recorder. Timestamps remain useful but are not the sole ordering mechanism.

Derived narrative events should reference the range or source event IDs they summarize.

## Redaction

Redaction happens before persistence where practical.

Events may record:

- names of relevant environment keys;
- a statement that values were redacted;
- hashes or references only when justified;
- truncated command output with a separate protected local reference.

BashGuard should not store full environment snapshots by default.

## Schema Evolution

Every session includes a BashGuard schema version. Readers should:

- support known older versions where practical;
- ignore unknown optional fields;
- fail clearly on incompatible required fields;
- never silently reinterpret evidence semantics.

## MVP Validation

The event model is validated when it can support all of the following without separate bespoke data stores:

- a live narrated terminal view;
- attach by Pi session ID;
- chronological inspection;
- command detail expansion;
- prompt-to-effect correlation;
- file and Git impact views;
- event replay;
- session debrief;
- visible capture completeness.