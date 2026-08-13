# Changelog

All notable project changes will be recorded here.

## Unreleased

### Added

- `bashguard attach` now defaults to the latest 50 narrated historical events, supports `--history N`, `--history 0`, and `--all-history`, and continues to display every new narrated event.

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
