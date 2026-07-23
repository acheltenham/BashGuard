# BashGuard Competitive Analysis

**Status:** Working draft  
**Last updated:** July 22, 2026  
**Scope:** Pi-first competitive and substitute analysis

## Executive Summary

The market is not empty. Agent governance, MCP security, sandboxing, secret scanning, policy engines, and AI-code security are all active categories.

However, most products operate at one of three layers:

1. enterprise agent infrastructure;
2. MCP or protocol gateways;
3. repository and application-security scanning.

They are not designed around the local experience of a developer using Pi in a coding session.

Pi itself is the most important substitute. It already provides a TypeScript extension system, lifecycle events, tool interception, bash interception, custom terminal UI, project-local configuration, and local JSONL session storage. This means BashGuard should not recreate Pi's session model, extension framework, or basic approval dialogs.

The strongest evidence-backed opportunity is narrower:

> BashGuard can become a Pi-native execution-governance and provenance extension that makes risky actions visible, explainable, reviewable, and reversible.

This is more defensible than claiming to be the first open-source agent governance platform.

## Primary Findings

### 1. Pi already provides most of the extension surface required for an MVP

Pi extensions can observe lifecycle events, inspect and block tool calls, mutate tool arguments, intercept user bash execution, add confirmation prompts and custom TUI components, and persist extension-specific state in sessions.

Pi sessions are stored locally as JSONL trees and support browsing, branching, cloning, compaction, export, and continuation.

This strongly suggests that the first BashGuard release can be implemented as a TypeScript Pi extension without a separate Rust daemon.

### 2. Pi does not provide a security boundary

Pi runs with the permissions of the user and process that launched it. Its official documentation states that it does not include a built-in permission system for restricting filesystem, process, network, or credential access.

A Pi extension can govern cooperative execution inside Pi, but it cannot defend against a compromised Pi process or commands launched outside Pi. A daemon, sandbox, or operating-system boundary may eventually be justified for stronger enforcement, but it is not required to validate the developer workflow.

### 3. The user pain is real but currently supported by limited primary evidence

The strongest confirmed Pi-specific pain points are:

- users cannot always see the fully resolved command they are approving;
- project-controlled settings can affect command execution in ways that weaken trust;
- conversation branching does not automatically restore filesystem state;
- developers want rewind, rollback, checkpointing, and diff previews;
- developers need safer workflows when running Pi in unfamiliar repositories.

These themes are supported by Pi discussions and community extensions, but there is not yet enough evidence to rank ten recurring pain points or claim broad market demand.

### 4. Existing Pi extensions already cover basic command approval and secret filtering

A community package shared in the Pi discussions includes:

- a security extension that blocks dangerous commands such as `sudo` until explicitly approved;
- an output filter that detects and redacts some sensitive values before they are sent to the model.

Other community examples include protected paths, dirty-repository guards, git checkpointing, permission gates, and rewind-style file restoration.

Therefore, BashGuard should not differentiate on a simple denylist, confirmation dialog, or token-redaction hook alone.

## Competitive Classification

### Direct competitors

No verified project currently provides the complete Pi-native workflow BashGuard proposes.

The closest direct substitutes are small Pi extensions that implement individual controls such as command approval, protected paths, output filtering, git checkpointing, or rewind.

### Partial competitors

#### Project CodeGuard

Project CodeGuard provides security rules, skills, validators, translators, and an MCP server for multiple coding agents. It is relevant to repository security guidance and agent-facing security rules.

Its limitation relative to BashGuard is that it is not centered on Pi session execution, local provenance, or developer-facing replay.

#### SentinelMCP

SentinelMCP appears to focus on inspecting, redacting, approving, and auditing MCP tool calls. It overlaps with interception and approval, but the available evidence is not strong enough to verify a Pi-native experience or durable session replay.

#### Agent Approve

Agent Approve is positioned around human approval of agent actions. Public technical evidence is currently too limited for a reliable feature comparison.

### Adjacent infrastructure

#### Microsoft Agent Governance Toolkit

Microsoft's Agent Governance Toolkit is the strongest adjacent open-source competitor. It covers policy enforcement, identity, approvals, audit, sandboxing, MCP governance, and tamper-evident records.

It demonstrates that BashGuard cannot credibly claim to invent agent governance or tamper-evident audit.

Its main difference is product context: it is aimed at developers and enterprises building autonomous agent systems, rather than an individual developer governing a local Pi coding session.

#### agentgateway, Lasso MCP Gateway, and Obot MCP Gateway

These projects govern traffic between agents, models, tools, and MCP servers. They matter if BashGuard later expands into MCP mediation, but they are not direct competitors to the initial Pi extension workflow.

#### Snyk, GitHub Advanced Security, Sysdig, Straiker, and Cisco

These products cover AI-generated code scanning, repository security, runtime detection, or enterprise agent security. They may detect insecure outputs or dangerous runtime behaviour, but they do not provide the same local, session-oriented Pi experience.

### Substitutes

The most important substitutes are:

- Pi's built-in sessions, tree navigation, fork, clone, export, and local JSONL storage;
- Git commits, worktrees, and manual checkpoints;
- containers and development sandboxes;
- project instructions in `AGENTS.md` or `CLAUDE.md`;
- small Pi extensions for approvals, protected paths, output filtering, and rewind;
- general policy engines such as OPA, Cedar, and Conftest;
- secret scanners such as Gitleaks and TruffleHog.

## What Is Already Solved Well

The following areas are mature or sufficiently covered that BashGuard should integrate rather than rebuild them:

- repository secret scanning;
- static application-security scanning;
- general-purpose policy languages;
- container and operating-system sandboxing;
- MCP gateway authentication and traffic mediation;
- Pi session storage and conversation-tree navigation;
- basic command confirmation dialogs;
- basic git checkpointing and rollback.

