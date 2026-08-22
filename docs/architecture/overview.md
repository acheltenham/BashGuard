# BashGuard Architecture

**Status:** Draft v0.4  
**Last updated:** August 22, 2026

## Architecture Decision

The BashGuard MVP has two cooperating TypeScript surfaces:

1. a Pi extension running inside Pi;
2. a local terminal companion that attaches to a Pi session.

The extension captures supported Pi lifecycle and tool events, resolves and evaluates commands, records Git context, and handles focused approval interactions inside Pi.

The terminal companion reads the local event stream and provides live narration, session discovery, inspection, replay, and debriefs.

A cloud service, hosted dashboard, required browser UI, SQLite database, long-running daemon, and network API are not part of the MVP.

## MVP Architecture

```text
Pi
  |
  | lifecycle events, tool calls, approvals
  v
BashGuard Pi Extension (TypeScript)
  |-- Event Capture
  |-- Command Resolution
  |-- Risk Evaluation
  |-- Explainable Decisions
  |-- Git Correlation
  |-- In-Pi Approval UI
  |
  v
Local Session Event Stream
  |-- append-only JSONL or compatible local representation
  |-- canonical Pi session ID
  |-- session index for discovery
  |
  v
BashGuard Terminal Companion (TypeScript)
  |-- sessions
  |-- attach / live narration
  |-- open
  |-- inspect
  |-- replay
  |-- session debrief
```

## Product Boundary

Pi owns:

- conversation;
- agent execution;
- tool invocation;
- the active approval interaction;
- native session storage and session tree.

BashGuard owns:

- normalized execution evidence;
- live session narration;
- resolved command context;
- explainable decisions;
- prompt-to-effect correlation;
- file and Git impact views;
- event replay;
- recovery guidance;
- capture completeness.

## Control Boundary

Agent security is several independent controls, not one thing called "sandboxing". BashGuard owns two of them and delegates two, per [Decision 005](../adr/decision-log.md).

| Control | Question | Owner |
|---|---|---|
| Authorization | Should this action run? | BashGuard, via Pi's blocking `tool_call` hook |
| Containment | What can it affect if it runs? | Sandbox backend |
| Network policy | Where can it communicate? | Sandbox backend |
| Downstream authorization | What can it do when it gets there? | Not addressed today |
| Observability | Can we reconstruct what happened? | BashGuard |

Containment is delegated because real isolation requires operating-system enforcement, which BashGuard must not reimplement. Pi's own security documentation makes the same point: Pi ships no built-in sandbox by design, and isolation has to come from the OS, a VM, or a container.

Integration with a backend goes through a narrow adapter that never executes anything:

```text
SandboxAdapter
  describe()   → the boundary in force: isolation kind, filesystem scope,
                 network policy, and which Pi tools the backend mediates
  observe()    → decisions correlated to recorded events, where the
                 backend exposes them
```

Pi executes, the backend enforces, BashGuard describes and reports. A boundary **reported** from configuration is never presented as one **observed** to be active, and BashGuard — running inside whatever boundary exists — never claims to characterize an outer container from within.

The implemented first slice defines this two-method contract and provides `NoSandboxAdapter`. `bashguard boundary` currently reports only that no supported backend was detected in the current environment, labels that absence-of-detection evidence `unknown`, and conditions its full-user-permission warning on there being no outer boundary. Configuration detection, backend decision observation, session-time evidence, and historical debrief reporting remain deferred.

## Components

### Pi Extension

The extension subscribes to supported Pi lifecycle and tool events.

Responsibilities:

- session lifecycle capture;
- prompt or turn correlation where available;
- tool-call and tool-result capture;
- Bash command interception;
- command-start and completion capture;
- risk evaluation;
- approval prompts inside Pi;
- Git status and checkpoint integration;
- append-only event recording;
- explicit completeness markers when correlation is unavailable.

The extension must fail visibly without making Pi unusable.

### Event Normalization

All captured activity is normalized into a shared event envelope.

The event model supports:

- stable sequence ordering;
- Pi session identity;
- turn, message, tool-call, and correlation identifiers;
- observed, reported, and inferred evidence classifications;
- redaction and missing-capture metadata;
- type-specific payloads;
- derived narrative events linked to source evidence.

See [Event Model](event-model.md).

### Local Session Event Stream

The separate terminal companion requires a reliable local transport.

The MVP should prefer the smallest mechanism that supports live and historical reading:

- append-only JSONL per Pi session;
- a small local index mapping Pi sessions to event streams;
- session metadata for repository, status, start time, and schema version;
- tail-from-sequence behavior for reconnect;
- atomic or recoverable appends;
- local file permissions appropriate for sensitive data.

Pi extension entries may remain the canonical embedded record where practical, but the companion must not depend on parsing a changing internal format if a stable mirrored stream is safer.

A network server is not required.

### Terminal Companion

The companion is a local CLI and TUI process.

Initial commands:

```text
bashguard sessions
bashguard attach [session-id]
bashguard open <session-id>
bashguard inspect <session-id>
bashguard replay <session-id>
```

Responsibilities:

