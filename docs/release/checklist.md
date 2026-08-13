# Release checklist

Use this checklist before tagging a BashGuard release.

## 1. Confirm release metadata

- `package.json` version matches the intended release.
- `package-lock.json` root version matches `package.json`.
- `CHANGELOG.md` has a dated section for the release.
- README examples mention the release tag only after the tag exists.

Current target:

```text
v0.2.0
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
./bin/bashguard attach 1
./bin/bashguard attach 1 --history 0
./bin/bashguard attach 1 --all-history
./bin/bashguard inspect 1
./bin/bashguard debrief 1
```

Confirm:

- `doctor` reports CLI path, package root, data dir, Pi package status, and next steps;
- `sessions` output includes `#`, `SESSION`, `NAME`, `REPOSITORY`, and `UPDATED`;
- `attach 1` shows an evidence-grounded state/activity/capture/freshness snapshot;
- default `attach 1` bounds narrated startup history, `--history 0` skips it, and `--all-history` restores it;
- `inspect 1` lists events with sequence and event ID prefix examples;
- `debrief 1` renders evidence completeness and next inspect commands when applicable.

## 4. Run Pi package smoke checks

One-off load:

```bash
cd your-project
pi -e git:github.com/acheltenham/BashGuard@main
```

Global/user install:

```bash
pi install git:github.com/acheltenham/BashGuard@main
pi list
```

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

Confirm debrief language remains evidence-based:

- no causality claims for Git/file correlations;
- risk notices are non-blocking;
- capture gaps, redaction, truncation, and missing fields are visible.

## 6. Tag the release

After release-readiness changes are merged to `main` and verification passes:

```bash
git checkout main
git pull --ff-only
git tag v0.2.0
git push origin v0.2.0
```

## 7. Verify tagged install

After pushing the tag:

```bash
pi -e git:github.com/acheltenham/BashGuard@v0.2.0
pi install git:github.com/acheltenham/BashGuard@v0.2.0
```

Then run:

```bash
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard doctor
```
