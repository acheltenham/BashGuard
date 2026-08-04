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
bashguard session list
bashguard sessions list
bashguard setup cli --global
bashguard setup cli --local
```

Attach to a session timeline:

```bash
bashguard attach <session-selector>
bashguard attach --session <session-selector>
```

List inspectable events for a session:

```bash
bashguard inspect <session-selector>
bashguard inspect <session-selector> list events
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

Update installed Pi packages:

```bash
pi update --extensions
```

This only updates packages shown by `pi list`. If BashGuard is not listed, install it first:

```bash
pi install git:github.com/acheltenham/BashGuard
```

To update only BashGuard, use the exact source shown by `pi list`. For a GitHub install this is usually:

```bash
pi update git:github.com/acheltenham/BashGuard
```

If that reports `No matching package found`, BashGuard was not installed under that source. It may have been loaded temporarily with `pi -e ...`, installed from a local path, or not installed yet.

For pinned tags, branches, or commits, install the new ref explicitly:

```bash
pi install git:github.com/acheltenham/BashGuard@v0.1.1
```

Already-running Pi sessions keep the extension code they started with, so start a new Pi session after updating.

Install BashGuard globally for all Pi sessions:

```bash
pi install git:github.com/acheltenham/BashGuard
```

Install BashGuard project-locally in `.pi/settings.json` for the current project:

```bash
pi install -l git:github.com/acheltenham/BashGuard
```

BashGuard may surface non-blocking risk notices for a small explicit set of risky shell command patterns. Debriefs include a `Risk notices` count, and risk notes can include event sequence, cwd, command-result evidence, a plain-language risk explanation, and an `--event` inspect hint. Debriefs can also include a `Next inspect commands` section that collects useful follow-up `bashguard inspect` commands for recorded events. Debriefs can also include Git status before/after snapshots and `File tool activity` for observed read, edit, and write-tool events; `inspect` shows the same file-tool meanings for individual events and Git snapshot details for Git status events. Treat file activity as tool evidence only: `write tool` may create, overwrite, or leave content unchanged, and BashGuard should not claim create/overwrite/delete impact without before/after filesystem or Git evidence. Treat Git status snapshots as session-level before/after evidence. They may include branch, worktree path, changed-file status, line counts, changed line ranges, an observed matching file-tool event when a recorded edit/write-tool path matches a changed Git path, and a correlation confidence label such as `direct path match`. Debriefs may also note that risky shell commands occurred before a shutdown Git snapshot that showed changes with `Correlation confidence: temporal proximity only`. Because agent sessions may use separate Git worktrees rather than only branches, include worktree context when explaining snapshots. Do not treat a snapshot, matching file-tool event, or temporal proximity note as proof that a specific event caused a specific diff. Treat risk notices as observation-only review notes, not as evidence that BashGuard warned, approved, blocked, or interrupted execution.

Prefer session `#` selectors from `bashguard sessions` when available. Unique session prefixes are also acceptable. If `sessions` shows a `NAME` column, use it only as human context; selectors and prefixes remain the command inputs. Do not ask users to copy middle-truncated display IDs.

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

`pi -e ...`, `pi install ...`, and `pi install -l ...` load the BashGuard Pi extension and this skill. They do not install the `bashguard` shell command globally. Use `pi list` to confirm how BashGuard is installed before updating. Use `pi update --extensions` to update installed packages, or `pi update <source-from-pi-list>` to update one installed package. Use `pi install git:github.com/acheltenham/BashGuard@new-ref` to move pinned installs.

If `bashguard` is not on `PATH`, ask the user to run the CLI from the installed package checkout:

```bash
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard sessions
```

Or set up an explicit shell shortcut.

Global shell command:

```bash
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard setup cli --global
bashguard sessions
```

Project-local shim:

```bash
cd your-project
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard setup cli --local
./.bashguard/bin/bashguard sessions
```

During local development, they can also run from a BashGuard checkout:

```bash
npm exec -- node --experimental-strip-types src/cli.ts sessions
```

Use the same CLI arguments shown above after `src/cli.ts`.
