# Security policy

## Current scope

BashGuard is an early-stage, local-first Pi companion for recording and investigating coding-agent sessions.

The current release provides observation for most risk patterns, with narrow one-time authorization for a small explicit set of destructive shell commands. Agent-initiated Pi `bash` tool calls matching recursive forced deletion, `git-reset-hard`, or `git-clean-forced` require one-time in-Pi approval from the active recorder owner. One Run once or Decline decision covers the whole BashGuard-observed tool call and every matched check. Approval or confirmation failures return Pi's block result. When the Pi UI is unavailable, these checks fail closed and block. Other current risk patterns remain non-blocking observation-only review notes.

BashGuard does not sandbox, contain, recover, or restore actions. It is not a security boundary, execution broker, complete policy enforcement system, or complete audit log. Approved commands execute with the BashGuard-observed input visible when its handler runs; earlier handlers, later handlers, replacement-tool internals, shell runtime, expansion, and child-process behavior can produce different command layers. There is no universal resolved-command preview yet, and the current matching is conservative. See docs/current-state.md for the authoritative limitation list.

BashGuard records local session evidence and may persist command text, file paths, tool inputs, and command output. Capture may be partial, redacted, truncated, or missing. Do not use BashGuard with sensitive sessions without reviewing the local storage and redaction limitations.

## Reporting a vulnerability

Please do not include secrets, credentials, private session JSONL, or other sensitive data in a public issue.

For a suspected security vulnerability, contact the maintainer privately through the contact details on the GitHub profile or use GitHub's private vulnerability reporting if it is enabled for the repository. Include:

- a concise description of the issue;
- affected version or commit;
- reproduction steps;
- expected and actual behavior;
- sanitized logs or event details;
- any known impact.

If private reporting is unavailable, open a public issue with the minimum sanitized information necessary and state that sensitive details should be exchanged privately.

## Ordinary bugs

For non-sensitive bugs, use the [bug report template](https://github.com/acheltenham/BashGuard/issues/new?template=bug_report.md).
