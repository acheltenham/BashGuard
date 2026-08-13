# Interactive Session Picker Design

**Status:** Approved  
**Date:** August 13, 2026  
**Phase:** Phase 1 — Live Terminal Companion

## Goal

Make selector-less `attach`, `inspect`, and `debrief` convenient in an interactive terminal without making scripts ambiguous, blocking, or non-deterministic.

## Selection behavior

`bashguard attach` without a selector uses ambiguity-first selection:

- one active session selects automatically;
- multiple active sessions show a picker containing active sessions only;
- with no active sessions, all discovered completed sessions become the candidates;
- any sole eligible session, active or completed, selects automatically; multiple completed candidates require the same TTY picker policy.

`bashguard inspect` and `bashguard debrief` without a selector consider all discovered recorded sessions, active and completed. One eligible session selects automatically; multiple sessions require a picker.

Explicit list indexes, exact session IDs, and unique ID prefixes retain their current behavior and bypass interaction. The picker requires an explicit valid number; Enter never silently chooses a default.

## Architecture and data flow

Session discovery produces one stable, active-first ordered snapshot for a selection operation. A pure policy function derives eligible candidates by command. Existing explicit-selector resolution works against that same full snapshot. Numeric selectors are assigned before command-specific filtering, so an active-only attach picker retains the original global `bashguard sessions` numbers rather than locally renumbering its subset. Because active sessions come first in the snapshot, eligible active selectors are currently contiguous. Session ID prefixes are also derived against every session in the snapshot, including completed sessions hidden from that picker, so displayed prefixes remain globally unique and copyable.

A shared asynchronous selector then either:

1. returns the sole eligible candidate;
2. invokes an interactive terminal adapter for multiple candidates; or
3. returns an actionable error when interaction is unavailable.

The terminal adapter uses Node readline with injectable input and output streams. It renders numbered session rows from the supplied choices, validates input, and returns the selected choice and its stable selector. This remains separate from the future split-pane TUI.

`attach`, `inspect`, and `debrief` call the shared selector. `inspect` and `debrief` no longer reject an omitted selector before selection. Argument errors that do not depend on a selected session—including an unknown inspect activity or a missing value after `--session`—are validated before selection. The selected snapshot is passed directly to command execution; discovery is not repeated after rendering the picker.

## Interactive and non-interactive behavior

The picker opens only when both stdin and stdout report interactive TTY capability. This prevents scripts, pipes, redirected output, and automation from hanging.

For multiple non-interactive candidates, BashGuard exits non-zero with:

- a concise ambiguity explanation;
- the numbered eligible-session list;
- a copyable command using a numeric selector.

Only an exact displayed integer is accepted. Blank, non-numeric, whitespace-padded, and unavailable input prints concise selector guidance and prompts again; Enter has no default. EOF cancels with a concise error. `Ctrl+C` exits cleanly without a stack trace or accidental selection.

Session files may change after discovery, but picker numbering and selection remain tied to the displayed snapshot. Existing degraded-file behavior applies after selection.

## Presentation

The picker uses structured text and enough context to distinguish sessions:

```text
1  019fc93a-1  api-work  backend  active  updated 2026-08-13T12:00:00.000Z
2  019fc93a-2  ui-work  portfolio-site  active  updated 2026-08-13T11:59:46.000Z
Select a session [1, 2]:
```

The active selectors shown here are contiguous because discovery orders active sessions first, but they still retain their original global selectors rather than being locally renumbered. A completed session that is part of the full snapshot but hidden from the active-only attach picker can require a longer-than-expected globally unique prefix.

It does not rely on color, mouse input, or a full-screen terminal mode.

## Evidence and compatibility boundaries

The picker changes selection only. It does not alter stored events, evidence/capture architecture, evidence projection, capture semantics, attach history, inspect filtering, debrief narration, or explicit selectors.

Plain-text and JSONL workflows remain scriptable. BashGuard never chooses among multiple candidates merely because one is newest.

## Test strategy

Write tests first for:

- attach candidate policy with zero, one, and multiple active sessions;
- inspect/debrief policy over active and completed sessions;
- automatic selection of one eligible session;
- explicit index, exact ID, and unique prefix bypassing interaction;
- picker invocation only for multiple candidates with interactive streams;
- blank, invalid, and out-of-range input retries;
- EOF and interruption cancellation;
- deterministic non-interactive errors with copyable selectors;
- stable selection from one discovery snapshot;
- selector-less attach, inspect, and debrief integration behavior;
- regression coverage that piped/scripted commands never prompt.

Final validation includes the complete automated gate and a real simultaneous-Pi-session smoke test.

## Documentation

Update README, changelog, current-state documentation, roadmap, terminal UX, live-attach documentation, smoke/release checklists, and the bundled BashGuard skill. Track the focused feature under Phase 1 issue #61.
