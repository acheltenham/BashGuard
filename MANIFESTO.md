# BashGuard Manifesto

**Status:** Draft v0.2  
**Last updated:** July 22, 2026

BashGuard exists because powerful agent harnesses need more than a list of blocked commands.

Pi gives developers a flexible, extensible environment for building with agents. That flexibility is valuable, but it also means developers need a clear way to understand what the agent is doing, why it is doing it, and what boundaries should apply inside a project.

BashGuard is being built as the missing security, governance, and observability companion for Pi.

## Context First

A command is not dangerous or safe in isolation.

Its meaning depends on:

- who initiated it
- which agent executed it
- which repository it ran inside
- which files and systems it could affect
- which credentials were available
- what the developer asked the agent to accomplish

BashGuard evaluates actions in context, not as disconnected strings.

## Identity Matters

Every action should be attributable.

BashGuard should preserve the chain between the human, the prompt, the Pi session, the tool, the command, and the resulting change.

The goal is not surveillance. The goal is accountability and clarity.

## Observe Before Enforcing

Security tools often begin by blocking. BashGuard begins by observing.

Developers should first be able to see:

- what Pi attempted
- what it executed
- what changed
- which actions were repeated
- where risk accumulated

Only after that should BashGuard recommend or enforce guardrails.

## Explain Every Decision

A security decision that cannot be explained is difficult to trust.

When BashGuard allows, constrains, requests approval for, or denies an action, it should explain:

- what was evaluated
- which context mattered
- which guardrail applied
- why the decision was made
- what safer alternative may exist

## Security Should Teach

BashGuard should help developers understand agent risk instead of treating them as passive users of a policy engine.

Recommendations should be practical, specific, and grounded in observed behaviour.

The product should help users build better guardrails over time.

## Human-Readable Guardrails

Developers should not need to become policy-language specialists.

Guardrails should be readable, reviewable, and close to the repository they protect.

The product may use structured policy internally, but the developer experience should remain understandable.

## Repository Awareness

Repositories already contain valuable context:

- module boundaries
- documentation
- ownership
- agent instructions
- architecture decisions
- protected paths
- test and deployment workflows

BashGuard should use that context when evaluating execution.

## Local First

BashGuard should work locally and offline.

Project data, prompts, execution records, and policies should remain under the developer's control by default.

Cloud services may be considered later, but they must not be required for the core experience.

## Open by Design

BashGuard should be open source, inspectable, and extensible.

The community should be able to understand how decisions are made, contribute integrations, and challenge unsafe assumptions.

## Pi First

BashGuard will focus deeply on Pi.

The initial product will not attempt to support every agent harness. Other commercial and hosted harnesses often provide their own security controls, while Pi's openness creates a clearer opportunity for a focused companion layer.

The architecture may leave room for future adapters, but the product roadmap, user experience, and MVP will be designed around Pi.

## Our Vision

Build the trusted local companion for governing and understanding Pi agent execution.

## Our Standard

BashGuard succeeds when a developer can answer:

> What did Pi do, why did it do it, what changed, and were the right boundaries applied?
