# BashGuard Product Requirements Document

**Status:** Draft v0.2  
**Project:** BashGuard  
**Last updated:** July 22, 2026

## Executive Summary

BashGuard is an open-source, local-first security, governance, and observability companion for Pi.

Pi gives developers a flexible agent harness with significant execution freedom. That flexibility is useful, but it creates a gap: developers need a clear way to understand what Pi is doing, connect actions back to prompts and sessions, apply project-aware guardrails, and review the resulting impact.

BashGuard fills that gap by combining deep Pi integration with execution provenance, repository intelligence, explainable guardrails, session replay, and a local audit experience.

The initial product will focus only on Pi. Support for other harnesses is explicitly outside the MVP.

## Vision

Build the trusted local companion for governing and understanding Pi agent execution.

## Mission

Help developers safely use Pi by making agent execution observable, explainable, and controllable within the context of a repository.

## Problem Statement

Pi can read files, modify code, execute shell commands, call tools, and perform multi-step work with limited built-in governance.

Developers often lack a complete answer to questions such as:

- Which prompt caused this action?
- Which Pi session executed it?
- Which tool and command were involved?
- Which repository and files were affected?
- Which credentials or environment were available?
- Why was the action allowed or denied?
- What changed as a result?

Traditional shell history, command blocklists, and approval prompts provide only fragments of this picture.

BashGuard should provide the complete execution chain and use that context to guide decisions.

## Product Positioning

BashGuard is not only a shell-command blocker.

It is a local companion for Pi that provides:

- execution visibility
- session replay
- repository-aware risk context
- explainable guardrails
- policy recommendations
- auditable execution provenance

Working positioning:

> Govern Pi with context, not just commands.

## Target Users

### Pi Power Users

Developers who use Pi for meaningful coding and automation work and want greater visibility without losing flexibility.

Success statement:

> I can see exactly what Pi did and understand why.

### Security-Minded Developers

Developers who want boundaries around destructive commands, sensitive files, credentials, deployments, and external systems.

Success statement:

> I can use Pi with practical safeguards that match my project.

### Open-Source Maintainers

Maintainers who want contributors to use Pi consistently and safely inside a repository.

Success statement:

> The repository can carry understandable guardrails and agent instructions with it.

### Security and Platform Engineers

Future users who may need stronger audit and policy controls across multiple projects.

These users inform the design but are not the primary MVP audience.

## Product Goals

### Primary Goals

- Integrate deeply with Pi.
- Capture complete Pi session activity.
- Connect prompts, tool calls, commands, file changes, policies, decisions, and results.
- Provide a local session replay and audit timeline.
- Apply repository-aware guardrails to Bash execution.
- Explain every allow, constrain, approval, and deny decision.
- Observe user behaviour before recommending stricter enforcement.
- Keep the core experience local and under the developer's control.

### Secondary Goals

- Make guardrails easy to read and update.
- Use repository documentation and project boundaries as security context.
- Provide a foundation for future Pi tool integrations beyond Bash.
- Create an architecture that can evolve without forcing premature support for other harnesses.

## Non-Goals for the MVP

The MVP will not include:

- support for Claude Code, Cursor, Codex, or other harnesses
- a hosted cloud service
- user accounts or billing
- organization-wide policy management
- remote synchronization
- team approval workflows
- SIEM integrations
- endpoint detection and response
- kernel-level process monitoring
- general-purpose shell protection outside Pi
- autonomous policy changes without user review

## Foundational Concepts

### Identity

Who initiated and executed the action?

The model should distinguish between:

- the human developer
- the Pi session
- the model or agent identity when available
- the tool or extension
- the operating-system user
- the credential or service identity used

### Context

Where and under what conditions did the action occur?

Relevant context includes:

- repository
- branch
- working directory
- module or folder
- project documentation
- protected paths
- environment
- available credentials
- current session intent

### Decision

Why was the action allowed, constrained, sent for approval, or denied?

