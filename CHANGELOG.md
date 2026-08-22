# Changelog

All notable project changes will be recorded here.

## Unreleased

### Changed

- Recorded a product direction for containment: BashGuard owns the authorization and observability controls and delegates containment and network policy to external sandbox backends, integrating through a narrow two-method `SandboxAdapter` (`describe()` and `observe()`) that never executes or orchestrates. This replaces the earlier `EnforcementAdapter` sketch, whose `execute()` and `escalate()` methods would have put BashGuard on the execution path. See [Decision 005](docs/adr/decision-log.md), the [design doc](docs/plans/2026-08-22-sandbox-adapter-and-boundary-reporting-design.md), and issue #79. Documentation only; no behavior change.
- Corrected the Pi capability matrix from the 0.84.0 SDK: `tool_call` is documented to block via `return { block: true, reason }` with mutable `event.input`, `ctx.ui.select`/`confirm` and `ctx.hasUI` support in-session approval, Pi ships no built-in sandbox by design, and its first-party sandbox example mediates only `bash` and user `!` commands rather than the `read`, `write`, and `edit` tools. Added Spike 6 for containment backend integration.
- Documented that BashGuard does not yet report the containment boundary in force, and that running inside a boundary means it can only ever report "none detected" rather than prove none exists.

### Added

- Active `bashguard attach` in a supported TTY now replaces the startup status snapshot with an adaptive sticky footer after the ordinary header, bounded history, and guidance. Recorded changes redraw immediately, freshness refreshes about once a second, and `--no-live-footer` opts out.
- Footer layout uses measured terminal display cells and grapheme-aware truncation: 72+ columns shows three content lines, 40–71 shows up to four, and narrower terminals show one compact line. The implementation adds `string-width` as a runtime dependency.

### Fixed

- Live timeline writes and terminal resize now clear and redraw only the temporary footer. Typed footer failures preserve their cause/code plus operation phase and timeline-acceptance metadata, so plain degradation replays an event only when its payload was not accepted. Recorded shutdown leaves one ordinary completed status block; `Ctrl+C` and unaccepted ordinary errors clear the temporary footer and scoped handlers. Any accepted write failure makes cursor ownership unknowable, so BashGuard disables the footer and does not issue cursor-up cleanup; it emits only a safe newline/plain fallback when output remains writable. Accepted `EPIPE` additionally stops output quietly without another write or stack trace.
- Completed sessions, non-TTY output, missing or `dumb` `TERM`, redirects, and `--no-live-footer` preserve plain output and emit no footer-generated ANSI or cursor-control sequences. Arbitrary recorded timeline payloads are not claimed to be universally ANSI-free.

## 0.4.0 - 2026-08-13

### Added

- Selector-less `attach`, `inspect`, and `debrief` now auto-select a sole eligible session or show a structured-text numbered picker when multiple candidates and interactive stdin/stdout TTYs are available. Active sessions take priority for selector-less attach; inspect and debrief consider all discovered recorded sessions.
- Non-interactive ambiguous selection now exits nonzero without prompting and prints exact, copyable `--session-id` commands. Explicit numeric selectors, exact session IDs, and unique ID prefixes continue to bypass interaction.

### Fixed

- Generated non-interactive guidance now uses exact-only `--session-id` selectors that preserve identity across ordering changes; numeric and prefix selectors remain current-snapshot conveniences. Session discovery also validates malformed metadata, and session presentation sanitizes terminal control and bidirectional formatting characters.

## 0.3.0 - 2026-08-13

### Added

- `bashguard attach` now starts with an evidence-grounded session/activity/capture/freshness snapshot.
- `bashguard attach` now defaults to the latest 50 narrated historical events, supports `--history N`, `--history 0`, and `--all-history`, and continues to display every new narrated event.

### Fixed

- Git package dependency reconciliation no longer requires Pi `0.84.1`; BashGuard develops and type-checks against the compatible `0.84.0` baseline while retaining a `*` runtime peer dependency.

