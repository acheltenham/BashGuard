# BashGuard

> The terminal flight recorder for Pi coding sessions.

BashGuard is an open-source, local-first companion for Pi that helps developers understand what their coding agent is doing while it happens and investigate what happened afterward. It currently provides recovery context from recorded Git evidence; restore workflows are not implemented.

Pi remains the place where the developer talks to the agent. BashGuard becomes the place where the developer understands the execution.

> **Work in progress:** BashGuard currently provides Milestone 0 session recording and investigation. It is not yet a complete command guard, approval system, sandbox, or recovery tool. See [`docs/current-state.md`](docs/current-state.md) for the authoritative capability and limitation summary.

## The Experience

A developer runs Pi in one terminal and BashGuard in another:

```text
┌──────────────────────────────┬──────────────────────────────┐
│ Pi                           │ BashGuard                    │
│                              │                              │
│ Refactor the authentication  │ LIVE · Session bg-102       │
│ flow and run the tests.      │                              │
│                              │ 09:41 Reading src/auth.ts    │
│                              │ 09:42 Running npm test       │
│                              │ 09:43 Tests failed           │
│                              │ 09:44 Editing src/auth.ts    │
│                              │ 09:45 Inspect event 42       │
└──────────────────────────────┴──────────────────────────────┘
```

BashGuard is intended to narrate the session rather than dump raw logs. The current slice records and reports observed activity; risk notices are non-blocking and do not interrupt execution. Resolved-command previews, approval decisions, and safer alternatives remain planned.

## Current Commands

Available in the current CLI (the Milestone 0 foundation plus Phase 1 additions):

```bash
bashguard sessions
bashguard session list
bashguard sessions list
bashguard doctor
bashguard attach
bashguard attach 1
bashguard attach 1 --history 100
bashguard attach 1 --history 0
bashguard attach 1 --all-history
bashguard attach --session 1
bashguard inspect
bashguard inspect 1
bashguard inspect 1 --event <event-id-prefix-or-sequence>
bashguard inspect 1 --activity shell --grep deploy
bashguard inspect 1 --all --format jsonl
bashguard debrief
bashguard debrief 1
```

- `sessions`, `session list`, and `sessions list` list recent and active recorded sessions with a `#` selector, copyable session prefix, and a session name when Pi exposes one. Without a selector, `attach` automatically chooses its sole eligible session or, when multiple sessions are eligible and both stdin and stdout are TTYs, asks for an exact displayed number. `attach` prefers active sessions and shows only active candidates when any are active; if none are active, completed sessions are eligible. Selector-less `inspect` and `debrief` consider all recent active and completed sessions. Explicit numeric selectors, exact IDs, and unique ID prefixes bypass the picker.
- `doctor` prints a read-only troubleshooting report for CLI path, session storage, installed Pi package source, update command, and next steps.
- `attach` follows an active session or renders a completed session timeline. It begins with a grounded status snapshot covering session state, correlated current/last activity, evidence wording, capture limitations, event count, and freshness. Startup history defaults to the latest 50 narrated events; use `--history N`, `--history 0`, or `--all-history`. Every newly appended narrated event is still displayed. Raw events and complete JSONL remain available through `inspect`. Risk notices are explicitly non-blocking. See [Live attach history and status](docs/cli/live-attach.md).
- `inspect` without `--event` lists the most recent inspectable events for a session and shows the next command. `inspect <session> list events` is accepted as an explicit list intent. With `--event`, it prints evidence for one recorded event by event ID, event ID prefix, or an unambiguous sequence; repeated sequences require an event ID prefix. Activity/type/search filters default to the latest 50 matches, support `--limit` or `--all`, and can emit clean JSONL for scripts. It includes file-tool meaning for read/edit/write-tool events and Git snapshot details for Git status events. See [Evidence filtering and export](docs/cli/evidence-filtering.md).
- `debrief` summarizes an active or completed session with evidence-based review notes, including evidence completeness, Git status before/after when available, observed GitHub activity, observed shell activity, a risk-notice count, non-blocking risky-command notes, correlation confidence for direct path matches, temporal-only risk/Git correlation notes, next inspect commands, and a `File tool activity` section for observed read/edit/write-tool events.

Planned later commands include richer `open`/TUI and `replay` experiences.

For the complete current capability list, limitations, recommended wording, and bug-reporting guidance, see [`docs/current-state.md`](docs/current-state.md). For license and security boundaries, see [`LICENSE`](LICENSE) and [`SECURITY.md`](SECURITY.md).

## Why BashGuard

