# Split-Pane Event Browser Design

**Status:** Draft — pending approval  
**Date:** August 17, 2026  
**Phase:** Phase 1 — Live Terminal Companion

## Goal

Let a developer walk a recorded session's timeline and read the evidence behind any single event without re-running a command per event, while leaving every existing plain-text and JSONL workflow byte-for-byte unchanged.

Today, moving from "which event was surprising?" to "what does that event actually record?" costs two separate commands and a copy-paste:

```bash
bashguard inspect 1
bashguard inspect 1 --event 44
```

The browser collapses that loop into one keyboard-driven view: a chronological event list on the left, the selected event's recorded detail on the right.

## Scope

In scope:

- a full-screen, keyboard-first browser over one session's recorded events;
- split-pane layout on wide terminals, single-pane replacement view on narrow ones;
- in-view activity filtering and case-insensitive search reusing existing filter semantics;
- an explicit snapshot-reload key.

Explicitly not in scope for this slice:

- live tailing inside the browser (the browser shows a snapshot; `bashguard attach` remains the live surface);
- replay controls, stepping, or timeline scrubbing (Phase 5);
- mouse support, color-only signaling, or any change to recorded evidence;
- changing what `bashguard inspect` prints without the new flag.

## Command surface

```text
bashguard inspect [session] --browse
```

`--browse` is opt-in and cannot be combined with `--event`, `--activity`, `--type`, `--grep`, `--limit`, `--all`, or `--format`; those are one-shot evidence-projection options and the browser owns filtering interactively. Combining them fails validation before session selection, in the same place and the same way `inspect()` already rejects `--event` alongside filters.

Session selection is unchanged: `--browse` runs through `selectSessionForCommandResult("inspect", …)`, so a sole recorded session is automatic and multiple candidates use the existing structured-text picker before the browser opens.

**Why opt-in rather than the interactive default.** The live footer could turn itself on for active TTY attach because it was additive: the timeline above it was unchanged. The browser is not additive — it replaces the entire `bashguard inspect 1` listing that people copy selectors out of today. Issue #61's evidence rules require that TUI behavior not make plain-text workflows less scriptable, and an explicit flag guarantees that absolutely rather than by TTY heuristic. Whether `--browse` should later become the interactive default (with `--no-browse` to opt out, mirroring `--no-live-footer`) is recorded below as a deferred decision to revisit after real use.

## Presentation

### Split pane, 80 columns or wider

```text
BashGuard · browse            019fca00 · BashGuard · complete · snapshot 19:45:03
─────────────────────────────────────────┬──────────────────────────────────────
  41  msdvm4a8  19:44:31  Reading · src/ │ Sequence   44
  42  msdvm5br  19:44:37  Prompt · fix t │ Event ID   msdvm7c2f19e4b0a
  43  msdvm6l9  19:44:38  Running · npm  │ Type       tool.completed
▸ 44  msdvm7c2  19:44:52  Command failed │ Timestamp  2026-08-14T19:44:52.104Z
  45  msdvm8k1  19:45:03  Editing · src/ │ Evidence   observed
  46  msdvm9d4  19:45:11  Running · npm  │ Tool       bash
                                         │ Command    npm test -- --runInBand
                                         │ Exit code  1
                                         │ Cwd        /Users/dev/BashGuard
                                         │
                                         │ Payload
                                         │ {
                                         │   "toolName": "bash",
                                         │   "details": {
─────────────────────────────────────────┴──────────────────────────────────────
44/128 narrated · 156 recorded · no filter · ↑↓ move · Enter detail · ? help · q
```

Pane widths derive from a budget rather than fixed columns: the detail pane takes `clamp(round(width × 0.45), 36, 72)` display cells, a three-cell gutter carries the `│` separator, and the list pane takes the remainder. At 80 columns that yields a 41-cell list and a 36-cell detail pane; at 160 it yields 85 and 72.

### Single pane, below 80 columns

The list fills the frame. `Enter` replaces it with the detail view for the selected event, and `Esc` returns to the list. Both views keep the same header and status bar. Rows compress by dropping the event-ID column first, then the timestamp, keeping sequence and narration longest — the same content-priority approach the footer already uses.

Row and detail text use `string-width` display-cell measurement and `Intl.Segmenter` grapheme boundaries so CJK and emoji neither split nor overflow, reusing the bounding helpers proven by the footer work.

## Navigation

```text
↑ / k          previous event
↓ / j          next event
PgUp / PgDn    page through the list
g / G          first / last event
Enter          open detail (single pane) · focus detail pane (split)
Tab            move focus between panes (split only)
Esc            close detail, clear search, or close help
/              search recorded evidence
n / N          next / previous search match
a              cycle the activity filter
c              clear filters and search
r              reload the session snapshot
?              help overlay
q / Ctrl+C     quit
```

