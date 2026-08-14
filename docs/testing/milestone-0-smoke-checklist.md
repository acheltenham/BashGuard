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
pi install git:github.com/acheltenham/BashGuard@v0.4.0
```

Then start a new Pi session. Already-running Pi sessions keep the extension code they started with.

Before starting, check that BashGuard is not also being loaded from another source such as both an installed GitHub package and `pi -e /path/to/local/BashGuard`. If two instances are loaded, the first owns recording and the other warns that recording is disabled. Remove the redundant source and start a new Pi session.

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
bashguard doctor
bashguard attach
bashguard attach 1
bashguard attach 1 --history 0
bashguard attach 1 --all-history
bashguard inspect
bashguard inspect 1
bashguard inspect 1 --event 1
bashguard inspect 1 --activity shell
bashguard inspect 1 --activity shell --grep test
bashguard inspect 1 --all --format jsonl
bashguard debrief
bashguard debrief 1
```

If `bashguard` is not on your `PATH`, run from the installed package checkout:

```bash
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard doctor
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard sessions
```

Or set up the CLI explicitly.

Global shell command:

```bash
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard setup cli --global
bashguard sessions
```

Project-local shim in the current project:

```bash
cd your-project
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard setup cli --local
./.bashguard/bin/bashguard sessions
```

During local development, run the CLI from the BashGuard checkout:

```bash
cd bashguard
npm exec -- node --experimental-strip-types src/cli.ts sessions
npm exec -- node --experimental-strip-types src/cli.ts session list
npm exec -- node --experimental-strip-types src/cli.ts sessions list
npm exec -- node --experimental-strip-types src/cli.ts attach
npm exec -- node --experimental-strip-types src/cli.ts attach 1
npm exec -- node --experimental-strip-types src/cli.ts inspect
npm exec -- node --experimental-strip-types src/cli.ts inspect 1
npm exec -- node --experimental-strip-types src/cli.ts inspect 1 --event 1
npm exec -- node --experimental-strip-types src/cli.ts debrief
npm exec -- node --experimental-strip-types src/cli.ts debrief 1
```

The `inspect` command also accepts an explicit list intent:

```bash
bashguard inspect 1 list events
```

## 6. Expected output checks

### Selector-less session selection

Use one isolated `BASHGUARD_DATA_DIR` and run two Pi sessions simultaneously so at least two sessions are active. If practical, retain a completed session whose ID shares leading characters with an active session.

From an actual terminal, run `bashguard attach` without a selector and confirm:

- the picker contains active sessions only, while `bashguard inspect` and `bashguard debrief` contain all discovered recorded sessions, active and completed;
- a sole eligible candidate is automatic, but multiple candidates require an exact displayed number and Enter has no default;
- invalid numbers retry, while EOF and `Ctrl+C` cancel with concise output and no stack trace;
- choosing a non-first displayed number attaches to that session;
- picker numbers match their global positions within the displayed `bashguard sessions` snapshot and are not locally renumbered; eligible active selectors are currently contiguous because discovery orders active sessions first;
- numbers are stable only within that snapshot and may change after metadata or ordering changes; exact IDs take precedence over numeric row numbers, which otherwise resolve against the current discovery order;
- prefixes remain unique against the full current discovery snapshot, including hidden completed sessions, but are not durable against future collisions; generated `--session-id=<full-session-id>` commands carry durable exact identity;
- this is a structured-text prompt rather than a full-screen TUI.

Exercise non-TTY behavior with multiple eligible sessions:

```bash
bashguard attach </dev/null >attach.out 2>&1; test $? -ne 0
bashguard inspect </dev/null >inspect.out 2>&1; test $? -ne 0
bashguard debrief </dev/null >debrief.out 2>&1; test $? -ne 0
```

Confirm none prints `Select a session`; each nonzero error lists only eligible snapshot-local rows and copyable, shell-quoted `--session-id=<full-session-id>` commands. Capture one command, reorder sessions and add a future prefix collision, then confirm it still selects the original identity. Remove that identity while leaving the collision and confirm the same command fails not-found. Exercise numeric full IDs plus IDs containing `list`, `events`, leading `--`, whitespace/newline, and quotes. Run positional/`--session` exact, canonical numeric, and unique-prefix forms against the current snapshot; verify `+1`, `01`, and exponent notation are not row indexes. Automation that allocates a PTY is interactive by contract, so use exact `--session-id` for durable automation. Also confirm unknown activity, missing option values (including `--session-id`), and mixed exact/snapshot selectors fail before prompting. Put bidi format controls in row/header fields and confirm no raw controls or forged lines appear while Unicode letters and emoji remain.