Pi already provides an extensible coding harness, local sessions, lifecycle hooks, tool interception, and custom terminal UI. BashGuard builds on those capabilities instead of replacing them.

The product direction is aimed at answering questions such as:

- What is Pi doing right now?
- What exact command will execute?
- Did project configuration or a wrapper change the command?
- Which prompt caused a tool call or file change?
- Why was an action allowed, warned, blocked, or sent for approval?
- Which files changed, and can I safely restore them?
- Where did the session begin to go off course?

## Product Direction

BashGuard begins as two cooperating TypeScript surfaces:

1. a Pi extension that captures and evaluates supported execution events;
2. a local terminal companion that attaches to a Pi session and presents the event stream.

The planned MVP direction includes:

- live session narration in a separate terminal
- session discovery and attachment by Pi session ID
- resolved command previews for risky execution
- explainable decisions
- prompt-to-effect timelines
- file and Git change correlation
- Git-backed checkpoints and restore guidance
- investigation, replay, and session debriefs
- honest capture-completeness indicators

The MVP direction does not require a cloud service, account, hosted dashboard, support for other coding harnesses, or an operating-system sandbox; these are product constraints, not claims that every planned MVP capability is already implemented.

## Design Principles

- Pi is where developers act; BashGuard is where they understand.
- Developers should never wonder what their AI is doing.
- Narrate meaningful activity instead of streaming implementation noise.
- Keep routine safe work quiet.
- Interrupt only when the developer needs to decide.
- Never hide the command that will execute.
- Explain every decision.
- Use progressive disclosure: glance, expand, investigate.
- Keep the core experience local.
- Use Git as the initial recovery mechanism.
- Show missing capture rather than pretending provenance is complete.

## Current Status

BashGuard has a working Milestone 0 foundation: a Pi extension records real sessions into local append-only JSONL, and a separate `bashguard` CLI can discover, attach to, inspect, and debrief those sessions without terminal scraping or a background daemon.

The current slice records Pi lifecycle, prompt, message, turn, tool, user-bash, file read/write/edit, shell command, capture-completeness, truncation/redaction, capture-gap evidence, non-blocking risk notices for a small explicit set of risky shell command patterns, file tool activity, and Git status snapshots at session start/shutdown. Risk review notes include event, cwd, command-result evidence, and plain-language risk explanations when available. Debriefs can summarize observed GitHub activity from recorded shell commands, such as `git push`, `gh pr create`, `gh pr merge`, and `gh run watch/view`, without querying GitHub live. They can also show provider-neutral observed shell activity from recorded BashGuard command/output pairs, including commands from arbitrary platforms and technology stacks. The output is evidence, not a claim that a command changed remote state. File activity is reported as observed Pi tool activity rather than inferred create/overwrite/delete impact. Git status snapshots report branch, worktree path, working-tree state, and changed-file details before/after the session, including status, line counts, changed line ranges, and any observed matching file-tool event by path. Direct path matches include a correlation confidence label. When risky shell commands occur before the shutdown Git snapshot that shows changed paths, debriefs can add a temporal-only correlation note. Debriefs also collect follow-up `bashguard inspect` commands for the most relevant recorded events. These notes do not claim causality or attribute exact Git diffs to individual events. Remaining work is focused on final manual validation, richer terminal UX, pre-execution command-resolution/risk previews, and deeper file/Git impact correlation.

## Reporting bugs

