# Live attach history

`bashguard attach` is the second-terminal live companion for a BashGuard-recorded Pi session.

Attach begins with an evidence-grounded status snapshot. By default it then shows the latest 50 narrated events that already exist when attach starts and displays every new narrated event as it is appended.

```bash
bashguard attach 1
```

The startup limit changes terminal presentation only. It does not remove, truncate, or rewrite recorded JSONL evidence.

## Status snapshot

Active sessions show:

```text
Live status
State             active
Current activity  Running · npm test
Evidence          request recorded; completion not recorded yet
Capture           No recorded capture limitations
Events            42
Last observed     2s ago
```

`Current activity` appears only when BashGuard recorded a tool request with a `toolCallId` and has not recorded a later matching completion in the latest recorded session lifecycle segment. It means completion evidence is absent; it does not prove the tool is still executing. Older requests before a later `session.started` event are not treated as current.

If there is no correlated outstanding request, attach shows `Last activity` from the latest narrated event and labels it `recorded event`. Completed sessions always use `Last activity` and a `Session status` heading; activity projection stops at the latest shutdown in the current lifecycle segment so post-shutdown legacy appends do not masquerade as completed-session activity.

Capture is summarized from recorded `capture.gap` events and event-level missing, redacted, and truncated metadata. Empty sessions say `No capture metadata recorded`. Freshness uses the latest event timestamp and falls back to `unknown` when unavailable or malformed.

Long or multiline activity is compacted to one bounded status line; inspect/JSONL retains the fuller recorded evidence subject to original capture limits.

The snapshot is calculated when attach starts. This first Phase 1 slice does not redraw the block while new events arrive; the timeline remains the live-updating surface.

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

The same options work with `--session`:

```bash
bashguard attach --session 1 --history 25
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

`Ctrl-C` stops the observer only. It does not stop, interrupt, approve, or block Pi.

## Evidence and ordering

- Historical and live presentation follows canonical JSONL append order.
- The CLI tracks all event IDs already present at startup, including events outside the visible history window.
- Event sequence numbers can repeat after recorder restarts; event ID prefixes remain the unambiguous selector.
- Attach narration remains grounded in recorded evidence.
- A missing, redacted, truncated, or uncaptured value is not restored by requesting more history.
