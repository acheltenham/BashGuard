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
- `attach` follows an active session or renders a completed session timeline. It accepts a session number, full session ID, unique session prefix, or `--session`.
- `inspect` without `--event` lists inspectable events for a session. With `--event`, it prints evidence for one recorded event by event ID, event ID prefix, or sequence.
- `debrief` summarizes a completed session with evidence-based review notes.

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

BashGuard has a working Milestone 0 foundation: a Pi extension records real sessions into local append-only JSONL, and a separate `bashguard` CLI can discover, attach to, inspect, and debrief those sessions without terminal scraping or a daemon.

The current slice records Pi lifecycle, prompt, message, turn, tool, user-bash, file read/write/edit, shell command, capture-completeness, truncation/redaction, and capture-gap evidence. Remaining work is focused on final manual validation, richer terminal UX, command-resolution/risk previews, and file/Git impact correlation.

## Installation and Usage

### Install BashGuard as a default Pi extension

From this repository:

```bash
cd /Users/antoniocheltenham/BashGuard
pi install .
```

That installs this local package into Pi user settings. Future Pi sessions started from any project should load the BashGuard extension automatically.

Start Pi normally from the project you want to record:

```bash
cd /path/to/your/project
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

During local development, run the CLI from this repository instead:

```bash
cd /Users/antoniocheltenham/BashGuard
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

Remove the local BashGuard package with:

```bash
pi remove /Users/antoniocheltenham/BashGuard
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

### Development mode without installing

For quick tests, load the local extension for one Pi run:

```bash
cd /Users/antoniocheltenham/BashGuard
pi -e .
```

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
- [Manifesto](MANIFESTO.md)
- [Product Requirements](PRODUCT_REQUIREMENTS.md)
- [Architecture](ARCHITECTURE.md)
- [Roadmap](ROADMAP.md)
- [Competitive Analysis](COMPETITIVE_ANALYSIS.md)
- [MVP Scope](docs/vision/mvp.md)
- [Product Principles](docs/vision/principles.md)
- [Decision Log](DECISIONS.md)
- [Changelog](CHANGELOG.md)

## Working Positioning

> BashGuard is the local terminal companion, flight recorder, and explainable command guard for Pi.