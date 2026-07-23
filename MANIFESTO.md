# BashGuard Manifesto

**Status:** Draft v0.3  
**Last updated:** July 22, 2026

BashGuard exists because developers deserve to understand what their coding agent actually did.

Pi is powerful because it is flexible, extensible, and local. BashGuard should preserve that freedom while making every meaningful action visible, explainable, and recoverable.

BashGuard is not an enterprise governance platform compressed into a terminal extension. It is a developer tool first: a local flight recorder and explainable command guard for Pi coding sessions.

## Pi Is the Platform

We build on Pi rather than around it.

Pi already provides sessions, lifecycle events, tool interception, extension state, and terminal UI. BashGuard should use those capabilities directly and avoid rebuilding them behind a separate service unless a future requirement proves that an external boundary is necessary.

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

The command shown to a developer must be the command that will actually run.

BashGuard should surface relevant prefixes, wrappers, working directory, path resolution, and other execution context before approval. Invisible command mutation breaks trust.

## Observe Before Enforcing

BashGuard should first help developers see what is happening.

Observation provides the evidence needed to design useful guardrails. Blocking without context creates interruption, not confidence.

Enforcement should remain narrow, explainable, and driven by demonstrated risk.

## Explain Every Decision

“Blocked” is not a sufficient user experience.

When BashGuard allows, warns, requests approval, or denies an action, it should explain:

- what action was evaluated
- what context mattered
- which rule or heuristic matched
- why the outcome was chosen
- what safer alternative may exist
- whether the developer can proceed intentionally

## Git Is the First Safety Net

Pi session branching does not automatically restore the working tree. BashGuard should not invent a custom rollback system before using the recovery mechanism developers already trust.

The initial approach should correlate agent actions with Git state, diffs, checkpoints, and restoration guidance.

## Local First

Prompts, source code, command output, and file changes can be sensitive.

The core product should work locally without accounts, cloud storage, or external telemetry. Developers should control what is captured and retained.

## Developer Experience Over Policy Complexity

Developers should not need to become policy-language experts to understand why a command is risky.

BashGuard may use structured rules internally, but the primary experience should be plain-language explanations, clear risk context, and actionable alternatives.

## Security Through Transparency

Security remains essential, but it is not the only value.

The same timeline that helps investigate a dangerous command also helps debug a failed refactor, compare two agent runs, understand unexpected file changes, and improve instructions.

Trust begins with visibility.

## Pi First

BashGuard will focus deeply on Pi before considering other harnesses.

Multi-harness abstractions, enterprise control planes, cloud synchronization, and organization-wide policy management are not MVP requirements.

## Our Vision

Build the most useful way to understand, review, and safely recover from a Pi coding session.

## Our Standard

BashGuard succeeds when a developer can answer:

> What did Pi do, why did it do it, what changed, and what should I do next?