Please [open a bug report](https://github.com/acheltenham/BashGuard/issues/new?template=bug_report.md) with BashGuard/Pi versions, reproduction steps, expected and actual output, and sanitized `bashguard doctor` or `bashguard inspect` evidence. Do not attach raw session JSONL containing secrets or private content. BashGuard is work in progress, so reports about missing capture, incorrect narration, unclear limitations, and documentation inaccuracies are welcome.

## Installation and Usage

### Load BashGuard for one Pi session

To try BashGuard from GitHub without installing it permanently:

```bash
pi -e git:github.com/acheltenham/BashGuard
```

You can pin a branch, tag, or commit. Use `@main` for the latest pre-release code, or a version tag after it exists:

```bash
pi -e git:github.com/acheltenham/BashGuard@main
pi -e git:github.com/acheltenham/BashGuard@v0.3.0
```

For local development, load your checkout for one Pi run:

```bash
cd bashguard
pi -e .
```

### Install BashGuard as a default Pi extension

Install BashGuard globally in your Pi user settings so future Pi sessions in any project load BashGuard automatically:

```bash
pi install git:github.com/acheltenham/BashGuard
```

Install BashGuard only for the current project by writing to `.pi/settings.json`:

```bash
cd your-project
pi install -l git:github.com/acheltenham/BashGuard
```

For repeatable installs, prefer a tagged release after the tag exists:

```bash
pi install git:github.com/acheltenham/BashGuard@v0.3.0
pi install -l git:github.com/acheltenham/BashGuard@v0.3.0
```

To test changes newer than the latest release, use `@main` for the current development branch:

```bash
pi install git:github.com/acheltenham/BashGuard@main
```

Or install from your local BashGuard checkout:

```bash
cd bashguard
pi install .

# or project-local from the project you want to record
cd your-project
pi install -l /absolute/path/to/your/bashguard-checkout
```

These commands install the BashGuard Pi package into Pi settings. The package includes both the BashGuard session-recording extension and a complementary `bashguard` skill that helps Pi use the recorded evidence. Global installs apply to future Pi sessions in any project. Project-local installs apply when Pi is started from that trusted project.

Start Pi normally from the project you want to record:

```bash
cd your-project
pi
```

### Use BashGuard inside Pi

The package also includes a complementary `bashguard` skill. From the Pi session, you can ask Pi to use BashGuard against the recorded evidence, for example:

```text
Use BashGuard to tell me what happened in this session.
Use BashGuard to inspect the failed shell command and explain what evidence is available.
Use BashGuard to debrief session 1 and list anything worth reviewing.
```

Pi can use the same local CLI and recorded session store to answer those questions. The answers remain limited to evidence BashGuard recorded; they do not recover older unrecorded sessions or query GitHub/deployment providers live. For automation and agent-driven commands, use an explicit selector from `bashguard sessions` rather than relying on interactive selection.

### Use BashGuard from a second terminal

In another terminal, list and inspect recorded BashGuard sessions. Selector-less `attach`, `inspect`, and `debrief` auto-select a sole eligible session. With multiple eligible sessions, they open a structured-text numbered picker only when both stdin and stdout are TTYs. Enter has no default: enter an exact displayed number; invalid input retries, while EOF or `Ctrl+C` cancels concisely. With multiple eligible sessions, scripts, pipes, and redirected output never prompt; they exit nonzero with eligible stable selectors and copyable commands. With no recorded sessions, the CLI instead reports its existing no-sessions error. Picker rows retain the global numbers and globally unique prefixes from the single `bashguard sessions` discovery snapshot, even when completed sessions are hidden from an active-only attach picker.

If the `bashguard` CLI is on your `PATH`, use:

```bash
bashguard sessions
bashguard session list
bashguard sessions list
bashguard doctor
bashguard attach
bashguard attach 1
bashguard inspect
bashguard inspect 1
bashguard inspect 1 --event <event-id-prefix-or-sequence>
bashguard debrief
bashguard debrief 1
```

If `bashguard` is not on your `PATH`, run the CLI from the installed Pi package checkout:

```bash
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard sessions
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard attach 1
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard inspect 1
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard debrief 1
```

Or set up the CLI explicitly.

Check setup and next steps:

```bash
~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard doctor
```

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

The global setup runs `npm link` from the BashGuard package checkout. The local setup creates `./.bashguard/bin/bashguard` in the current project.

Start a new Pi session after installing or updating BashGuard; an already-running Pi process keeps the extension and skill version it started with. BashGuard can only record and attach to sessions where the extension was loaded before the session began and is writing to the same `BASHGUARD_DATA_DIR`.

Do not load BashGuard from multiple sources in the same Pi session, such as an installed GitHub package plus `pi -e /path/to/local/BashGuard`. BashGuard prevents duplicate recording with a per-session ownership lock and warns when another instance is already active. `bashguard doctor` also reports when `pi list` contains multiple configured BashGuard sources, but configuration evidence does not prove both are active in an already-running Pi process. Remove the redundant source and start a new Pi session.

During local development, you can also run the CLI from your BashGuard checkout without linking:

```bash
cd bashguard
npm exec -- node --experimental-strip-types src/cli.ts sessions
npm exec -- node --experimental-strip-types src/cli.ts attach 1
npm exec -- node --experimental-strip-types src/cli.ts inspect 1
npm exec -- node --experimental-strip-types src/cli.ts inspect 1 --event <event-id-prefix-or-sequence>
npm exec -- node --experimental-strip-types src/cli.ts debrief 1
```

The `--session` form is also supported:

```bash
bashguard attach --session 1
bashguard inspect --session 1 --event <event-id-prefix-or-sequence>
bashguard debrief --session 1
```

Check installed Pi packages with:

```bash
pi list
```

Update installed Pi packages:

```bash
pi update --extensions
```

This only updates packages shown by `pi list`. If BashGuard is not listed, install it first:

```bash
pi install git:github.com/acheltenham/BashGuard
```

To update only BashGuard, use the exact source shown by `pi list`. For a GitHub install this is usually:

```bash
pi update git:github.com/acheltenham/BashGuard
```

If that reports `No matching package found`, BashGuard was not installed under that source. It may have been loaded temporarily with `pi -e ...`, installed from a local path, or not installed yet.

If you installed a pinned tag, branch, or commit, Pi will reconcile that pinned ref but will not move it to a newer ref automatically. Install the new ref explicitly:

```bash
pi install git:github.com/acheltenham/BashGuard@v0.1.1
```

Remove the package using the same source you installed:

```bash
pi remove git:github.com/acheltenham/BashGuard
pi remove /absolute/path/to/your/bashguard-checkout
```

### Where sessions are stored

By default BashGuard records sessions in:

```text
~/.bashguard/sessions
```

That storage is shared across projects, so `bashguard sessions` can show recorded sessions from different repositories no matter which directory you run the CLI from.

Use `BASHGUARD_DATA_DIR` to isolate test data:

```bash
BASHGUARD_DATA_DIR=/tmp/bashguard-test bashguard sessions
```

BashGuard can only attach to sessions recorded while the BashGuard extension was loaded and writing to the same data directory. Older Pi sessions without BashGuard JSONL records cannot be attached retroactively.

### CLI availability

`pi -e ...` and `pi install ...` load the BashGuard Pi extension and bundled `bashguard` skill. They do not install the `bashguard` shell command globally. Use the package checkout wrapper at `~/.pi/agent/git/github.com/acheltenham/BashGuard/bin/bashguard`, then run `bashguard setup cli --global` or `bashguard setup cli --local` through that wrapper to install an explicit shell shortcut.

## Local Development

```bash
npm install
npm test
npm run check
npm run baseline:milestone-0 -- --samples 25
```

Manual attach test:

```bash
# Terminal 1
BASHGUARD_DATA_DIR=/tmp/bashguard-test pi -e .

# Terminal 2
BASHGUARD_DATA_DIR=/tmp/bashguard-test node --experimental-strip-types src/cli.ts sessions
BASHGUARD_DATA_DIR=/tmp/bashguard-test node --experimental-strip-types src/cli.ts attach 1
BASHGUARD_DATA_DIR=/tmp/bashguard-test node --experimental-strip-types src/cli.ts attach --session 1
BASHGUARD_DATA_DIR=/tmp/bashguard-test node --experimental-strip-types src/cli.ts inspect 1
BASHGUARD_DATA_DIR=/tmp/bashguard-test node --experimental-strip-types src/cli.ts inspect 1 --event <event-id-prefix-or-sequence>
BASHGUARD_DATA_DIR=/tmp/bashguard-test node --experimental-strip-types src/cli.ts debrief 1
```

See [Milestone 0 Smoke Checklist](docs/testing/milestone-0-smoke-checklist.md), [Milestone 0 Validation Baseline](docs/testing/milestone-0-validation-baseline.md), and [Separate-Terminal Attach Test](docs/testing/separate-terminal-attach.md).

## Documents

- [Live Attach History and Status](docs/cli/live-attach.md)
- [Evidence Filtering and Export](docs/cli/evidence-filtering.md)
- [Milestone 0 Validation Baseline](docs/testing/milestone-0-validation-baseline.md)
- [The BashGuard Experience](docs/vision/the-bashguard-experience.md)
- [Terminal UX](docs/vision/terminal-ux.md)
- [Event Model](docs/architecture/event-model.md)
- [Manifesto](docs/vision/manifesto.md)
- [Product Requirements](docs/product/requirements.md)
- [Architecture](docs/architecture/overview.md)
- [Roadmap](docs/product/roadmap.md)
- [Release Checklist](docs/release/checklist.md)
- [Competitive Analysis](docs/research/competitive-analysis.md)
- [MVP Scope](docs/vision/mvp.md)
- [Product Principles](docs/vision/principles.md)
- [Decision Log](docs/adr/decision-log.md)
- [Changelog](CHANGELOG.md)

## License and security

BashGuard is available under the [MIT License](LICENSE).

For security limitations and private vulnerability reporting guidance, see [SECURITY.md](SECURITY.md). BashGuard is currently an observation and investigation companion, not an execution guard or security boundary.

## Working Positioning

> BashGuard is the local terminal companion and flight recorder for Pi. An explainable command guard remains planned.