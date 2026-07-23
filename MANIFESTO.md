# BashGuard Manifesto

**Status:** Draft v0.4  
**Last updated:** July 23, 2026

BashGuard exists because developers deserve to understand what their coding agent is doing.

Pi is powerful because it is flexible, extensible, and local. BashGuard should preserve that freedom while making every meaningful action visible, explainable, and recoverable.

BashGuard is not an enterprise governance platform compressed into a terminal tool. It is a developer companion: a local flight recorder and explainable command guard for Pi coding sessions.

## Developers Should Never Wonder What Their AI Is Doing

A developer should be able to glance at a second terminal and understand what Pi is doing now, what just happened, and whether anything needs attention.

When something unexpected occurs, BashGuard should make it obvious:

- what happened;
- why it happened;
- what changed;
- what the developer can do next.

## Pi Is Where We Act; BashGuard Is Where We Understand

Pi remains the primary interaction surface for conversation, tool use, and approvals.

BashGuard provides a separate terminal companion for live narration, investigation, replay, and recovery. It should feel like Pi gained transparent instrumentation, not like the developer opened a security dashboard.

## Pi Is the Platform

We build on Pi rather than around it.

Pi already provides sessions, lifecycle events, tool interception, extension state, and terminal UI. BashGuard should use those capabilities directly and avoid rebuilding them behind a cloud platform or heavy service.

A minimal local event transport may be necessary so a second terminal can attach to a running session. That transport should remain simple, local, and subordinate to the user experience.

## Narrate, Do Not Dump Logs

Raw lifecycle callbacks are not a useful product.

BashGuard should turn recorded evidence into a calm execution story:

```text
Reading authentication code
Running tests
Tests failed
Editing src/auth.ts
Focused tests passed
Checkpoint created
```

Narration must remain grounded in evidence. BashGuard should never invent causes, success, or intent.

## Every Action Should Be Understandable

A developer should be able to trace:

```text
Prompt
  ↓
Tool request
  ↓
Resolved command
  ↓
Decision
  ↓
Result
  ↓
File change
  ↓
Git checkpoint
```

A raw shell history is not enough. A security alert is not enough. The useful unit is the complete execution story.

## Never Hide What Will Execute

The command shown to a developer must be the command that will actually run, to the extent it is observable.

BashGuard should surface relevant prefixes, wrappers, working directory, path resolution, and other execution context before approval. Invisible command mutation breaks trust.

## Observe Before Enforcing

BashGuard should first help developers see what is happening.

Observation provides the evidence needed to design useful guardrails. Blocking without context creates interruption, not confidence.

Enforcement should remain narrow, explainable, and driven by demonstrated risk.

## Keep Safe Work Quiet

Routine reads, searches, tests, and narrowly scoped development commands should not create approval fatigue.

BashGuard should interrupt only when the developer needs to decide. The live companion may narrate safe activity without demanding attention.

## Explain Every Decision

“Blocked” is not a sufficient user experience.

When BashGuard allows with notice, requests approval, or denies an action, it should explain:

- what action was evaluated;
- what context mattered;
- which rule or heuristic matched;
- why the outcome was chosen;
- what safer alternative may exist;
- whether the developer can proceed intentionally.

## Progressive Disclosure

The default experience should support three levels:

1. **Glance:** what Pi is doing and whether anything needs attention;
2. **Expand:** command, result, files, and decision context;
3. **Investigate:** complete timeline, evidence, capture gaps, diffs, and recovery.

Developers should not be forced into forensic detail during normal work.

## Git Is the First Safety Net

Pi session branching does not automatically restore the working tree. BashGuard should not invent a custom rollback system before using the recovery mechanism developers already trust.

The initial approach should correlate agent actions with Git state, diffs, checkpoints, and restoration guidance.

BashGuard should never silently reset a repository or discard work.

## Local First

Prompts, source code, command output, and file changes can be sensitive.

The core product should work locally without accounts, cloud storage, or external telemetry. Developers should control what is captured and retained.

## Be Honest About Provenance

BashGuard should distinguish:

- observed facts;
- explanations reported by Pi;
- relationships inferred from timing or Git state;
- information that was redacted or missed.

Incomplete evidence is acceptable. False certainty is not.

## Evidence Before Scores

BashGuard should not hide complexity behind an unexplained trust score.

A session debrief should show the evidence that matters: tests, approvals, warnings, changed files, checkpoints, and capture completeness. Developers can form their own judgment.

## Developer Experience Over Policy Complexity

Developers should not need to become policy-language experts to understand why a command is risky.

BashGuard may use structured checks internally, but the primary experience should be plain-language explanations, clear impact, and actionable alternatives.

## Security Through Transparency

Security remains essential, but it is not the only value.

The same timeline that helps investigate a dangerous command also helps debug a failed refactor, compare two agent runs, understand unexpected file changes, and improve instructions.

Trust begins with visibility.

## Pi First

BashGuard will focus deeply on Pi before considering other harnesses.

Multi-harness abstractions, enterprise control planes, cloud synchronization, and organization-wide policy management are not MVP requirements.

## Our Vision

Build the most useful terminal experience for understanding, reviewing, replaying, and safely recovering from a Pi coding session.

## Our Standard

BashGuard succeeds when a developer can answer:

> What is Pi doing, what did it do, why did it happen, what changed, and what should I do next?