Each decision should identify:

- the evaluated action
- relevant context
- matched guardrail
- risk factors
- outcome
- suggested safer alternative when applicable

### Provenance

What happened and what was the impact?

The complete chain is:

Human

↓

Prompt

↓

Pi Session

↓

Tool

↓

Credential

↓

Command

↓

Repository

↓

Files

↓

Guardrail

↓

Decision

↓

Result

## Core Capabilities

### Pi Extension

A first-party Pi extension should capture session and tool activity and communicate with the local BashGuard service.

The extension should support:

- session start and completion
- prompt metadata capture
- tool request capture
- command interception
- approval interactions
- result reporting
- correlation identifiers across events

### Bash Execution Guard

The first execution control should focus on Bash commands initiated through Pi.

Possible outcomes:

- allow
- allow with constraints
- require approval
- deny

The guard should support:

- command parsing
- working-directory scope
- path-aware evaluation
- destructive-operation detection
- network and package-management context
- repository and branch context
- explanations and safer suggestions

### Session Replay

Users should be able to replay a Pi session as a connected timeline.

A replay may include:

- user prompt
- files read
- tools requested
- commands proposed
- guardrail decisions
- approvals
- commands executed
- command results
- files modified
- git diff or repository changes
- session outcome

### Execution Provenance

Every relevant event should be connected using stable correlation identifiers.

Users should be able to trace from a file change back to the prompt and Pi session that caused it.

### Repository Intelligence

BashGuard should build practical context from the repository, including:

- repository root
- language and framework indicators
- module and folder boundaries
- AGENT.md or equivalent instruction files
- project documentation
- protected or sensitive paths
- git branch and status
- policy files

The MVP should favour explicit repository signals over speculative semantic analysis.

### Guardrails

Guardrails are the user-facing policy model.

They should be:

- human-readable
- repository-aware
- explainable
- testable
- version controlled when stored in a repository

The internal representation may use YAML or another structured format, but the user experience should not be regex-first.

### Observation Mode

BashGuard should default to observing before enforcing wherever practical.

Observation mode records what would have happened and which guardrails would have applied without blocking the developer.

### Recommendations

BashGuard may suggest guardrail changes based on repeated behaviour.

Examples:

- A command has been approved many times and may be safely scoped.
- Access to a sensitive path has repeatedly been denied and should be protected explicitly.
- A recurring command can be constrained to one folder.

Recommendations must never alter policy automatically.

### Policy Simulation

Users should be able to test a proposed guardrail against recorded sessions before enabling it.

### Local Dashboard

The local dashboard should provide:

- projects
- sessions
- session replay
- audit search
- guardrail decisions
- recommendations
- policy simulation
- repository context

## User Journey

1. Install the BashGuard service and Pi extension.
2. Open a repository with Pi.
3. BashGuard discovers the project and begins in observation mode.
4. Pi activity appears in the local session timeline.
5. BashGuard surfaces risky or repeated patterns.
6. The user reviews recommended guardrails.
7. The user enables selected guardrails.
8. Future decisions are explained and recorded.
9. The user can replay and audit any captured session.

## MVP Scope

### Included

- Pi extension
- local BashGuard service
- local dashboard
- SQLite storage
- project discovery
- Pi session tracking
- Bash command interception
- observation mode
- basic guardrail engine
- approval and deny outcomes
- execution provenance
- session replay timeline
- file and git change capture where available
- human-readable explanations
- recommendations
- policy simulation

### Deferred

- additional harnesses
- MCP tool governance
- GitHub API governance
- Docker and Terraform-specific adapters
- Kubernetes and cloud-provider adapters
- team collaboration
- central policy management
- cloud sync
- enterprise identity integrations

## Product Principles

### Pi First

Every MVP feature should improve the Pi experience directly.

Future extensibility must not create unnecessary abstractions or weaken the Pi integration.

### Observe Before Enforcing

Visibility and understanding come before blocking.