## 0.2.0 - 2026-08-13

### Added

- Added a reproducible Milestone 0 baseline runner and documented latency, storage overhead, failure behavior, active attach, full CLI, and inside-Pi skill validation. Milestone 0 is now complete; split-pane TUI work moves to Phase 1.
- Added regression coverage confirming an entirely unwritable event stream notifies Pi without rejecting the tool event.
- `bashguard inspect` now supports provider-neutral evidence filtering by activity category, exact event type, and case-insensitive search, with latest-N/all controls and clean JSONL export.
- Added the MIT `LICENSE`, public security boundaries in `SECURITY.md`, and README links for public-repository readiness.
- README now documents using the bundled BashGuard skill from inside Pi as well as using the CLI from a second terminal.
- `bashguard debrief` now includes an evidence-based `GitHub activity` section for observed `git push`, `gh pr create`, `gh pr merge`, and `gh run watch/view` commands recorded in the session.
- `bashguard debrief` now includes provider-neutral `Observed shell activity` entries for recorded BashGuard command/output pairs, without assuming a deployment provider or technology stack.

### Fixed

- Multiple BashGuard extension instances now coordinate through a per-session ownership lock so only one records events; duplicate instances warn and remain inactive. `bashguard doctor` also warns about multiple configured sources reported by `pi list` without treating configuration as proof of runtime duplication.
- Updated the Pi development dependency to `0.84.1`, resolving the reported transitive `undici` and `brace-expansion` vulnerabilities in `package-lock.json`.
- CLI output now exits quietly when a downstream pipe closes instead of printing an `EPIPE` stack trace.
- Repeated event sequences now preserve JSONL append order; ambiguous sequence selectors explain how to use an event ID prefix.
- `attach` now explains whether it shows narrated events or raw events requiring `inspect`, and points to the next CLI commands.
- `bashguard debrief` now labels active sessions as `Session active` instead of always saying `Session complete`.

## 0.1.0 - 2026-08-04

### Added

- Pi extension package that records BashGuard sessions into local append-only JSONL.
- Bundled `bashguard` Pi skill for evidence-grounded session analysis.
- CLI commands for session discovery, live/completed timeline attachment, event inspection, and session debriefs:
  - `bashguard sessions`
  - `bashguard session list`
  - `bashguard sessions list`
  - `bashguard attach <session>`
  - `bashguard inspect <session>`
  - `bashguard inspect <session> --event <event-id-prefix-or-sequence>`
  - `bashguard debrief <session>`
- Shell-friendly `bin/bashguard` wrapper.
- Explicit CLI setup commands:
  - `bashguard setup cli --global`
  - `bashguard setup cli --local`
- Read-only troubleshooting command:
  - `bashguard doctor`
- Session selector UX with numbered session rows, copyable session prefixes, session names when available, and `--session` support.
- Inspect list UX with sequence and event-ID-prefix examples, including `bashguard inspect <session> list events`.
- Capture metadata for missing, redacted, truncated, and capture-gap evidence.
- Event inspection for file tool activity and Git status snapshots.
- Debrief summaries with evidence completeness, file tool activity, Git status before/after, changed files, line ranges, direct path-match confidence, temporal-only risk/Git notes, and next inspect commands.
- Non-blocking risk notices for a small built-in set of risky shell command patterns.
- Session start/shutdown Git status snapshots with branch, worktree, changed file details, line counts, and changed line ranges.
- Milestone 0 smoke checklist and installation/update/setup documentation.

### Notes

- BashGuard remains local-first: no cloud service, daemon, browser UI, or database.
- Risk notices are observation-only in this release; they do not block, approve, or interrupt execution.
- Git/file correlation labels are evidence-confidence labels, not causality claims.
- `pi install ...` loads the Pi extension and skill but does not automatically install a global `bashguard` shell command. Use `bin/bashguard` or `bashguard setup cli --global|--local`.
