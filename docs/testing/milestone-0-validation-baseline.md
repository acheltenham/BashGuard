# Milestone 0 validation baseline

**Status:** Completed validation run
**Date:** August 13, 2026

This document records the reproducible measurements and controlled smoke checks used to validate the BashGuard Milestone 0 foundation. Results are observations from the stated environment and methodology, not universal performance guarantees.

## Environment

- Platform: macOS 26.5.2
- Architecture: x86_64
- Node.js: v26.4.0
- npm: 11.17.0
- Pi used for real-session smoke checks: 0.83.0
- BashGuard branch: `test/milestone-0-validation-baseline`
- Storage: local temporary directories
- BashGuard attach polling interval: 250 ms

## Reproduce the synthetic baseline

Human-readable output:

```bash
npm run baseline:milestone-0 -- --samples 25
```

Clean JSON output:

```bash
node --experimental-strip-types scripts/milestone-0-baseline.ts \
  --samples 25 \
  --json
```

The automated suite also runs the baseline with three samples:

```bash
npm test
```

The runner creates an isolated synthetic BashGuard session, starts the real `src/cli.ts attach` process, appends uniquely identifiable events, waits until each appears in attach output, and removes its temporary data afterward.

## Live event latency

The measured interval starts immediately before appending one complete JSONL event and ends when its event ID prefix appears in the real attach process stdout.

Observed 25-sample result:

| Measurement | Result |
| --- | ---: |
| Initial attach to first existing narrated event | 180.31 ms |
| Median append-to-display latency | 251.14 ms |
| p95 append-to-display latency | 252.42 ms |
| Maximum append-to-display latency | 254.47 ms |
| Configured polling interval | 250 ms |

The distribution is consistent with polling every 250 ms. The benchmark measures local append-to-CLI visibility, not Pi hook dispatch time, terminal rendering latency, network latency, or a service-level objective.

## Storage overhead

The deterministic storage fixture includes:

1. session start;
2. Bash request;
3. Bash result;
4. edit request;
5. edit result;
6. result with explicitly truncated capture metadata;
7. Git status snapshot.

Observed fixture result:

| Measurement | Result |
| --- | ---: |
| Event count | 7 |
| JSONL event bytes | 3,644 bytes |
| Session metadata bytes | 236 bytes |
| Total fixture bytes | 3,880 bytes |
| Mean JSONL bytes/event | 520.57 bytes |

Per-event JSONL sizes:

| Fixture event | Bytes |
| --- | ---: |
| `session.started` | 341 |
| `tool.requested:shell` | 397 |
| `tool.completed:shell` | 457 |
| `tool.requested:edit` | 438 |
| `tool.completed:edit` | 469 |
| `tool.completed:truncated` | 976 |
| `git.status.snapshot` | 566 |

These values characterize the sanitized fixture only. Real sessions vary with command length, tool payloads, output, diffs, truncation, redaction, message capture, and Git changed-file details. BashGuard intentionally truncates selected large strings rather than implying unlimited capture.

## Failure behavior

### Malformed and incomplete JSONL

Automated tests confirm that CLI parsing:

- skips malformed complete lines instead of crashing;
- ignores an incomplete final line until it is completed;
- preserves canonical JSONL append order.

### Event stream becomes unwritable after startup

An extension integration regression test starts recording, replaces `events.jsonl` with a directory, and dispatches a tool event.

Observed behavior:

- the tool-event handler does not reject;
- the primary event append fails;
- the fallback `capture.gap` append also fails because the stream is entirely unusable;
- BashGuard sends an error notification through Pi UI;
- Pi remains usable.

### Storage cannot initialize

A controlled real Pi session used:

```bash
BASHGUARD_DATA_DIR=/dev/null pi -e /absolute/path/to/BashGuard ...
```

Observed behavior:

- Pi reported the extension `ENOTDIR` error on stderr;
- Pi still read the requested fixture and returned the expected answer;
- Pi exited successfully;
- BashGuard could not create a session directory or persist a `capture.gap` because the configured root was not a directory.

This is a visible, non-blocking failure, but no local BashGuard evidence exists for that session. Users must correct `BASHGUARD_DATA_DIR` and start a new Pi session.

### Duplicate extension instances

The separate duplicate-recorder smoke test remains passing:

- one recorder owns the per-session lock;
- a second instance warns and remains inactive;
- prompt/tool/shutdown events are recorded once;
- the lock is removed on shutdown.

## Fresh real-Pi workflow

A new temporary Git repository was created with a deliberately failing Node test (`41 !== 42`). Pi was asked to:

1. read project files;
2. run the failing test;
3. edit `answer.js` with the edit tool;
4. rerun the test successfully;
5. run `git status --short`;
6. summarize the result.

Observed BashGuard evidence:

- one prompt;
- eight tool calls;
- four shell commands;
- one failed shell command;
- read and edit tool events;
- test failure with exit 1;
- successful rerun reported by tool output;
- start/shutdown Git snapshots (`clean -> dirty`);
- changed file `answer.js` with `+1/-1` details;
- completed session and complete capture state for the tested fields.

The following CLI surfaces were exercised against the new recording:

```bash
bashguard doctor
bashguard sessions
bashguard attach <session>
bashguard inspect <session>
bashguard inspect <session> --event <selector>
bashguard inspect <session> --activity shell --all
bashguard inspect <session> --activity file --all
bashguard inspect <session> --all --format jsonl
bashguard debrief <session>
```

JSONL output parsed successfully with `jq`.

## Active real-Pi attach

A second controlled Pi session ran `sleep 5`, then read `README.md`. `bashguard attach` started while Pi was active.

Attach displayed, in order:

- existing session start/prompt evidence;
- `Following live events`;
- `Running · sleep 5`;
- Bash completion;
- `Reading · README.md`;
- read completion;
- session shutdown.

Attach exited when shutdown was recorded. This confirms the second-terminal live-follow path against a real Pi session, not only synthetic JSONL.

## Inside-Pi skill workflow

A new Pi invocation loaded the BashGuard package and was asked to use the bundled BashGuard skill to inspect the completed controlled session.

It correctly reported, from BashGuard evidence:

- session complete;
- one failed command;
- changed file `answer.js` with `+1/-1`.

This confirms the inside-Pi investigation path as well as the separate-terminal CLI path.

## Known limitations observed during validation

- Pi tool completions do not always include structured exit-code details; BashGuard reports command-result completeness rather than inventing an exit code.
- A combined multiline Bash command is compacted in filtered text output; full recorded evidence remains available through inspect/JSONL subject to capture truncation.
- Entirely unusable storage cannot contain its own capture-gap evidence. The only available signal is Pi's visible extension error/notification.
- Performance results are local measurements, not guarantees across filesystems, machines, or Pi versions.
- Git/file path overlap and temporal proximity remain correlation evidence, not proof of causality.

## Milestone decision

The split-pane TUI is **not required for Milestone 0 correctness**. The structured plain-text companion now supports discovery, live attach, event details, deterministic filtering, JSONL export, and debriefing with visible evidence limitations.

The split-pane timeline/detail interface, narrow-terminal optimization, richer current-activity footer, and interactive navigation move to **Phase 1: Live Terminal Companion**.

Milestone 0 is complete. Phase 1 live-companion work is tracked separately from this validated foundation.
