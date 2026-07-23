# BashGuard Architecture

**Status:** Draft v0.2  
**Last updated:** July 22, 2026

## Architecture Decision

The BashGuard MVP will be implemented as a TypeScript extension running inside Pi.

A Rust daemon, SQLite database, browser dashboard, and local API are not part of the MVP. Pi already provides the lifecycle hooks, tool interception, extension state, session model, and terminal UI needed to validate the core product.

## MVP Architecture

```text
Pi
  |
  v
BashGuard Extension (TypeScript)
  |-- Event Capture
  |-- Command Resolution
  |-- Risk Evaluation
  |-- Explainable Decisions
  |-- Timeline Correlation
  |-- Git Integration
  |-- Pi Terminal UI
  |
  +--> Pi Session / Extension Entries
  |
  +--> Optional Local Index File
```

## Components

### Event Capture

Subscribes to supported Pi lifecycle and tool events and normalizes them into BashGuard events.

Responsibilities:

- session lifecycle capture
- prompt or turn correlation when available
- tool-call and result capture
- command-start and completion capture
- explicit completeness markers when correlation is unavailable

### Command Resolution

Builds the most accurate representation of what will execute before approval.

Responsibilities:

- command text capture
- working-directory capture
- shell prefix and wrapper visibility
- command-chain and pipeline inspection
- targeted path extraction
- sensitive-value redaction

The resolved preview must never claim completeness when aliases, shell expansion, or runtime behavior remain unknown.

### Risk Evaluation

Applies a small built-in set of transparent checks.

Initial checks may include:

- recursive or broad deletion
- writes outside the repository
- privileged execution
- sensitive home-directory access
- destructive database operations
- destructive Git operations
- hidden or unexpected command prefixes

The MVP does not require a general-purpose policy engine.

### Explainable Decisions

Produces one of four outcomes:

- allow
- allow with notice
- require approval
- block

Each result includes a plain-language reason, matched condition, affected resource, and safer alternative where useful.

### Timeline Correlation

Connects Pi events into a chronological execution story.

Correlation should use stable Pi identifiers where available and locally generated IDs where necessary. Missing causal links must be visible rather than inferred as fact.

### Git Integration

Uses Git as the first recovery and file-impact mechanism.

Responsibilities:

- repository and branch detection
- status capture
- changed-file summaries
- diff summaries
- optional checkpoints before risky write sequences
- checkpoint references and restore guidance

Automated checkpoints must be conservative and should not silently alter the developer's intended history.

### Pi Terminal UI

The MVP UI remains inside Pi.

Planned surfaces:

- resolved-command approval dialog
- risk and decision explanation
- persistent status indicator
- session summary
- timeline browser
- event detail inspector

## Storage

The preferred storage order is:

1. Pi extension entries or session-associated state
2. a small local JSONL or index file when required for browsing or retention
3. SQLite only if real usage demonstrates indexing or scale problems

BashGuard should not introduce a database merely because it may be useful later.

## Trust Boundary

The TypeScript extension runs inside Pi and with the launching user's operating-system permissions.

Therefore, the MVP can govern commands flowing through supported Pi hooks, but it cannot provide a strong boundary against:

- a compromised Pi process
- malicious extension code
- commands launched outside Pi
- child processes that escape observable hooks
- direct filesystem or network actions not represented as intercepted tools

BashGuard must describe itself as an in-process command guard and flight recorder, not an OS sandbox.

## Privacy Boundary

All core data stays local.

The extension should:

- avoid required telemetry
- redact likely secrets before persistence
- avoid storing full environment values by default
- support reduced capture modes
- make retention understandable

## Failure Behavior

BashGuard must fail safely without making Pi unusable.

- Capture failures should be surfaced and recorded where possible.
- Ambiguous low-confidence risk evaluation should prefer a notice or approval over an unexplained block.
- Git failures should disable checkpoint features without blocking unrelated work.
- Timeline gaps should be labelled as incomplete.

## Future Architecture Triggers

A separate daemon or OS boundary should only be introduced if validated requirements include:

- observing processes outside Pi's extension hooks
- enforcing filesystem or network boundaries
- tamper resistance against the Pi process
- durable cross-session indexing beyond simple local files
- multiple harnesses writing to a shared event store
- organization-wide collection or centralized policy

Possible future architecture:

```text
Pi Extension
     |
     v
Optional Local Boundary Service
  |-- OS-level execution broker
  |-- durable event index
  |-- additional harness adapters
  |-- optional local web UI
```

This is explicitly post-MVP.