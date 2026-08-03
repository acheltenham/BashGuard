# BashGuard

> The terminal flight recorder for Pi coding sessions.

BashGuard is an open-source, local-first companion for Pi that helps developers understand what their coding agent is doing while it happens, investigate what happened afterward, and recover when something goes wrong.

Pi remains the place where the developer talks to the agent. BashGuard becomes the place where the developer understands the execution.

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
│                              │ 09:45 Checkpoint created     │
└──────────────────────────────┴──────────────────────────────┘
```

BashGuard should narrate the session rather than dump raw logs. Safe work stays quiet. Risky actions surface the resolved command, relevant context, reason for interruption, and safer alternatives.

## Current Commands

Implemented in the Milestone 0 vertical slice:

```bash
bashguard sessions
bashguard attach 1
bashguard attach --session 1
bashguard inspect 1
bashguard inspect 1 --event <event-id-prefix-or-sequence>
bashguard debrief 1
```

- `sessions` lists recent and active recorded sessions with a `#` selector and copyable session prefix.
- `attach` follows an active session or renders a completed session timeline. It accepts a session number, full session ID, unique session prefix, or `--session`. Risk notices in the timeline are explicitly non-blocking.
- `inspect` without `--event` lists inspectable events for a session. With `--event`, it prints evidence for one recorded event by event ID, event ID prefix, or sequence, including file-tool meaning for read/edit/write-tool events and Git snapshot details for Git status events.
- `debrief` summarizes a completed session with evidence-based review notes, including evidence completeness, Git status before/after, a risk-notice count, non-blocking risky-command notes, correlation confidence for direct path matches, temporal-only risk/Git correlation notes, and a `File tool activity` section for observed read/edit/write-tool events.

Planned later commands include richer `open`/TUI and `replay` experiences.

## Why BashGuard

Pi already provides an extensible coding harness, local sessions, lifecycle hooks, tool interception, and custom terminal UI. BashGuard builds on those capabilities instead of replacing them.

The missing experience is a clear answer to questions such as:

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

The MVP focuses on:

- live session narration in a separate terminal
- session discovery and attachment by Pi session ID
- resolved command previews for risky execution
- explainable decisions
- prompt-to-effect timelines
- file and Git change correlation
- Git-backed checkpoints and restore guidance
- investigation, replay, and session debriefs
- honest capture-completeness indicators

The MVP does not require a cloud service, account, hosted dashboard, support for other coding harnesses, or an operating-system sandbox.

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

The current slice records Pi lifecycle, prompt, message, turn, tool, user-bash, file read/write/edit, shell command, capture-completeness, truncation/redaction, capture-gap evidence, non-blocking risk notices for a small explicit set of risky shell command patterns, file tool activity, and Git status snapshots at session start/shutdown. Risk review notes include event, cwd, command-result evidence, and plain-language risk explanations when available. File activity is reported as observed Pi tool activity rather than inferred create/overwrite/delete impact. Git status snapshots report branch, worktree path, working-tree state, and changed-file details before/after the session, including status, line counts, changed line ranges, and any observed matching file-tool event by path. Direct path matches include a correlation confidence label. When risky shell commands occur before the shutdown Git snapshot that shows changed paths, debriefs can add a temporal-only correlation note. These notes do not claim causality or attribute exact Git diffs to individual events. Remaining work is focused on final manual validation, richer terminal UX, pre-execution command-resolution/risk previews, and deeper file/Git impact correlation.

## Installation and Usage

### Load BashGuard for one Pi session

To try BashGuard from GitHub without installing it permanently:

```bash
pi -e git:github.com/acheltenham/BashGuard
```

You can pin a branch, tag, or commit:

```bash
pi -e git:github.com/acheltenham/BashGuard@main
pi -e git:github.com/acheltenham/BashGuard@v0.1.0
```

For local development, load your checkout for one Pi run:

```bash
cd bashguard
pi -e .
```

### Install BashGuard as a default Pi extension

Install from GitHub so future Pi sessions load BashGuard automatically:

```bash
pi install git:github.com/acheltenham/BashGuard
```

For repeatable installs, prefer a tagged release when available:

```bash
pi install git:github.com/acheltenham/BashGuard@v0.1.0
```

Or install from your local BashGuard checkout:

```bash
cd bashguard
pi install .
```

These commands install the BashGuard Pi package into Pi settings. The package includes both the BashGuard session-recording extension and a complementary `bashguard` skill that helps Pi use the recorded evidence. Future Pi sessions started from any project should load both automatically.

Start Pi normally from the project you want to record:

```bash
cd your-project
pi
```

In another terminal, list and inspect recorded BashGuard sessions. If the `bashguard` CLI is on your `PATH`, use:

```bash
bashguard sessions
bashguard attach 1
bashguard inspect 1
bashguard inspect 1 --event <event-id-prefix-or-sequence>
bashguard debrief 1
```

During local development, run the CLI from your BashGuard checkout instead:

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

`pi -e ...` and `pi install ...` load the BashGuard Pi extension and bundled `bashguard` skill. They do not necessarily install the `bashguard` shell command globally. During early development, run the CLI from a local checkout with `npm exec -- node --experimental-strip-types src/cli.ts ...` unless you have separately installed a packaged CLI.

## Local Development

```bash
npm install
npm test
npm run check
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

See [Separate-Terminal Attach Test](docs/testing/separate-terminal-attach.md).

## Documents

- [The BashGuard Experience](docs/vision/the-bashguard-experience.md)
- [Terminal UX](docs/vision/terminal-ux.md)
- [Event Model](docs/architecture/event-model.md)
- [Manifesto](docs/vision/manifesto.md)
- [Product Requirements](docs/product/requirements.md)
- [Architecture](docs/architecture/overview.md)
- [Roadmap](docs/product/roadmap.md)
- [Competitive Analysis](docs/research/competitive-analysis.md)
- [MVP Scope](docs/vision/mvp.md)
- [Product Principles](docs/vision/principles.md)
- [Decision Log](docs/adr/decision-log.md)
- [Changelog](CHANGELOG.md)

## Working Positioning

> BashGuard is the local terminal companion, flight recorder, and explainable command guard for Pi.