### Explain Every Decision

A decision without a useful explanation is incomplete.

### Context Over Command Strings

The same command can carry different risk depending on repository, path, branch, identity, and intent.

### Local First

Core functionality must work without accounts, hosted services, or external synchronization.

### Human-Readable Guardrails

Users should be able to understand and review the controls that govern their agent.

### Security Should Teach

The product should help users build confidence and better habits rather than simply interrupting them.

### No Silent Policy Mutation

BashGuard may recommend changes but must not silently change enforcement.

## Technical Direction

These choices guide early design but may be revisited through architecture decisions.

### Core Service

- Rust

### Pi Integration and Dashboard

- TypeScript
- React for the local dashboard

### Storage

- SQLite

### Communication

- local API
- real-time event stream where useful

### Policy Format

- human-readable structured configuration, likely YAML

### Deployment Model

- local daemon or service
- local web interface
- no required cloud dependency

## Privacy and Data Handling

Prompt and session content may contain source code, secrets, or personal information.

The product should support clear capture modes:

- metadata only
- redacted content
- full local content

Full prompt storage should not be assumed without an explicit product decision.

Sensitive values should be redacted before persistence wherever practical.

## Audit Event Model

The MVP should use an append-oriented event model for session reconstruction.

Candidate events include:

- session.started
- prompt.received
- tool.requested
- policy.evaluated
- approval.requested
- approval.granted
- approval.denied
- command.started
- command.completed
- filesystem.changed
- git.changed
- session.completed

Each event should include available correlation identifiers for:

- project
- session
- prompt
- tool call
- command
- decision

## Success Criteria

A successful MVP lets a user reliably answer:

- Which Pi session caused this change?
- Which prompt initiated the work?
- Which commands did Pi request and execute?
- Which files changed?
- Which guardrails applied?
- Why was an action allowed or denied?
- Which approvals occurred?
- What safer alternative was suggested?
- What guardrails should I consider adding?

## Initial Success Metrics

Metrics should focus on product usefulness rather than vanity adoption numbers.

Candidate measures:

- percentage of Pi Bash actions captured successfully
- percentage of recorded actions linked to a session and project
- percentage of decisions with an explanation
- session replay completeness
- false-positive rate for high-risk recommendations
- time required to create or update a guardrail
- percentage of users who progress from observation to at least one enabled guardrail

## Release Milestones

### Milestone 1: Pi Observability

- Pi extension
- local service
- SQLite event storage
- project discovery
- session timeline
- command and result capture

### Milestone 2: Bash Guardrails

- policy evaluation
- allow, constrain, approve, and deny outcomes
- explanations
- observation mode
- local guardrail management

### Milestone 3: Repository Intelligence

- instruction-file discovery
- folder and module context
- protected paths
- richer file and git impact tracking

### Milestone 4: Recommendations and Simulation

- repeated-behaviour analysis
- guardrail recommendations
- policy simulation against past sessions

### Milestone 5: Pi Ecosystem Expansion

- governance for additional Pi tools
- extension SDK or integration interfaces
- community guardrail templates

Support for other harnesses requires a separate future product decision.

## Open Questions

- Which Pi extension hooks provide reliable prompt, tool, and session events?
- Should prompt content be stored by default, and in which capture mode?
- How should BashGuard redact secrets before persistence?
- Which guardrails belong in the repository versus user-level configuration?
- How should folder-level inheritance work?
- What defines the boundary of a Pi session?
- How should shell pipelines and compound commands be evaluated?
- How should BashGuard detect file changes caused indirectly by a command?
- Which repository context can be trusted versus treated as untrusted input?
- How should approvals behave when Pi is running unattended?

## Definition of Success

BashGuard becomes the trusted local companion for Pi.

Developers install it because it makes Pi observable.

They keep it because it makes agent execution easier to understand and safer to control.

Security practitioners trust it because every meaningful action can be connected to its identity, context, decision, and result.
