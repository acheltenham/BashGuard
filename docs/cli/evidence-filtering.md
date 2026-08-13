# Evidence filtering and export

Use `bashguard inspect` to navigate large recorded sessions without changing or re-running them.

## Quick examples

```bash
# Latest 50 matching shell events
bashguard inspect 1 --activity shell

# Latest 50 shell events containing "deploy" anywhere in recorded evidence
bashguard inspect 1 --activity shell --grep deploy

# Latest 200 matching events
bashguard inspect 1 --activity shell --limit 200

# Every matching event in human-readable form
bashguard inspect 1 --activity shell --all

# Every recorded event as JSON Lines
bashguard inspect 1 --all --format jsonl

# Exact event-type filtering
bashguard inspect 1 --type capture.gap
```

## Activity categories

List categories in the CLI:

```bash
bashguard inspect 1 --activity list
```

| Activity | Recorded evidence included |
| --- | --- |
| `shell` | Pi Bash requests/results and user Bash requests |
| `file` | Read, edit, and write-tool requests/results |
| `git` | Git status snapshots recorded by BashGuard |
| `risk` | Bash requests matching BashGuard's explicit non-blocking risk rules |
| `capture` | Capture gaps or events marked missing, redacted, or truncated |
| `prompt` | Recorded prompt and pre-agent-start context |
| `tool` | All tool requests and results |
| `lifecycle` | Session, agent, and turn lifecycle events |

Activities are navigation categories, not claims about effects or causality. For example, `risk` means a recorded command matched a review rule; it does not mean BashGuard blocked or approved the command.

## Exact event types

Use repeatable `--type` flags for exact event envelope types:

```bash
bashguard inspect 1 --type tool.requested
bashguard inspect 1 --type tool.requested --type tool.completed
bashguard inspect 1 --type capture.gap --all
```

Event-type names come from recorded JSONL evidence. Common current types include `session.started`, `session.shutdown`, `agent.before_start`, `tool.requested`, `tool.completed`, `bash.user_requested`, `git.status.snapshot`, and `capture.gap`.

## Combining filters

Repeat the same filter for **OR** behavior:

```bash
# Shell OR file activity
bashguard inspect 1 --activity shell --activity file

# Tool request OR tool completion
bashguard inspect 1 --type tool.requested --type tool.completed
```

Different filter kinds combine with **AND** behavior:

```bash
# Bash tool requests that contain "deploy"
bashguard inspect 1 \
  --activity shell \
  --type tool.requested \
  --grep deploy
```

`--grep` performs a case-insensitive substring search over the complete recorded event envelope, including available command, output, path, and capture metadata. It searches recorded evidence only; redacted values remain unavailable and truncated values remain partial.

Filters are applied before output limits.

## Limits

The default is the latest 50 matching events, preserved in chronological JSONL append order.

```bash
bashguard inspect 1 --activity shell --limit 100
bashguard inspect 1 --activity shell --all
```

`--limit` must be a positive integer. `--limit` and `--all` cannot be combined.

## Machine-readable JSONL

Use `--format jsonl` for scripts. Each stdout line is one normalized BashGuard event envelope. JSONL mode emits no heading, footer, or progress text to stdout; errors go to stderr.

```bash
# Export every recorded event
bashguard inspect 1 --all --format jsonl > session-events.jsonl

# Export every shell event
bashguard inspect 1 --activity shell --all --format jsonl > shell-events.jsonl

# Extract sequence, event ID, and command with jq
bashguard inspect 1 --activity shell --all --format jsonl |
  jq -r '[.sequence, .id, (.payload.input.command // .payload.command // "")] | @tsv'

# Count exact event types
bashguard inspect 1 --all --format jsonl |
  jq -r '.type' |
  sort |
  uniq -c
```

JSONL preserves evidence and capture metadata but does not restore values that were never captured, redacted, or truncated.

## Text output and event inspection

Human-readable filtered output shows sequence numbers and event ID prefixes. Inspect one result for full recorded details:

```bash
bashguard inspect 1 --activity capture
bashguard inspect 1 --event <sequence-or-event-id-prefix>
```

Use an event ID prefix when a sequence is ambiguous because recorder restarts can reuse sequence numbers.

## Validation rules

- `--event` cannot be combined with filtering or formatting options.
- `--activity list` cannot be combined with other filters.
- Unknown activities produce an error and point to `--activity list`.
- Supported formats are `text` and `jsonl`.
- Filtering never queries GitHub, deployment providers, or other remote services.
