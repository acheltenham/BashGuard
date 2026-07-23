# BashGuard Competitive Analysis

**Status:** Working draft v0.2  
**Last updated:** July 22, 2026  
**Scope:** Pi-first competitive, substitute, and UX analysis

## Executive Summary

The market is not empty. Agent governance, MCP security, sandboxing, secret scanning, policy engines, and AI-code security are active categories.

Most products, however, are designed for enterprise operators, security teams, or infrastructure gateways. Their primary interfaces are policy files, alerts, audit logs, dashboards, and approval queues.

BashGuard's opportunity is different:

> Build the local flight recorder and explainable command guard for a developer using Pi.

Pi itself is the most important substitute and the platform BashGuard should extend. Pi already provides TypeScript extensions, lifecycle events, tool interception, terminal UI, project-local configuration, and local session storage. BashGuard should not recreate those systems behind a daemon or web application.

The defensible gap is the user experience that connects:

```text
prompt -> tool request -> resolved command -> decision -> result -> file change -> Git checkpoint
```

## Validated Findings

### Pi can support the MVP directly

Pi exposes enough extension surface to prototype command interception, event capture, approvals, custom terminal UI, and session-associated state in TypeScript.

Product implication:

- no Rust daemon for the MVP
- no local API for the MVP
- no separate React dashboard for the MVP
- no cross-harness abstraction for the MVP

### Pi is not an operating-system security boundary

A Pi extension runs in process and with the permissions of the user who launched Pi. BashGuard can govern supported Pi execution flows, but it cannot claim to sandbox a compromised process or observe every out-of-band filesystem, process, network, or credential action.

Product implication:

- describe BashGuard as an in-process command guard and flight recorder
- make capture limits visible
- consider a separate boundary only after users demonstrate the need

### Confirmed user pain is narrow but relevant

Primary-source evidence currently supports these Pi-specific pain points:

- the approved command may not reveal all execution prefixes or mutations
- project-controlled configuration can weaken trust in what executes
- conversation branching does not automatically restore filesystem state
- developers want rewind, checkpoints, diff previews, and safer restore flows
- unfamiliar repositories create additional execution risk

The available evidence does not yet justify a claim of broad or dominant demand.

### Basic command approval is already partially solved

Community Pi extensions and examples already cover pieces such as:

- dangerous-command approval
- protected paths
- sensitive-output filtering
- dirty-repository guards
- Git checkpointing
- rewind-style restoration

Therefore, BashGuard should not differentiate on a denylist, confirmation dialog, redaction filter, or checkpoint command by itself.

## UX Comparison

### Pi Native Experience

Pi provides the session tree, tool execution, branching, export, and extension UI surface.

Strength:

- integrated terminal workflow
- local sessions
- flexible extension model

Gap relative to the BashGuard vision:

- no first-class resolved-command approval experience
- no unified prompt-to-filesystem timeline
- no built-in explanation layer connecting risk, command context, and recovery

### Small Pi Security Extensions

Typical experience:

```text
Dangerous command detected.
Allow? [y/N]
```

Strength:

- low setup
- immediate safety value

Gap:

- little or no causal timeline
- limited repository impact context
- basic approval is easy to copy
- recovery and debugging are usually separate workflows

### Enterprise Governance Toolkits

Typical experience:

```text
Policy violation
Rule: destructive-command
Decision: deny
Event ID: ...
```

Strength:

- broad policy and audit capabilities
- identity, control-plane, and compliance support

Gap:

- designed for platform or security teams
- heavy configuration
- not embedded in a Pi coding session
- audit logs are not the same as a developer-friendly replay

### MCP Gateways

Typical experience:

- configure a proxy or gateway
- inspect, authenticate, filter, or approve MCP traffic
- review gateway logs or dashboards

Strength:

- strong mediation point for MCP tools

Gap:

- does not cover the full local Pi shell and repository workflow
- protocol events do not automatically explain file impact
- not the right MVP layer for BashGuard

### Git and Manual Checkpoints

Typical experience:

- inspect `git status` or `git diff`
- create commits, branches, worktrees, or stashes
- manually relate changes back to the agent conversation

Strength:

- trusted and mature recovery mechanism

Gap:

- no automatic causal link to prompts, tool calls, or approvals
- recovery context is fragmented across Pi and Git

## Competitive Classification

### Direct competitors

No verified project currently provides the complete Pi-native experience proposed for BashGuard.

The closest direct substitutes are combinations of small Pi extensions for approval, protected paths, filtering, checkpoints, and rewind.

### Partial competitors

#### Project CodeGuard

Provides rules, skills, validators, translators, and an MCP server for securing agent-driven development.

Relevant overlap:

- repository-focused security rules
- agent-facing guidance and validation

Limitation relative to BashGuard:

- not centered on Pi session provenance or developer-facing execution replay

#### SentinelMCP

Appears to inspect, redact, approve, and audit MCP tool calls.

Relevant overlap:

- interception
- redaction
- approvals
- auditing

Limitation:

- insufficient evidence of a Pi-native terminal experience or prompt-to-file replay

#### Agent Approve

Positioned around human approval of agent actions.

Limitation:

- public technical evidence remains too limited for a reliable comparison

### Adjacent infrastructure

#### Microsoft Agent Governance Toolkit

The strongest adjacent open-source governance competitor. It covers policy enforcement, identity, approvals, audit, sandboxing, MCP governance, and tamper-evident records.

What it proves:

- BashGuard cannot credibly claim to invent agent governance or tamper-evident audit

Why it is not the same product:

- it targets agent-system builders and enterprise operators rather than the local developer experience inside Pi

