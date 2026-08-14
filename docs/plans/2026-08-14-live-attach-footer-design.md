# Live-Updating Attach Footer Design

**Status:** Implemented
**Date:** August 14, 2026  
**Phase:** Phase 1 — Live Terminal Companion

## Goal

Make active `bashguard attach` understandable at a glance by maintaining a compact, evidence-grounded status footer beneath the live timeline, while preserving the existing plain-text behavior for completed sessions, pipes, redirects, accessibility, and uncertain terminal capabilities.

## Presentation

For a sufficiently wide interactive terminal:

```text
17  ab12cd34  09:42:10  Running · npm test
18  ef56ab78  09:42:14  Editing · src/auth.ts

────────────────────────────────────────
ACTIVE · npm test
awaiting completion evidence
42 ev · capture ok · 2s ago
```

The footer remains below timeline output. Before a new timeline event is printed, BashGuard clears only the footer lines, writes the event, and redraws the footer.

The footer uses compact vocabulary rather than verbose columns:

- `ACTIVE` / `DONE`;
- `recorded`;
- `awaiting completion evidence`;
- `capture ok` / `capture partial`;
- `1 gap`, `2 truncated`, `3 missing`;
- `42 ev`;
- `2s ago`.

Content priority under width pressure is:

1. state;
2. activity;
3. evidence limitation;
4. capture warning;
5. freshness;
6. event count.

Optional counts are removed before important evidence wording. Activity may be ellipsized for presentation only; stored evidence is unchanged.

## Adaptive width

- 72 columns or wider: full three-line footer.
- 40–71 columns: compact labels with bounded wrapping, up to four lines.
- Below 40 columns: one concise line, retaining state and as much higher-priority activity/status evidence as fits.

Formatting uses a width budget rather than fixed wordy columns. The original design assumed approximate character-width truncation; the implementation instead uses the `string-width` runtime dependency for terminal display-cell measurement and `Intl.Segmenter` grapheme boundaries so CJK and emoji do not split or overflow. It avoids horizontal scrolling and recalculates after terminal resize. Users can still pivot the thresholds, vocabulary, and priority after real-session use.

## Refresh behavior

- Redraw immediately after an accepted event changes activity, evidence, capture state, event count, or lifecycle state.
- Refresh freshness once per second when no other status field changes.
- Do not redraw on every 250 ms polling cycle.
- On shutdown, stop refreshing, clear the temporary footer, and leave one final ordinary completed status block.

The existing attach poll drives refresh decisions; no separate background timer is required.

## Evidence semantics

The footer reuses existing attach-status grounding:

- current activity requires a recorded tool request with a correlatable `toolCallId` and no later matching completion in the current lifecycle segment;
- otherwise it shows latest narrated recorded activity;
- recency alone never proves current execution;
- append order remains canonical;
- restart and shutdown boundaries remain respected;
- capture status derives from recorded gaps and missing, redacted, or truncated metadata;
- incomplete or malformed JSONL does not update status until a complete valid event is accepted;
- final state uses recorded shutdown/process evidence rather than inferred task success.

Compact wording such as `awaiting completion evidence` describes missing completion evidence without asserting that a command is still executing.

## Architecture

### Footer formatter

Pure functions receive an `AttachStatus`, terminal width, and presentation options and return bounded display lines. They contain no terminal side effects. Unit tests cover wide, medium, narrow, and extremely narrow widths, content priority, sanitization, and ellipsis behavior.

### Terminal footer controller

A terminal-only adapter tracks rendered line count and last render time. It:

- clears only its own lines with ANSI cursor-up/erase sequences;
- writes/redraws around timeline events;
- suppresses unchanged redraws except one-second freshness refresh;
- responds to terminal resize;
- clears its tracked region on normal completion, `Ctrl+C`, and ordinary errors;
- on a stream-accepted `EPIPE`, disables further output and relinquishes tracked terminal state so cleanup cannot write recursively;
- removes its scoped stream listeners on every exit path, while attach integration removes its scoped process handlers;
- never uses the alternate screen, hides the cursor, or requires mouse input.

The controller does not interpret BashGuard events or evidence.

### Attach integration

The active attach loop maintains one in-memory append-order event snapshot. Each accepted complete event updates the snapshot and rebuilds the existing grounded `AttachStatus` projection. Presentation changes never modify JSONL or inspect/debrief evidence.

Timeline writes in sticky mode flow through the controller so new events cannot overwrite the footer.

## Mode selection

Sticky mode activates only when:

- the selected session is active;
- stdout is a TTY;
- `TERM` is present and not `dumb`;
- `--no-live-footer` is not supplied.

In sticky mode, the footer replaces the startup static status block to avoid duplicate status. Header and bounded history remain ordinary terminal output, followed by the footer.

Completed-session attach, redirected output, piped output, `TERM=dumb`, and explicit `--no-live-footer` retain the existing ordinary status block and timeline behavior.

If terminal capabilities become uncertain while output remains writable, BashGuard visibly degrades to plain text rather than emitting speculative ANSI sequences. An accepted `EPIPE` is the exception: output itself is disabled, so degradation must be silent.

## Lifecycle and cleanup

- No alternate screen.
- Cursor remains visible.
- Resize triggers one recalculation/redraw.
- `Ctrl+C`, shutdown, and unexpected ordinary errors clear temporary footer lines and leave a normal newline/cursor position.
- Shutdown renders one final ordinary completed status block where appropriate.
- Cleanup handlers are scoped to attach and removed afterward.

**Approved cleanup target:** The original design included `EPIPE` with the paths that clear temporary lines and restore a normal cursor position.

**Actual accepted-`EPIPE` degradation:** Once a write has been accepted and then fails, BashGuard cannot know what reached the stream or terminal. It disables footer/output, drops tracked rendered-line ownership, aborts attach, and removes scoped stream/process handlers and listeners without another cleanup write or stack trace. It therefore does **not** guarantee that already-visible temporary footer lines are cleared.

## CLI

Add:

```text
bashguard attach [session] --no-live-footer
```

The flag affects presentation only. It cannot change recorded evidence, startup history selection, live-follow completeness, or inspect/JSONL behavior.

## Testing

Write tests first for:

- formatter output at representative widths;
- content-priority dropping and bounded lines;
- ANSI clear/redraw sequences and rendered-line tracking;
- unchanged redraw suppression and one-second freshness cadence;
- event-triggered redraw;
- timeline write clear/redraw ordering;
- resize behavior;
- active TTY enablement;
- disabled behavior for non-TTY, completed sessions, `TERM=dumb`, and `--no-live-footer`;
- partial JSONL boundaries and malformed lines;
- shutdown finalization and cleanup;
- `Ctrl+C` and unexpected-error cleanup, plus accepted-`EPIPE` output disablement and listener removal without recursive writes;
- regression that redirected attach emits no known footer CSI cursor-up/erase sequences or sticky separator/redraw behavior (without making a universal claim about arbitrary recorded payload bytes);
- real PTY active attach with resize, live events, and shutdown;
- narrow-terminal PTY smoke testing.

Automated real-PTY validation exercised wide, medium, narrow, resize, live event, shutdown, `Ctrl+C`, opt-out, and redirect paths on macOS. The Linux PTY adapter is covered in code but was not exercised locally; portability beyond the exercised environment is not claimed.

## Documentation scope

Update README, changelog, current-state documentation, roadmap, terminal UX, live attach guide, smoke/release checklists, and bundled skill. Continue to describe the full split-pane TUI as future work.