`docs/vision/terminal-ux.md` records these keys as design candidates rather than a frozen API. This slice deviates from the candidate list in two places: `c` clears filters rather than jumping to commands, and `r` reloads rather than starting replay. When Phase 5 lands, replay picks an unbound key rather than displacing a key users already learned.

Selection follows the list: moving the selection immediately re-renders the detail pane. Focus in the detail pane redirects `↑`/`↓`/`PgUp`/`PgDn` to scrolling the recorded payload, which is frequently longer than the frame.

## Filtering and search

The browser reuses the existing projections rather than inventing parallel ones:

- activity cycling calls `eventMatchesActivity` with the same `ActivityKind` values `--activity` accepts, plus an `all recorded` state described below;
- search uses the `--grep` semantics already implemented in `filterEvidenceEvents`: case-insensitive substring matching over the serialized event;
- the detail pane renders `formatEventInspection` output for the selected event;
- list rows render `formatTimelineEvent`.

Two rules keep filtering from hiding evidence:

1. The status bar always states both counts — `44/128 narrated · 156 recorded` — plus the active filter and search, so the user can always see that something is excluded and why.
2. The default view lists narrated events, and the activity cycle includes an explicit `all recorded` state that lists every recorded event, falling back to the event type as the row label where `formatTimelineEvent` returns nothing. Lifecycle noise stays out of the default view without becoming unreachable.

Search never re-reads or re-filters storage; it matches within the loaded snapshot.

## Evidence semantics

The browser is a presentation over the same snapshot the plain commands read. It:

- reads through `readExistingEvents`, preserving append order as canonical;
- makes no causal, completion, or success claim beyond what the reused formatters already state;
- never writes to session JSONL, metadata, or the ownership lock;
- shows redaction, truncation, missing fields, and capture gaps exactly as `formatEventInspection` reports them, with no aggregation that could imply completeness.

The header states `snapshot HH:MM:SS` for every session, active or complete. An active session keeps recording while the browser is open; the browser does not pretend otherwise and does not silently show stale data as current. `r` re-reads the events file and reports the new counts. Live-following inside the browser is deferred, not faked.

On quit, after the terminal is restored, the browser writes one ordinary line to the normal buffer: the durable inspect command for the event that was selected.

```text
bashguard inspect --session-id=019fca00-b7f6-79c4-868f-524c2fb6a4a5 --event 44
```

This uses the exact-only `--session-id` selector, so the command a user copies out of a browsing session keeps selecting the same identity in a later snapshot, consistent with the non-interactive remediation commands the picker already emits.

## Architecture

The module split mirrors the footer's proven formatter / controller / integration separation.

### Browser model (`src/browse-model.ts`)

Pure state and transitions. It holds the loaded events, selection index, focus, filter, search term and match set, and detail scroll offset. Key presses map to transitions; transitions return a new state. No I/O, no terminal knowledge, no timers. This is where selection clamping, filter recomputation, match cycling, and paging arithmetic live, and it is unit-testable without a terminal.

### Frame formatter (`src/browse-view.ts`)

Pure functions taking a model plus terminal width and height and returning the exact array of display lines for one frame. It owns the pane-width budget, the split/single-pane threshold, row compression priority, detail-pane scrolling windows, the status bar, and the help overlay. No side effects, so frames are snapshot-testable at any dimension.

### Terminal adapter (`src/browse-terminal.ts`)

The only module touching the terminal. It enters and exits the alternate screen, sets and clears raw mode, hides and shows the cursor, decodes keypresses into named keys, writes frames, listens for resize, and guarantees restoration on every exit path. It knows nothing about BashGuard events — it receives frames and emits keys, exactly as `LiveFooterController` receives lines and knows nothing about evidence.

It reuses the sequenced-write discipline from `LiveFooterController`: writes are serialized through a promise tail, acceptance is tracked, and stream listeners are scoped and removed on every path.

### CLI integration (`src/cli.ts`)

Argument validation, capability policy (`shouldUseEventBrowser`, shaped like the existing `shouldUseLiveFooter`), session selection, snapshot loading, the key-to-transition-to-frame loop, and the final restored-terminal line.

### Rendering strategy

Each frame is written whole into the alternate screen: cursor home, erase down, write the frame's lines. There is no line diffing. The alternate screen means full redraws cost no scrollback and need no rendered-line bookkeeping, which removes the single most delicate part of the footer implementation. Redraws are coalesced so a held arrow key cannot produce more frames than the terminal can absorb.

No new runtime dependency is required; `string-width` is already present and everything else is Node built-ins.

## Mode selection

The browser opens only when:

- `--browse` was supplied;
- stdin and stdout are both TTYs;
- `TERM` is present and not `dumb`;
- the terminal reports at least 8 rows.

