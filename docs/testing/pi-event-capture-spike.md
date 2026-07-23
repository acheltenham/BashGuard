# Pi Event Capture Spike

This branch implements the first BashGuard capability spike: record the Pi extension events exposed during one real coding session.

## What it captures

- session start and shutdown
- before-agent, agent start, and agent end
- turn start and end
- message start and end
- tool calls and results
- direct user bash commands

Events are normalized into append-only JSONL and written locally under:

```text
~/.bashguard/sessions/<session-id>/
  session.json
  events.jsonl
```

Set `BASHGUARD_DATA_DIR` to use a different directory.

## Install from this branch

For a one-off test:

```bash
pi -e git:github.com/acheltenham/BashGuard@agent/pi-event-capture-spike
```

For a local checkout:

```bash
git clone https://github.com/acheltenham/BashGuard.git
cd BashGuard
git switch agent/pi-event-capture-spike
npm install
npm run check
pi -e .
```

To install it globally in Pi:

```bash
pi install git:github.com/acheltenham/BashGuard@agent/pi-event-capture-spike
```

## Controlled test session

Run Pi in a disposable Git repository and ask it to:

1. read `README.md`;
2. run `git status --short`;
3. create or edit a temporary text file;
4. read that file;
5. run one failing and one successful shell command;
6. finish the turn.

Inside Pi, run:

```text
/bashguard-status
```

This prints the detected BashGuard session ID, number of recorded events, and storage directory.

## Inspect the output

```bash
cat ~/.bashguard/sessions/<session-id>/session.json
jq . ~/.bashguard/sessions/<session-id>/events.jsonl
```

Useful checks:

- Are tool request and result events linked by `toolCallId`?
- Are turn or message identifiers present in the raw payloads?
- Does the derived session ID remain stable?
- Are file operations visible as `read`, `edit`, or `write` tool events?
- Are direct user bash commands distinguishable from agent `bash` tool calls?
- Are any secrets or credentials present in persisted payloads?
- Does Pi continue normally if the recorder cannot write?

## Known limitations

This is instrumentation code, not the production BashGuard recorder.

- The session ID fallback may use Pi's current leaf ID when an explicit session file or ID is not exposed on the runtime object.
- Payload redaction is key-name based and incomplete. Use a disposable repository without real credentials.
- Full message and tool result payloads are capped at 16,000 characters per string.
- This branch does not provide the separate-terminal TUI yet.
- It does not intercept, approve, or block commands.
- It does not claim complete provenance.

Record findings in GitHub Issue #2 and update `docs/research/pi-capability-matrix.md` once the real hook payloads are known.
