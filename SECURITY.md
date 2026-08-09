# Security policy

## Current scope

BashGuard is an early-stage, local-first Pi companion for recording and investigating coding-agent sessions.

The current release is observation-only. BashGuard does not yet approve, block, interrupt, sandbox, or restore actions. It should not be treated as a security boundary, execution broker, policy enforcement system, or complete audit log.

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
