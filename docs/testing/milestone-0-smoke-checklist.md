# Milestone 0 smoke checklist

Use this checklist to validate the current local BashGuard flow against a real Pi session.

## 1. Load BashGuard

One-off GitHub load:

```bash
cd your-project
pi -e git:github.com/acheltenham/BashGuard
```

Local development load from a BashGuard checkout:

```bash
cd bashguard
pi -e .
```

## 2. Install BashGuard globally or for one project

Global Pi package install, for all future Pi sessions:

```bash
pi install git:github.com/acheltenham/BashGuard
```

Project-local Pi package install, written to `.pi/settings.json` for the current project:

```bash
cd your-project
pi install -l git:github.com/acheltenham/BashGuard
```

`pi install` and `pi install -l` load the extension and skill. They do not install a global `bashguard` shell command.

## 3. Update an installed BashGuard package

If BashGuard is already installed as a Pi package, update installed Pi packages with:

```bash
pi update --extensions
```

This only updates packages shown by `pi list`. If BashGuard is not listed, install it first:

```bash
pi list
pi install git:github.com/acheltenham/BashGuard
```

Update only BashGuard with the exact source shown by `pi list`. For a GitHub install this is usually:

```bash
pi update git:github.com/acheltenham/BashGuard
```

If that reports `No matching package found`, BashGuard was not installed under that source. It may have been loaded temporarily with `pi -e ...`, installed from a local path, or not installed yet.

If the install is pinned to a tag, branch, or commit, move to a new ref explicitly:

```bash
pi install git:github.com/acheltenham/BashGuard@v0.1.1
```

Then start a new Pi session. Already-running Pi sessions keep the extension code they started with.

## 4. Run a small controlled Pi session

In Pi, ask for a small task in a test repository, for example:

```text
Read README.md, make a tiny wording edit, and run git status.
```

Optional controlled risk-notice check:

```text
Run: echo "risk smoke" && git status
```

Avoid destructive commands in a real project. Risk notices are currently observation-only and non-blocking.

## 5. Inspect from another terminal

If the `bashguard` CLI is available:

```bash
bashguard sessions
bashguard session list
bashguard sessions list
bashguard attach 1
bashguard inspect 1
bashguard inspect 1 --event 1
bashguard debrief 1
```

If `bashguard` is not on your `PATH`, run from the installed package checkout:

```bash
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard sessions
```

Or link it globally:

```bash
cd ~/.pi/agent/git/github.com/acheltenham/BashGuard
npm link
bashguard sessions
```

During local development, run the CLI from the BashGuard checkout:

```bash
cd bashguard
npm exec -- node --experimental-strip-types src/cli.ts sessions
npm exec -- node --experimental-strip-types src/cli.ts session list
npm exec -- node --experimental-strip-types src/cli.ts sessions list
npm exec -- node --experimental-strip-types src/cli.ts attach 1
npm exec -- node --experimental-strip-types src/cli.ts inspect 1
npm exec -- node --experimental-strip-types src/cli.ts inspect 1 --event 1
npm exec -- node --experimental-strip-types src/cli.ts debrief 1
```

The `inspect` command also accepts an explicit list intent:

```bash
bashguard inspect 1 list events
```

## 6. Expected output checks

### `bashguard sessions`

Confirm:

- the session appears;
- the `#` selector is present;
- the `SESSION` value is copyable and not middle-truncated;
- the `NAME` column shows a session name when Pi exposes one, or `-` otherwise;
- the `REPOSITORY` and updated age are understandable.

### `bashguard attach 1`

Confirm:

- the timeline renders meaningful events;
- sequence numbers and event ID prefixes are visible;
- shell commands are shown with cwd/session context in the header;
- non-blocking risk notices are labelled `Non-blocking risk notice` when applicable.

### `bashguard inspect 1`

Confirm:

- inspectable events are listed;
- the footer says `Inspect by sequence or event ID prefix`;
- both a sequence example and event ID prefix example are shown.

### `bashguard inspect 1 --event <selector>`

Confirm event details include available evidence such as:

- sequence;
- event ID;
- type;
- timestamp;
- evidence kind;
- session ID;
- cwd;
- tool, command, file path, Git snapshot, payload, and capture metadata when available.

### `bashguard debrief 1`

Confirm debrief includes applicable sections:

- `Evidence completeness`;
- Git status, branch, worktree, and changed paths;
- `Git changed files`;
- `Observed matching file tool event`;
- `Correlation confidence` labels;
- temporal-only risk/Git notes without causal wording;
- `Next inspect commands`;
- `File tool activity`;
- capture-gap, redaction, truncation, or missing-field notes when applicable.

## 7. Caveats to verify

- BashGuard cannot attach to older Pi sessions that were not recorded while the BashGuard extension was loaded.
- `pi -e ...` and `pi install ...` load the Pi extension and bundled skill, but do not necessarily install a global `bashguard` shell command.
- `BASHGUARD_DATA_DIR` can isolate smoke-test data:

```bash
BASHGUARD_DATA_DIR=/tmp/bashguard-smoke bashguard sessions
```

- Debriefs should report observed evidence and confidence labels; they should not claim that a specific event caused a Git diff unless the recorded evidence supports that claim.
