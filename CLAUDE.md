# Claude Development Notes

Follow `AGENTS.md` for project instructions.

Key commands:

```bash
npm install
npm test
npm run check
```

Manual Pi/BashGuard testing:

```bash
pi -e .
BASHGUARD_DATA_DIR=/tmp/bashguard-test node --experimental-strip-types src/cli.ts sessions
BASHGUARD_DATA_DIR=/tmp/bashguard-test node --experimental-strip-types src/cli.ts attach <session-id>
```

Current priority: harden the CLI/session stream with automated tests, then add `inspect` and debrief support for Milestone 0.