## Underserved Areas

### Prompt-to-effect provenance

Pi records prompts, model messages, tool calls, and tool results, but it does not present a first-class chain showing:

`user intent -> model decision -> tool call -> resolved command -> policy decision -> filesystem effect -> result`

This chain is the clearest BashGuard opportunity.

### Explainable command decisions

A developer should see the exact command that will execute, including prefixes, wrappers, working directory, environment changes, and policy reasons.

A binary allow or deny prompt is less useful than an explanation such as:

- why the command is risky;
- which rule matched;
- which files or resources it can affect;
- what safer alternative is available.

### Session review tied to repository state

Pi can replay the conversation tree, and git can restore files, but the two are not presented as a unified timeline. BashGuard can connect session entries to commands, diffs, checkpoints, and repository state.

### Learn-before-enforce policy recommendations

The current evidence does not show a Pi extension that observes normal behaviour, identifies recurring safe patterns, and proposes understandable project-scoped policy changes without silently enforcing them.

This remains a promising differentiator, but it must be validated after the core recorder is useful.

## Product Implications

### MVP architecture

The MVP should be a TypeScript Pi extension.

It should use Pi's existing:

- `before_agent_start` event;
- `tool_call` and `tool_result` events;
- bash interception hooks;
- session lifecycle events;
- project-local extension and configuration model;
- custom TUI components;
- session storage or extension entries.

A Rust daemon should be deferred until there is evidence that users require enforcement outside Pi's process boundary.

### Recommended MVP

The narrowest useful release should provide:

1. **Resolved command preview**  
   Show exactly what Pi is about to execute, including command mutation, prefix, working directory, and relevant environment context.

2. **Explainable risk decisions**  
   Apply simple project-aware rules and explain why a command is allowed, warned, blocked, or requires approval.

3. **Execution timeline**  
   Record the relationship between prompt, tool call, command, result, and changed files in a local reviewable timeline.

4. **Git-backed checkpoint integration**  
   Associate actions with repository diffs or checkpoints rather than building a new filesystem snapshot engine.

### Explicit non-goals for the MVP

Do not initially build:

- a cross-harness platform;
- a general MCP gateway;
- a new policy language;
- a cloud dashboard;
- enterprise identity infrastructure;
- a replacement for Git;
- a replacement for Pi's session browser;
- a hardened OS sandbox;
- autonomous policy learning or automatic enforcement;
- a Rust daemon.

## Positioning Options

### Option A: Pi security extension

**Job:** Prevent dangerous commands and sensitive-data exposure.  
**Risk:** Existing community extensions already address the basic version of this problem.  
**Assessment:** Too narrow and easy to copy unless paired with provenance and explanation.

### Option B: Pi observability and session recorder

**Job:** Help developers understand what Pi did and why.  
**Differentiator:** A repository-aware timeline connecting prompts, commands, results, and diffs.  
**Risk:** Developers may see Pi's JSONL sessions and Git history as sufficient.  
**Assessment:** Strong developer value and the best initial adoption wedge.

### Option C: Pi execution-governance companion

**Job:** Observe, explain, approve, record, and eventually enforce Pi actions.  
**Differentiator:** Combines command visibility, policy explanation, provenance, and repository state.  
**Risk:** Broader scope and a greater chance of becoming enterprise-heavy too early.  
**Assessment:** Best long-term position, provided the first release stays focused.

## Recommended Position

BashGuard should launch as:

> **A local flight recorder and explainable command guard for Pi.**

The first adoption wedge is observability: show developers exactly what happened and why. Command approval and policy enforcement should build on that evidence rather than define the entire product.

The longer-term category is a Pi execution-governance companion.

## Evidence That Would Invalidate the Project

BashGuard should be reconsidered if any of the following becomes true:

- Pi adds a built-in resolved-command approval view with policy explanations;
- Pi adds a first-class timeline joining prompts, tool calls, commands, diffs, and repository state;
- an established Pi package already provides this workflow with meaningful adoption;
- Pi users consistently report that JSONL sessions and Git history are sufficient;
- the extension hooks cannot reliably observe or associate filesystem effects with tool execution;
- developers reject the additional approval or recording friction.

## Open Research Questions

- How frequently do Pi users experience unsafe or surprising command execution?
- How often do users inspect or share Pi session files?
- Can tool calls be reliably associated with filesystem diffs without excessive overhead?
- What exact command transformations occur before execution?
- Which environment fields can be recorded safely without leaking credentials?
- Should BashGuard store provenance inside Pi sessions, in a separate local database, or both?
- Does Pi expose enough information to distinguish agent-issued bash calls from user-issued `!` commands in every mode?

## Primary Sources

- Pi repository: https://github.com/earendil-works/pi
- Pi extension documentation: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
- Pi session documentation: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md
- Pi quickstart and permissions model: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/quickstart.md
- Pi discussions: https://github.com/earendil-works/pi/discussions
- Pi extension discussion and community package examples: https://github.com/earendil-works/pi/discussions/3373
- Microsoft Agent Governance Toolkit: https://github.com/microsoft/agent-governance-toolkit
- Project CodeGuard: https://github.com/cosai-oasis/project-codeguard
- agentgateway: https://github.com/agentgateway/agentgateway

## Confidence

**High confidence:** Pi extension capabilities, local sessions, lack of built-in OS permission boundary, and the existence of community approval/filtering extensions.  
**Medium confidence:** Provenance and repository-linked replay remain underserved in the Pi ecosystem.  
**Low confidence:** The size of market demand and recurrence of the reported user pain. More primary-user research is required.