# Separate-Terminal Attach Test

This test validates the first BashGuard companion workflow: Pi runs in one terminal while the `bashguard` CLI discovers and follows the same local session from another terminal.

## Branch

```bash
git switch agent/separate-terminal-attach
npm install
npm run check
```

The CLI currently uses Node's built-in TypeScript stripping, so use a current Node release that supports `--experimental-strip-types`.

## Terminal 1: run Pi with BashGuard

From the BashGuard repository or another disposable Git repository:

```bash
BASHGUARD_DATA_DIR=/tmp/bashguard-attach-test \
pi -e /path/to/BashGuard
```

Run a normal coding prompt that causes Pi to read a file and execute at least one shell command.

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
STATE     SESSION              REPOSITORY           UPDATED
active    <session-id>         BashGuard            2s ago
```

## Terminal 2: attach

When only one Pi session is active:

```bash
BASHGUARD_DATA_DIR=/tmp/bashguard-attach-test \
node --experimental-strip-types src/cli.ts attach
```

Or select a session explicitly:

```bash
BASHGUARD_DATA_DIR=/tmp/bashguard-attach-test \
node --experimental-strip-types src/cli.ts attach <session-id-or-unique-prefix>
```

The initial renderer intentionally keeps the output simple. Expected narration includes lines such as:

```text
15:42:10  Pi session started
15:42:17  Prompt · Inspect the authentication flow and run the tests.
15:42:20  Reading · README.md
15:42:24  Running · git status --short
15:42:24  Command complete · exit 0
15:42:31  Editing · src/auth.ts
```

Interactive user bash should appear separately:

```text
15:43:01  You ran · pwd
```

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
- No keyboard navigation or event expansion yet.
- Narration covers only the event types already proven useful.
- Session liveness is inferred from the recorder's process ID.
- No durable attach cursor is persisted between separate CLI invocations; deduplication is based on event sequence during each invocation.
- No file-diff or Git correlation yet.
- No policy or approval UI.

Please record findings on Issue #3.