- discover active and completed Pi sessions;
- attach to and tail a session stream;
- group technical events into grounded narrative statements;
- show current activity and recent outcomes;
- support progressive disclosure;
- filter and search recorded evidence;
- display event details, outputs, diffs, and Git context;
- replay events without rerunning actions;
- render session debriefs;
- show capture gaps and redactions.

### Command Resolution

Builds the most accurate observable representation of what will execute before approval.

Responsibilities:

- requested and resolved command text;
- working-directory capture;
- shell prefix and wrapper visibility;
- command-chain and pipeline inspection;
- targeted path extraction;
- relevant environment-key visibility with value redaction;
- explicit uncertainty where shell runtime may still transform execution.

The resolved preview must never claim completeness when aliases, expansion, child processes, or runtime behavior remain unknown.

### Risk Evaluation

Applies a small built-in set of transparent checks.

Initial checks may include:

- recursive or broad deletion;
- writes outside the repository;
- privileged execution;
- sensitive home-directory access;
- destructive database operations;
- destructive Git operations;
- hidden or unexpected command prefixes.

The MVP does not require a general-purpose policy engine.

### Explainable Decisions

Produces one of four outcomes:

- allow;
- allow with notice;
- require approval;
- block.

Each result includes a plain-language reason, matched condition, affected resource, potential impact, safer alternative where useful, and relevant capture limits.

### Timeline Correlation

Connects Pi events into a chronological execution story.

Correlation should use stable Pi identifiers where available and locally generated correlation IDs where necessary. File relationships must include the method and confidence used. Missing causal links remain visible rather than inferred as fact.

### Narrative Projection

Narration is a presentation layer over the underlying event stream.

It may group events such as command start, result, and Git diff into statements such as:

```text
Running tests
Tests failed · 2 failures
Editing src/auth.ts · +42 -19
```

Every narrative event must reference its source evidence. Narration must not replace the recorded events or invent intent.

### Git Integration

Uses Git as the first recovery and file-impact mechanism.

Responsibilities:

- repository and branch detection;
- status capture;
- changed-file and diff summaries;
- before-and-after correlation windows;
- optional checkpoints before selected risky write sequences;
- checkpoint references and restore guidance.

Automated checkpoints must be conservative and should not silently alter normal history. BashGuard never silently resets the repository.

### In-Pi Approval UI

Approvals remain inside Pi because that is where the developer is acting.

The approval surface should show the materially relevant command, working directory, potential impact, explanation, and available choices. The attached companion mirrors the full context for visibility but should not require terminal switching to continue execution.

## Storage

Preferred storage order:

1. Pi session or extension entries where stable and appropriate;
2. append-only local session event files for companion access;
3. a small local session index for discovery;
4. SQLite only if real usage demonstrates indexing or scale problems.

Large command output may be stored separately and referenced from events to keep the stream tail-friendly.

## Trust Boundary

The Pi extension runs inside Pi and with the launching user's operating-system permissions.

Therefore, BashGuard can govern and record supported Pi flows, but it cannot provide a strong boundary against:

- a compromised Pi process;
- malicious extension code;
- commands launched outside Pi;
- child processes that escape observable hooks;
- direct filesystem or network actions not represented by captured tools;
- tampering by another process with equivalent user permissions.

The terminal companion improves visibility but does not create an OS security boundary.

## Privacy Boundary

All core data stays local.

The system should:

- avoid required telemetry;
- redact likely secrets before persistence;
- avoid storing full environment values by default;
- support reduced capture modes;
- make retention understandable;
- use restrictive local permissions where supported;
- clearly mark redacted data in the UI.

## Failure Behavior

- Capture failures are surfaced and recorded where possible.
- Companion disconnects do not stop Pi or event recording.
- The companion can reconnect and continue from the last known sequence.
- Partial event writes are detected and skipped or recovered safely.
- Ambiguous low-confidence risk evaluation prefers notice or approval over unexplained blocking.
- Git failures disable checkpoint features without blocking unrelated work.
- Timeline gaps are labelled incomplete.
- Narrative generation falls back to raw but readable event summaries when grouping fails.

## Performance Targets

The MVP should aim for:

- negligible impact on routine Pi tool execution;
- low-latency local event visibility in the companion;
- bounded command-output capture;
- incremental timeline rendering rather than full-session reloads;
- fast attach and session discovery for normal local histories.

Exact targets should be set after the first Pi hook and transport prototype.

## Future Architecture Triggers

A separate daemon, database, or stronger OS boundary should only be introduced if validated requirements include:

- observing processes outside Pi's extension hooks;
- enforcing filesystem or network boundaries;
- tamper resistance against the Pi process;
- reliable multi-process coordination beyond append-only files;
- durable cross-session search at a scale simple files cannot support;
- multiple harnesses writing to a shared event store;
- organization-wide collection or centralized policy.

Possible future architecture:

```text
Pi Extension
     |
     v
Optional Local Boundary Service
  |-- OS-level execution broker
  |-- durable event index
  |-- additional harness adapters
  |-- optional local browser investigation view
```

This is explicitly post-MVP.