If `--browse` is supplied and any condition fails, BashGuard exits non-zero with a concise reason and the equivalent plain commands. It never silently prints something different from what was asked for, and it never emits alternate-screen or raw-mode sequences into a pipe, a redirect, or a `dumb` terminal.

Width below the split threshold is not a failure; it selects the single-pane layout.

## Lifecycle and cleanup

The browser takes two pieces of terminal state the footer deliberately never took: the alternate screen and raw mode. Both must be released on every exit path — `q`, `Ctrl+C`, `SIGTERM`, `SIGHUP`, thrown errors, and stream failures — before any error text is written.

Restoration order is fixed: leave raw mode, show the cursor, leave the alternate screen, then write anything the user should see. Writing an error while still in the alternate buffer would erase it at exit.

**Deliberate divergence from the footer's accepted-write doctrine.** The footer stops issuing cursor-up cleanup after an accepted write fails, because it can no longer know what reached the terminal or where the cursor sits. That reasoning does not transfer here. Alternate screen and raw mode are *modes*, not positions: the restore sequences are idempotent, and re-sending them when the terminal is already restored is harmless, while failing to send them leaves the user in a raw-mode alternate buffer with no echo. So on any write failure — accepted or not — the browser makes one best-effort restore attempt, then stops writing. Accepted `EPIPE` still stops further output quietly, after that single restore attempt.

Resize triggers one recompute and one full redraw; because layout is a pure function of width and height, crossing the split threshold in either direction needs no special case. Signal handlers and stream listeners are scoped to the browser and removed when it exits.

## Test strategy

Write tests first, matching the layering:

**Model unit tests** — selection movement and clamping at both ends, paging, `g`/`G`, filter cycling including the `all recorded` state, filter changes that invalidate the current selection, search match sets, `n`/`N` wraparound, clearing filters, detail scroll bounds, focus transitions, and reload preserving selection when the selected event still exists.

**Frame formatter tests** — split and single-pane layouts at representative widths including exactly 80 and 79, pane-width budget arithmetic, row compression priority, wide-character and emoji truncation, detail-pane scroll windows, status-bar counts under every filter state, help overlay, and short-frame behavior.

**Terminal adapter tests** — key decoding for arrows, page keys, `Enter`, `Esc`, `Tab`, `Ctrl+C`, and plain letters; frame write sequencing; alternate-screen enter and exit sequences; raw-mode set and clear; resize handling; and restoration on error, on accepted-write failure, and on `EPIPE`.

**CLI policy tests** — `--browse` rejected with each conflicting filter option; non-TTY stdin, non-TTY stdout, missing `TERM`, `TERM=dumb`, and short terminals each exiting non-zero with guidance and emitting no ANSI; and the final `--session-id` line after a normal quit.

**Regression tests** — `bashguard inspect` without `--browse`, with `--event`, and with every filter/format combination produces byte-identical output to current `main`, piped and redirected included.

**Real PTY integration** — `runPortablePty` already supports scheduled keystroke sends, so the browser can be driven end-to-end: open, arrow through events, `Enter` into detail, search, filter, resize mid-session, and quit, asserting that the transcript ends with the terminal restored and no residual raw mode. Narrow-width and single-pane paths get the same treatment. As with the footer, PTY coverage runs on macOS locally; the Linux adapter is exercised in code but portability beyond the tested environment is not claimed.

## Documentation scope

Update README, `CHANGELOG.md`, `docs/current-state.md`, `docs/product/roadmap.md`, `docs/vision/terminal-ux.md` (Inspect Mode layout and the key-binding deviations), `docs/cli/evidence-filtering.md`, `docs/testing/milestone-0-smoke-checklist.md`, `docs/release/checklist.md`, and the bundled skill under `skills/bashguard`. Track the work under Phase 1 issue #61 with a focused implementation issue, following the pattern used for #77.

Documentation must keep saying that the browser reads a snapshot, that `attach` remains the live surface, and that split-pane browsing does not add any evidence claim the plain commands do not already make.

## Deferred decisions

1. **Interactive default.** Whether `--browse` becomes the default for interactive `bashguard inspect` with a `--no-browse` opt-out. Revisit after the browser has been used on real sessions; the flag ships opt-in either way.
2. **Live follow inside the browser.** A follow mode that tails an active session into the list, reusing the attach poll. Deferred so the first slice does not have to solve selection stability under insertion.
3. **Split-pane debrief.** Whether `bashguard debrief` gains a browsable review-items pane, or stays a printed report.
4. **Threshold tuning.** The 80-column split threshold, the 45% detail budget, and the 8-row minimum are starting points chosen the same way the footer's 72/40 thresholds were, and are expected to move after real use.
