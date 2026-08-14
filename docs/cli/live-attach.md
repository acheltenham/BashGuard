# Live attach history

`bashguard attach` is the second-terminal live companion for a BashGuard-recorded Pi session.

By default attach shows the latest 50 narrated events that already exist when it starts and displays every new narrated event as it is appended. For an active session in a supported TTY, the ordinary header, bounded history, and guidance appear first, followed by an evidence-grounded sticky footer that replaces the startup static status block.

```bash
bashguard attach 1
```

The startup limit changes terminal presentation only. It does not remove, truncate, or rewrite recorded JSONL evidence.

## Choosing a session

A selector is optional:

```bash
bashguard attach
```

Selector-less attach chooses its sole eligible session automatically. If active sessions exist, only they are eligible: one active session is automatic and multiple active sessions open a numbered picker when both stdin and stdout are TTYs. If no session is active, all discovered completed sessions become the candidates, with the same sole-candidate automatic selection and multiple-candidate picker behavior.

The picker requires an exact displayed number. Enter has no default, invalid input prints concise guidance and retries, and EOF or `Ctrl+C` cancels concisely. Explicit numeric selectors, exact session IDs, and unique ID prefixes bypass the picker. An exact session ID takes precedence when it is also a valid numeric row number.

Non-TTY scripts, pipes, and redirected output never prompt. With multiple eligible sessions, attach exits nonzero and prints eligible rows plus copyable commands using a globally unique ID prefix or full ID. Automation that allocates a PTY is interactive by contract and must pass an explicit selector to avoid prompting; explicit selectors are recommended for all automation. With no recorded sessions, attach uses the existing `No BashGuard sessions found` error and does not print candidate rows or commands. Selection uses one discovery snapshot: rows retain their global positions within that snapshot and are not locally renumbered. Numbers can change after discovery ordering changes and an explicit number resolves against the current order unless it exactly matches a session ID; globally unique ID prefixes or full IDs remain durable against the full snapshot, including completed sessions hidden by an active-only picker. This is a structured-text prompt, not the planned full-screen split-pane TUI.

## Live status footer

Sticky mode activates only for a selected active session when stdout is a TTY, `TERM` is present and not `dumb`, and `--no-live-footer` is not supplied. A wide terminal shows compact output such as:

```text
────────────────────────────────────────
ACTIVE · Running · npm test
awaiting completion evidence
capture ok · 2s ago · 42 ev
```

`Current activity` appears only when BashGuard recorded a tool request with a `toolCallId` and has not recorded a later matching completion in the latest recorded session lifecycle segment. The compact footer says `awaiting completion evidence`: completion evidence is absent, but this does not prove the tool is still executing. Older requests before a later `session.started` event are not current. With no correlated outstanding request, the footer shows the latest narrated activity as `recorded`.

Capture is compactly summarized as `capture ok`, `capture partial`, or `capture unknown`, with available gap, missing, redacted, and truncated counts. Freshness uses the latest event timestamp and falls back to `unknown` when unavailable or malformed. Accepted event changes update immediately; when nothing else changes, freshness redraws at about a one-second cadence rather than every 250 ms poll.

The adaptive layout is bounded by measured terminal display cells and truncates only at grapheme boundaries:

- 72 columns or wider: three content lines below a separator;
- 40–71 columns: up to four content lines below a separator;
- below 40 columns: one compact line.

On resize BashGuard clears its tracked footer lines and redraws at the new width. Before printing a new narrated event, it clears the footer, writes the timeline event, and redraws the footer beneath it. Recorded shutdown stops refresh, clears the temporary footer, and prints one final ordinary completed status block. `Ctrl+C` and unexpected ordinary errors clear the temporary region and scoped handlers. If a stream-accepted write fails with `EPIPE`, BashGuard instead disables footer/output and removes scoped handlers/listeners without attempting another write or printing a stack trace. It cannot guarantee that already-visible temporary footer lines are cleared because stream and terminal state are then unknowable.

Completed sessions and active attaches with non-TTY output, piped/redirected stdout, missing `TERM`, `TERM=dumb`, or `--no-live-footer` retain the ordinary status block and timeline behavior and emit no footer-generated ANSI or cursor-control sequences. Arbitrary recorded timeline payloads are not guaranteed to contain no escape bytes. The footer never enters the alternate screen or hides the cursor and is not a full split-pane TUI.

Long or multiline activity is compacted for presentation only; inspect/JSONL retains fuller recorded evidence subject to original capture limits. Attach drains final recorded appends and follows a replacement recorder when replacement evidence is visible during shutdown confirmation. An authoritative shutdown otherwise ends attach; a later restart requires running attach again.

## History options

```bash
# Default: latest 50 narrated historical events, then every new event
bashguard attach 1

# Latest 100 narrated historical events, then every new event
bashguard attach 1 --history 100

# Do not print existing narration; follow every event recorded after attach starts
bashguard attach 1 --history 0

# Print all existing narrated events before following
bashguard attach 1 --all-history
```

`--history` must be a non-negative integer. `--history` and `--all-history` cannot be combined.

The same options work with `--session`. Use `--no-live-footer` when ordinary static text is preferable:

```bash
bashguard attach --session 1 --history 25
bashguard attach --session 1 --no-live-footer
```

## What is bounded

The limit applies only to **narrated historical events** present when attach starts. Narrated events are events with a meaningful default timeline projection, such as:

- session start/shutdown;
- prompts;
- shell requests/results;
- reads, edits, and writes;
- Git snapshots;
- capture gaps;
- agent completion.

Some recorded lifecycle/message events intentionally have no default timeline narration. Attach reports how many such events exist and directs users to inspect for raw evidence.

After startup, every newly appended narrated event is displayed. There is no live-event count limit.

## Complete evidence paths

Use inspect and JSONL export when complete event access is required:

```bash
# Recent inspectable timeline
bashguard inspect 1

# Filter recorded evidence
bashguard inspect 1 --activity shell --all

# Export every normalized recorded event
bashguard inspect 1 --all --format jsonl > session-events.jsonl

# Inspect one event in detail
bashguard inspect 1 --event <sequence-or-event-id-prefix>
```

Attach history limiting never changes these results.

## Completed sessions

For a completed session, attach prints the selected historical narration and exits. It does not enter live-follow mode.

```bash
bashguard attach 1 --history 20
bashguard attach 1 --all-history
```

For detailed completed-session investigation, prefer filters, JSONL export, and debrief:

```bash
bashguard inspect 1 --activity risk --all
bashguard debrief 1
```

## Detaching

For an active session:

```text
Following live events. Every new narrated event will be shown. Ctrl-C to detach.
```

`Ctrl-C` clears the temporary footer and stops the observer only. It does not stop, interrupt, approve, or block Pi.

## Evidence and ordering

- Historical and live presentation follows canonical JSONL append order.
- The CLI tracks all event IDs already present at startup, including events outside the visible history window.
- Event sequence numbers can repeat after recorder restarts; event ID prefixes remain the unambiguous selector.
- Attach narration remains grounded in recorded evidence.
- A missing, redacted, truncated, or uncaptured value is not restored by requesting more history.
