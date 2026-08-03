---
name: bashguard
description: Use when the user asks to observe, attach to, inspect, debrief, or explain a BashGuard-recorded Pi session, including session discovery, evidence inspection, capture gaps, redactions, truncation, or limitations around older unrecorded Pi sessions.
---

# BashGuard

BashGuard is a local-first Pi session recorder and terminal companion. Use this skill when helping a user understand what happened in a Pi session recorded by the BashGuard extension.

## Core Workflow

Discover recorded sessions:

```bash
bashguard sessions
```

Attach to a session timeline:

```bash
bashguard attach <session-selector>
bashguard attach --session <session-selector>
```

List inspectable events for a session:

```bash
bashguard inspect <session-selector>
bashguard inspect --session <session-selector>
```

Inspect one event by event ID, event ID prefix, or sequence:

```bash
bashguard inspect <session-selector> --event <event-id-or-sequence>
bashguard inspect --session <session-selector> --event <event-id-or-sequence>
```

Generate a session debrief:

```bash
bashguard debrief <session-selector>
bashguard debrief --session <session-selector>
```

BashGuard may surface non-blocking risk notices for a small explicit set of risky shell command patterns. Treat these as observation-only review notes, not as evidence that BashGuard warned, approved, blocked, or interrupted execution.

Prefer session `#` selectors from `bashguard sessions` when available. Unique session prefixes are also acceptable. Do not ask users to copy middle-truncated display IDs.

## Evidence Rules

Every narrative statement about a session must be grounded in recorded BashGuard events.

Clearly distinguish:

- `observed`: directly recorded by BashGuard
- `reported`: reported by Pi/tool output
- `inferred`: reasoned from recorded evidence
- `missing`: expected evidence was not captured
- `redacted`: sensitive data was intentionally hidden
- `truncated`: captured data was shortened
- `capture.gap`: BashGuard attempted capture but recorded a degraded or failed capture event

Do not invent provenance. If the stream lacks evidence, say so and identify the missing, redacted, truncated, or capture-gap evidence.

## Important Limitations

BashGuard can only attach to sessions recorded while the BashGuard extension was loaded and writing to the same `BASHGUARD_DATA_DIR`.

Older Pi sessions, sessions recorded before BashGuard was loaded, or sessions recorded with a different `BASHGUARD_DATA_DIR` are not available to BashGuard.

By default BashGuard stores sessions in:

```text
~/.bashguard/sessions
```

The store is shared across projects, so sessions from different repositories can appear in `bashguard sessions`.

## If the CLI Is Not Available

`pi -e ...` and `pi install ...` load the BashGuard Pi extension and this skill. They do not necessarily install the `bashguard` shell command globally.

During early development, if `bashguard` is not on `PATH`, ask the user to run the CLI from a BashGuard checkout:

```bash
npm exec -- node --experimental-strip-types src/cli.ts sessions
```

Use the same CLI arguments shown above after `src/cli.ts`.