#### agentgateway, Lasso MCP Gateway, and Obot MCP Gateway

Govern traffic between agents, models, tools, and MCP servers.

They matter only if BashGuard later expands into MCP mediation. They are not direct competitors to the Pi-first MVP.

#### Snyk, GitHub Advanced Security, Sysdig, Straiker, and Cisco

Cover AI-generated code scanning, repository security, runtime detection, or enterprise agent security.

They may identify insecure outputs or dangerous behavior, but they do not provide the same local session-oriented Pi workflow.

### Substitutes

- Pi's native sessions, tree navigation, fork, clone, export, and JSONL storage
- Git commits, stashes, worktrees, and manual checkpoints
- development containers and sandboxes
- project instruction files
- small Pi approval, filtering, checkpoint, and rewind extensions
- general policy engines such as OPA, Cedar, and Conftest
- secret scanners such as Gitleaks and TruffleHog

## What BashGuard Should Not Rebuild

- Pi's session storage or conversation-tree browser
- a general-purpose policy language
- repository secret scanning
- static application-security scanning
- container or operating-system sandboxing
- MCP authentication and gateway infrastructure
- a custom source-control system
- a generic confirmation dialog
- a separate web dashboard before the terminal UX is validated
- a Rust daemon before an external boundary is required

## Underserved UX

### Resolved Command Visibility

The approval experience should show the materially relevant command that will execute, including prefixes, wrappers, working directory, and targeted paths where observable.

This is stronger than presenting the raw tool argument alone.

### Prompt-to-Effect Timeline

Pi contains many of the underlying events, but does not currently present a first-class developer view connecting intent, action, result, and repository impact.

This is the clearest product opportunity.

### Explainable Decisions

A developer should see:

- why the action matters
- which condition matched
- what can be affected
- whether the system is certain
- what safer option is available

A severity badge or binary approval prompt is insufficient.

### Repository-Linked Recovery

Pi session history and Git recovery are separate experiences. BashGuard can join them without replacing either system.

### Honest Capture Completeness

No competitor evidence reviewed showed a developer-first UI that explicitly communicates which causal links were captured, inferred, redacted, or missed.

This can become an important trust feature.

## Recommended MVP

1. **Resolved command preview**  
   Show the command, working directory, prefixes, wrappers, target paths, and relevant redacted context before risky execution.

2. **Explainable command decisions**  
   Use a small built-in rule set and provide plain-language outcomes and safer alternatives.

3. **Execution timeline**  
   Connect Pi prompts or turns, tool calls, commands, results, and file changes.

4. **Git-backed recovery context**  
   Associate actions with diffs and optional checkpoints, then provide reviewable restore guidance.

5. **Pi-native terminal UX**  
   Keep the summary, timeline, approvals, and inspector inside Pi for the first release.

## Positioning Options

### Pi Security Extension

**Job:** Prevent dangerous commands and data exposure.  
**Risk:** Existing community extensions cover the basic version.  
**Assessment:** Too narrow as the primary category.

### Pi Observability and Session Recorder

**Job:** Help developers understand what Pi did and why.  
**Differentiator:** Prompt-to-action-to-file timeline.  
**Risk:** Users may consider Pi sessions and Git sufficient.  
**Assessment:** Best initial adoption wedge.

### Pi Execution-Governance Companion

**Job:** Observe, explain, approve, record, and eventually enforce Pi actions.  
**Differentiator:** Combines developer observability with narrow governance.  
**Risk:** Can become enterprise-heavy too early.  
**Assessment:** Best long-term direction after the recorder proves useful.

## Recommended Position

BashGuard should launch as:

> **The local flight recorder and explainable command guard for Pi.**

The initial adoption wedge is developer observability. Governance should grow from the evidence BashGuard records rather than define the first release.

## Evidence That Would Invalidate the Project

Reconsider BashGuard if:

- Pi ships a first-party resolved-command preview with explanations
- Pi ships a unified prompt, tool, command, diff, and repository-state timeline
- an established Pi extension provides this integrated experience with meaningful adoption
- Pi users consistently find native sessions plus Git sufficient
- Pi hooks cannot reliably associate commands and results
- file-impact correlation is too inaccurate to be useful
- recording or approvals create unacceptable friction

## Open Research Questions

- How frequently do Pi users experience surprising or unsafe command execution?
- Which Pi events provide stable correlation identifiers in practice?
- How accurately can BashGuard detect file impact without intrusive snapshots?
- Which command transformations remain invisible until shell runtime?
- Which capture modes give useful context without exposing secrets?
- Do developers prefer a terminal timeline, exported report, or optional browser view after the MVP?

## Primary Sources

- Pi repository: https://github.com/earendil-works/pi
- Pi extension documentation: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
- Pi session documentation: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md
- Pi quickstart and permissions model: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/quickstart.md
- Pi discussions: https://github.com/earendil-works/pi/discussions
- Pi extension discussion and community examples: https://github.com/earendil-works/pi/discussions/3373
- Microsoft Agent Governance Toolkit: https://github.com/microsoft/agent-governance-toolkit
- Project CodeGuard: https://github.com/cosai-oasis/project-codeguard
- agentgateway: https://github.com/agentgateway/agentgateway

## Confidence

**High confidence:** Pi can support a TypeScript extension MVP; Pi is not an OS security boundary; basic approval and checkpoint features already exist in community extensions.  
**Medium confidence:** A prompt-to-effect timeline and resolved-command UX remain underserved.  
**Low confidence:** Market size and the recurrence of user pain. More primary-user validation is required.