# BashGuard Product Principles

**Status:** Draft  
**Last updated:** July 22, 2026

## Pi Is the Platform

Use Pi's extension hooks, session model, and terminal UI directly. Do not add infrastructure before a validated requirement demands it.

## Developer First

BashGuard should help a developer understand and recover from an agent session. Security controls must support that workflow rather than dominate it.

## Observe Before Enforcing

Capture and explain behavior before adding broad blocking. Ambiguous actions should usually produce visibility or approval, not silent denial.

## Show What Will Actually Execute

The command presented for approval must include materially relevant prefixes, wrappers, working directory, and target paths where observable.

## Explain Every Decision

Every notice, approval request, or block should include a plain-language reason and useful next action.

## Keep Safe Work Quiet

Routine reads, searches, tests, and scoped development commands should not trigger unnecessary prompts.

## Be Honest About Provenance

Distinguish verified event links from inferred relationships. Show missing or incomplete capture instead of manufacturing certainty.

## Local First

Core functionality must work without accounts, cloud storage, remote services, or required telemetry.

## Protect Sensitive Data

Redact likely secrets before persistence. Do not capture full environment values by default. Give developers control over capture depth and retention.

## Git Before Custom Rollback

Use Git checkpoints, diffs, and restore guidance before inventing a separate filesystem snapshot system.

## Recovery Must Be Intentional

Never silently reset a repository or discard user work. Show impact and provide reviewable recovery options.

## Prefer Small Transparent Rules

The MVP should use a small, inspectable set of risk checks. Do not make a general policy language the first user experience.

## No Silent Mutation

BashGuard must not silently alter commands, policies, repository state, or approval behavior.

## Fail Without Hiding

Capture and Git failures should be surfaced clearly. Degraded observability is better than pretending the timeline is complete.

## Measure Before Expanding

Do not add a daemon, database, web dashboard, multi-harness abstraction, or enterprise features without evidence from real usage.

## Security Boundary Clarity

An in-process Pi extension is not an operating-system sandbox. Product language and UI must communicate that limitation plainly.