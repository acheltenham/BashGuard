# BashGuard Product Principles

**Status:** Draft  
**Last updated:** July 23, 2026

## Developers Should Never Wonder What Their AI Is Doing

BashGuard should make current activity, recent outcomes, unexpected changes, and next actions understandable without forcing developers to reconstruct the story from logs.

## Pi Is Where We Act; BashGuard Is Where We Understand

Pi remains the primary surface for conversation and approvals. BashGuard provides the attached terminal experience for narration, investigation, replay, and recovery.

## Pi Is the Platform

Use Pi's extension hooks, session identity, tool interception, and local session model directly. Do not add infrastructure before a validated requirement demands it.

## Narrate, Do Not Dump Logs

Group low-level events into grounded, developer-meaningful activity. Preserve the underlying evidence, but do not make raw lifecycle callbacks the default interface.

## Developer First

BashGuard should help a developer understand and recover from an agent session. Security controls must support that workflow rather than dominate it.

## Keep Safe Work Quiet

Routine reads, searches, tests, and scoped development commands should not trigger unnecessary prompts or noisy warnings.

## Interrupt Only for a Decision

BashGuard should become prominent when the user needs to approve, decline, review material risk, or respond to degraded capture.

## Observe Before Enforcing

Capture and explain behavior before adding broad blocking. Ambiguous actions should usually produce visibility or approval, not silent denial.

## Show What Will Actually Execute

The command presented for approval must include materially relevant prefixes, wrappers, working directory, and target paths where observable.

## Explain Every Decision

Every notice, approval request, or block should include a plain-language reason, potential impact, and useful next action.

## Use Progressive Disclosure

The experience should support glance, expand, and investigate levels. Do not put forensic detail into the default live view.

## Preserve Pi Session Identity

Use the Pi session ID as the canonical identifier. Friendly display forms must not create a confusing second session system.

## Be Honest About Provenance

Distinguish observed facts, model-reported explanations, inferred relationships, redacted data, and missing capture. Never manufacture certainty.

## Evidence Before Scores

Show tests, warnings, approvals, files, checkpoints, and capture completeness. Do not make an unexplained trust score the primary judgment.

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

Capture, transport, narration, and Git failures should be surfaced clearly. Degraded observability is better than pretending the timeline is complete.

## The Companion Must Be Optional to Pi's Operation

Pi should continue to work and record when the separate BashGuard terminal disconnects or closes. Observability must not become a fragile runtime dependency.

## Measure Before Expanding

Do not add a daemon, database, browser dashboard, multi-harness abstraction, or enterprise features without evidence from real usage.

## Security Boundary Clarity

An in-process Pi extension and attached terminal companion are not an operating-system sandbox. Product language and UI must communicate that limitation plainly.

Agent security is several independent controls, not one. BashGuard owns **authorization** — should this action run? — and **observability** — can we reconstruct what happened? It delegates **containment** and **network policy** to a sandbox backend and does not implement them. Authorization is not containment, and BashGuard must never let one stand in for the other in its output.

Where a backend is present, BashGuard describes the boundary in force and states what that boundary does *not* cover. Three rules keep that honest:

- a boundary **reported** from configuration is never presented as one **observed** to be active;
- coverage gaps are stated rather than implied, because a backend that mediates shell commands but not file-write tools will otherwise be read as complete protection;
- BashGuard runs inside whatever boundary exists, so it reports "no containment boundary detected" and never "none exists".

See [Decision 005](../adr/decision-log.md).