### `bashguard doctor`

Confirm:

- it reports the CLI command and package root;
- it reports the BashGuard data directory;
- it reports session count and latest session when present;
- it reports whether BashGuard appears in `pi list`;
- it suggests install/update/setup next steps without mutating anything;
- if `pi list` contains multiple configured BashGuard sources, it warns without claiming both are active in the current Pi process.

### `bashguard sessions`

Confirm:

- the session appears;
- the `#` selector is present;
- the `SESSION` value is copyable and not middle-truncated;
- the `NAME` column shows a session name when Pi exposes one, or `-` otherwise;
- the `REPOSITORY` and updated age are understandable.

### `bashguard attach 1`

In a real PTY attached to an active recorded session, confirm:

- at 80 columns, header, bounded history, and guidance appear before a separator plus exactly three footer content lines; an unmatched correlated request says `awaiting completion evidence`, capture is compact, and an accepted request/completion changes the footer immediately while idle freshness changes at about one second;
- append a narrated event and confirm BashGuard clears the temporary footer, prints the event above it, and redraws the footer without using alternate-screen or cursor-hide sequences;
- resize to 50 columns and confirm the footer redraws within 40–71 display cells with no more than four content lines; resize to 39 columns and confirm exactly one bounded, grapheme-safe content line;
- record shutdown and confirm the temporary footer disappears and exactly one ordinary completed status block remains;
- press `Ctrl+C` during a separate active attach and confirm clean detach with no dangling fragment, hidden cursor, alternate screen, or stack trace;
- run active attach with `--no-live-footer`, with `TERM=dumb`, and with `TERM` unset; confirm ordinary static status and no footer-generated CSI cursor-up (`ESC[1A`), erase-line (`ESC[2K`), or sticky separator/redraw behavior;
- redirect active attach stdout to a file and repeat through a pipe/non-TTY; confirm ordinary plain presentation and search for the same known footer cursor sequences and separator/redraw behavior, rather than rejecting every escape byte an arbitrary recorded timeline payload might contain;
- the ordinary status snapshot in completed/plain modes shows active/complete state, current or last activity, evidence wording, capture summary, event count, and freshness;
- `Current activity` appears only for a correlated tool request without a later matching completion and explicitly says completion is not recorded yet;
- completed sessions use `Last activity` and do not claim current execution;
- default startup output shows at most the latest 50 narrated historical events and reports the total;
- `--history N` changes only the startup window;
- `--history 0` skips historical narration and still follows new events;
- `--all-history` shows every narrated historical event;
- every newly appended narrated event appears regardless of startup limit;
- the timeline renders meaningful events;
- sequence numbers and event ID prefixes are visible;
- shell commands are shown with cwd/session context in the header;
- complete raw events remain available through inspect/JSONL;
- non-blocking risk notices are labelled `Non-blocking risk notice` when applicable.

### `bashguard inspect 1`

Confirm:

- inspectable events are listed;
- the footer says `Inspect by sequence or event ID prefix`;
- both a sequence example and event ID prefix example are shown.

### `bashguard inspect 1 --activity <kind>`

Confirm:

- `--activity list` shows all documented categories;
- the default displays the latest 50 matches and reports the total;
- `--grep` searches recorded event evidence case-insensitively;
- `--limit` changes the latest-match count and `--all` returns all matches;
- `--format jsonl` emits one parseable normalized event per line without headings or footers;
- `--type` filters exact recorded event types;
- unknown activities and incompatible options produce actionable errors.

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
- `pi -e ...` and `pi install ...` load the Pi extension and bundled skill, but do not install a global `bashguard` shell command. Use `bashguard setup cli --global` or `bashguard setup cli --local` through the package checkout wrapper to install an explicit shell shortcut.
- `BASHGUARD_DATA_DIR` can isolate smoke-test data:

```bash
BASHGUARD_DATA_DIR=/tmp/bashguard-smoke bashguard sessions
```

- Debriefs should report observed evidence and confidence labels; they should not claim that a specific event caused a Git diff unless the recorded evidence supports that claim.
- Loading BashGuard twice should produce one duplicate-instance warning and one set of recorded events, not inflated prompt/tool/file counts.
