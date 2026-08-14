# Release checklist

Use this checklist before tagging a BashGuard release.

## 1. Confirm release metadata

- `package.json` version matches the intended release.
- `package-lock.json` root version matches `package.json`.
- `CHANGELOG.md` has a dated section for the release.
- README examples mention the release tag only after the tag exists.

Current target:

```text
v0.4.0
```

## 2. Run automated verification

From the repository root:

```bash
npm install
npm test
npm run check
npm audit
npm run baseline:milestone-0 -- --samples 25
```

Expected result:

- all tests pass;
- TypeScript check passes;
- dependency audit reports no known vulnerabilities;
- the Milestone 0 baseline prints latency and storage results without errors.

## 3. Run CLI smoke checks

From the repository root:

```bash
./bin/bashguard doctor
./bin/bashguard sessions
./bin/bashguard session list
./bin/bashguard sessions list
```

If there is at least one recorded session:

```bash
./bin/bashguard attach
./bin/bashguard attach 1
./bin/bashguard attach 1 --history 0
./bin/bashguard attach 1 --all-history
./bin/bashguard attach 1 --no-live-footer
./bin/bashguard inspect
./bin/bashguard inspect 1
./bin/bashguard debrief
./bin/bashguard debrief 1
```

Confirm:

- `doctor` reports CLI path, package root, data dir, Pi package status, and next steps;
- `sessions` output includes `#`, `SESSION`, `NAME`, `REPOSITORY`, and `UPDATED`;
- with two simultaneous active sessions in an actual TTY, selector-less attach shows an active-only structured-text picker and accepts a non-first displayed global number; selector-less inspect/debrief show all discovered recorded sessions;
- selector-less commands auto-select a sole eligible session, while explicit selectors bypass the picker; positional/`--session` values resolve exact ID, canonical positive decimal row, then unique prefix against the current snapshot;
- piped or redirected ambiguous commands never prompt, exit nonzero, and list eligible snapshot-local rows with shell-quoted exact `--session-id=<full-session-id>` commands; a copied command still selects the displayed session after reordering and future prefix collisions, but fails not-found after target removal;
- PTY-allocating automation is treated as interactive and uses an explicit selector to avoid prompting; explicit selectors are used for all automation;
- Enter has no default, invalid input retries, and EOF/`Ctrl+C` cancels concisely, with no prompt timeout;
- unknown inspect activity, missing `--session`, `--session-id`, or `--event` values, and mixed exact/snapshot selectors fail before session selection;
- rows and attach headers contain no raw C0/C1 or Unicode format controls while preserving ordinary Unicode letters and emoji;
- in an active real PTY at 80 columns, attach prints header/history/guidance before exactly three footer content lines; request/completion events update immediately, freshness updates around one second, and timeline events clear then redraw above the footer;
- resize the active PTY to 50 columns and confirm no more than four bounded content lines, then to 39 columns and confirm one display-cell-bounded, grapheme-safe line;
- recorded shutdown leaves exactly one ordinary completed status block; `Ctrl+C` leaves no footer fragment, stack trace, alternate-screen state, or hidden cursor;
- `--no-live-footer`, `TERM=dumb`, and missing `TERM` retain ordinary static status without footer cursor control; redirected and piped active attach are plain and contain no ANSI bytes;
- completed/plain `attach 1` shows an evidence-grounded state/activity/capture/freshness snapshot;
- default `attach 1` bounds narrated startup history, `--history 0` skips it, and `--all-history` restores it;
- `inspect 1` lists events with sequence and event ID prefix examples;
- `debrief 1` renders evidence completeness and next inspect commands when applicable.

## 4. Run Pi package smoke checks

One-off load:

```bash
cd your-project
pi -e git:github.com/acheltenham/BashGuard@main
```

Global/user install and reconciliation:

```bash
pi install git:github.com/acheltenham/BashGuard@main
pi list
pi update git:github.com/acheltenham/BashGuard
```

For a release tag, also verify an existing isolated install can be moved with `pi install git:github.com/acheltenham/BashGuard@<tag>` and that a clean `npm ci` does not require an unpublished Pi development dependency.

Project-local install:

```bash
cd your-project
pi install -l git:github.com/acheltenham/BashGuard@main
```

CLI setup from an installed package checkout:

```bash
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard doctor
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard setup cli --global
bashguard doctor
```

Project-local CLI setup:

```bash
cd your-project
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard setup cli --local
./.bashguard/bin/bashguard doctor
```

Confirm:

- `pi list` shows BashGuard when installed persistently;
- `bashguard doctor` reports the installed source and update command;
- newly started Pi sessions record BashGuard events;
- already-running Pi sessions are not expected to pick up updated extension code.

## 5. Validate real-session smoke flow

Follow the full Milestone 0 checklist:

```text
docs/testing/milestone-0-smoke-checklist.md
```

Confirm debrief language remains evidence-based and the capture architecture remains unchanged by session selection:

- no causality claims for Git/file correlations;
- risk notices are non-blocking;
- capture gaps, redaction, truncation, and missing fields are visible.

## 6. Tag the release

After release-readiness changes are merged to `main` and verification passes:

```bash
git checkout main
git pull --ff-only
git tag v0.4.0
git push origin v0.4.0
```

## 7. Verify tagged install

After pushing the tag:

```bash
pi -e git:github.com/acheltenham/BashGuard@v0.4.0
pi install git:github.com/acheltenham/BashGuard@v0.4.0
```

Then run:

```bash
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard doctor
```
