# BashGuard Agent Guide

## Project status

BashGuard is early-stage. Product/design docs remain important context for implementation decisions.

Read these before changing behavior:

- `README.md`
- `docs/plans/milestone-0-observe-a-real-pi-session.md`
- `docs/architecture/event-model.md`
- `docs/research/pi-capability-matrix.md`
- `docs/architecture/overview.md`
- `docs/product/requirements.md`

## Local development

Use npm from the repository root.

```bash
npm install
npm test
npm run check
```

Useful manual commands:

```bash
# Run the CLI directly during development
node --experimental-strip-types src/cli.ts sessions
node --experimental-strip-types src/cli.ts attach 1
node --experimental-strip-types src/cli.ts inspect 1 --event <event-id-prefix-or-sequence>
node --experimental-strip-types src/cli.ts debrief 1

# Run Pi with the local BashGuard extension/package
pi -e .
```

Set `BASHGUARD_DATA_DIR` to isolate test session data, for example:

```bash
BASHGUARD_DATA_DIR=/tmp/bashguard-test node --experimental-strip-types src/cli.ts sessions
```

## Implementation principles

- Keep the Milestone 0 path focused on observing and narrating a real Pi session.
- Store core data locally; no cloud service, daemon, browser UI, or SQLite unless docs are updated first.
- Use append-only JSONL for the initial session stream.
- Every narrative statement must be grounded in recorded events.
- Distinguish observed, reported, inferred, redacted, and missing evidence.
- Prefer visible degraded capture over invented provenance.

## Pi extension notes

- This repo is a Pi package via the `pi.extensions` manifest in `package.json`.
- Extensions run with full local user permissions; avoid broad filesystem or shell side effects in module top-level code.
- Start background work only from `session_start` or from a command/tool that needs it; clean it up from `session_shutdown`.
- Manual extension test: `pi -e .` from this repository.

## Testing expectations

- Write tests before implementation for new behavior.
- Unit-test JSONL parsing, session discovery, liveness detection, narration projection, debrief aggregation, and evidence rendering.
- Integration-test extension writer + CLI reader where possible.
- Before claiming completion, run `npm test` and `npm run check`.
