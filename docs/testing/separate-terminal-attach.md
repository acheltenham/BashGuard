# Separate-Terminal Attach Test

This test validates the first BashGuard companion workflow: Pi runs in one terminal while the `bashguard` CLI discovers and follows the same local session from another terminal.

## Current result

Validated on August 3, 2026 against Pi `0.80.6`. A second process successfully discovered an active Pi session, attached to the JSONL stream, rendered live file/shell/write/edit/capture-gap events, observed `session.shutdown`, reopened the completed session by ID prefix, inspected individual events, and generated a debrief.

## Setup

Use current `main` unless testing a feature branch:

```bash
npm install
npm test
npm run check
```

The CLI currently uses Node's built-in TypeScript stripping, so use a current Node release that supports `--experimental-strip-types`.

## Terminal 1: run Pi with BashGuard

From the BashGuard repository or another disposable Git repository:

```bash
BASHGUARD_DATA_DIR=/tmp/bashguard-attach-test \
pi -e /path/to/BashGuard
```

Run a normal coding prompt that causes Pi to read a file, edit or write a file, and execute at least one shell command.

Inside Pi you can confirm recording with:

```text
/bashguard-status
```

## Terminal 2: list sessions

From the BashGuard checkout:

```bash
BASHGUARD_DATA_DIR=/tmp/bashguard-attach-test \
node --experimental-strip-types src/cli.ts sessions
```

Expected shape:

```text
#  STATE     SESSION              REPOSITORY           UPDATED
1  active    019fc93a             BashGuard            2s ago

Use a # or SESSION prefix, for example:
  bashguard attach 1
  bashguard inspect 1 --event <event-id-or-sequence>
  bashguard debrief 1
```

The `SESSION` value is a copyable unique prefix, not a middle-truncated display-only ID.

## Terminal 2: attach

When only one Pi session is active:

```bash
BASHGUARD_DATA_DIR=/tmp/bashguard-attach-test \
node --experimental-strip-types src/cli.ts attach
```

Or select a session explicitly by list number, `--session`, full ID, or unique prefix. Positional IDs remain supported; use the single-argument `--session=<value>` form when an ID or prefix begins with `--` or matches an inspect alias (`list` or `events`):

```bash
BASHGUARD_DATA_DIR=/tmp/bashguard-attach-test \
node --experimental-strip-types src/cli.ts attach 1

BASHGUARD_DATA_DIR=/tmp/bashguard-attach-test \
node --experimental-strip-types src/cli.ts attach --session 1

BASHGUARD_DATA_DIR=/tmp/bashguard-attach-test \
node --experimental-strip-types src/cli.ts attach --session=--example-session

BASHGUARD_DATA_DIR=/tmp/bashguard-attach-test \
node --experimental-strip-types src/cli.ts attach <session-id-or-unique-prefix>
```

The initial renderer intentionally keeps the output simple. Expected narration includes lines such as:

```text
 1  msdmhl1a  15:42:10  Pi session started
 2  msdmhl1b  15:42:17  Prompt · Inspect the authentication flow and run the tests.
 9  msdmhl2c  15:42:20  Reading · README.md
10  msdmhl2d  15:42:24  Running · git status --short
11  msdmhl2e  15:42:24  Command complete · exit 0
17  msdmhl3r  15:42:31  Editing · src/auth.ts
```

Interactive user bash should appear separately:

```text
15:43:01  You ran · pwd
```

## Terminal 2: inspect and debrief

List inspectable events for a session:

```bash
BASHGUARD_DATA_DIR=/tmp/bashguard-attach-test \
node --experimental-strip-types src/cli.ts inspect 1
```

Then inspect an event sequence or short event ID from the timeline:

```bash
BASHGUARD_DATA_DIR=/tmp/bashguard-attach-test \
node --experimental-strip-types src/cli.ts inspect 1 --event <event-id-prefix-or-sequence>
```

The `--session` forms also work:

```bash
BASHGUARD_DATA_DIR=/tmp/bashguard-attach-test \
node --experimental-strip-types src/cli.ts inspect --session 1 --event <event-id-prefix-or-sequence>

BASHGUARD_DATA_DIR=/tmp/bashguard-attach-test \
node --experimental-strip-types src/cli.ts inspect --session=events --event <event-id-prefix-or-sequence>
```

Generate a session debrief:

```bash
BASHGUARD_DATA_DIR=/tmp/bashguard-attach-test \
node --experimental-strip-types src/cli.ts debrief 1
```

Expected debrief shape:

```text
Session complete

Duration         18s
Prompts          1
Tool calls       5
Shell commands   1
Files observed   2
Failed commands  0
Capture state    Complete
```

Capture gaps, redactions, and truncations should make `Capture state` partial and appear under `Worth reviewing`.

## What to verify

### Session discovery

- `sessions` shows the current active Pi session.
- Repository name and session ID are correct.
- Completed sessions remain visible after Pi exits.
- Two active Pi sessions are shown separately.

### Attachment

- `attach` chooses the only active session automatically.
- Multiple active sessions require an explicit session ID.
- A unique session-ID prefix is accepted.
- Historical events render first, followed by new live events.
- Exiting the BashGuard process does not affect Pi.

### Live tailing

- New Pi events appear without restarting BashGuard.
- Events are not duplicated.
- `Ctrl-C` detaches without affecting the Pi session.
- Re-running `attach` shows the existing history once and continues from the end.
- When Pi exits, BashGuard eventually reports `Pi session ended.` and exits cleanly.

### JSONL robustness

The reader intentionally buffers a partial final JSONL line until a newline arrives. A malformed complete line is skipped rather than terminating the companion.

## Current limitations

This is still a vertical slice, not the final TUI.

- No full-screen interface yet.
- No keyboard navigation or in-terminal event selection yet; use `inspect` with event ID or sequence.
- Narration covers only the event types already proven useful.
- No durable attach cursor is persisted between separate CLI invocations; deduplication is based on event sequence during each invocation.
- No file-impact or Git correlation yet beyond tool-level file paths and edit diffs/patches.
- No policy or approval UI.

BashGuard can only attach to sessions recorded while the BashGuard extension was loaded and writing to the same `BASHGUARD_DATA_DIR`. Older Pi sessions without BashGuard JSONL records cannot be attached retroactively.

Please record Milestone 0 findings on Issue #1.
