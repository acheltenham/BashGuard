# BashGuard Competitive Analysis

**Status:** Working draft v0.3  
**Last updated:** July 23, 2026  
**Scope:** Pi-first competitive, substitute, and UX analysis

## Executive Summary

The market is not empty. Agent governance, MCP security, sandboxing, secret scanning, policy engines, AI-code security, and coding-agent approval extensions are active categories.

Most products are designed for enterprise operators, security teams, or infrastructure gateways. Their primary interfaces are policy files, alerts, audit logs, dashboards, and approval queues.

BashGuard's opportunity is different:

> Build the local terminal companion, flight recorder, and explainable command guard for a developer using Pi.

The primary experience is not another browser dashboard or a larger approval prompt. It is a second terminal that can attach to a Pi session, narrate meaningful activity, investigate prompt-to-effect relationships, replay recorded events, and connect unexpected changes to Git recovery.

Pi itself is the most important substitute and the platform BashGuard should extend. Pi already provides TypeScript extensions, lifecycle events, tool interception, terminal UI, project-local configuration, and local session storage. BashGuard should not recreate those systems behind a cloud platform or heavy service.

The defensible gap is the user experience that connects:

```text
live activity
  -> prompt
  -> tool request
  -> resolved command
  -> decision
  -> result
  -> file change
  -> Git checkpoint
  -> debrief and recovery
```

## Validated Findings

### Pi can support the capture and guard portions of the MVP

Pi exposes enough extension surface to prototype command interception, event capture, approvals, custom terminal UI, and session-associated state in TypeScript.

Product implication:

- no cloud control plane for the MVP;
- no cross-harness abstraction for the MVP;
- no hosted React dashboard for the MVP;
- no OS boundary claims;
- prove the smallest local transport needed for a second terminal to attach.

### The separate terminal companion is a product hypothesis

The new direction assumes developers will value keeping Pi in one terminal and a calm BashGuard companion in another.

This is plausible because it fits existing terminal, split-pane, and tmux workflows, but it must be validated.

Key questions:

- Will developers keep the companion visible?
- Is narration more useful than another log stream?
- Can session discovery and attachment remain nearly frictionless?
- Does a separate process improve understanding enough to justify its existence?
- Can the implementation avoid a heavy daemon or service?

### Pi is not an operating-system security boundary

A Pi extension runs in process and with the permissions of the user who launched Pi. BashGuard can govern supported Pi execution flows, but it cannot claim to sandbox a compromised process or observe every out-of-band filesystem, process, network, or credential action.

Product implication:

- describe BashGuard as an in-process command guard and flight recorder;
- make capture limits visible;
- treat the terminal companion as an observability surface, not a stronger isolation boundary;
- consider a separate boundary only after users demonstrate the need.

### Confirmed user pain is narrow but relevant

Primary-source evidence currently supports these Pi-specific pain points:

- the approved command may not reveal all execution prefixes or mutations;
- project-controlled configuration can weaken trust in what executes;
- conversation branching does not automatically restore filesystem state;
- developers want rewind, checkpoints, diff previews, and safer restore flows;
- unfamiliar repositories create additional execution risk.

The available evidence does not yet justify a claim of broad or dominant demand.

### Basic command approval is already partially solved

Community Pi extensions and examples already cover pieces such as:

- dangerous-command approval;
- protected paths;
- sensitive-output filtering;
- dirty-repository guards;
- Git checkpointing;
- rewind-style restoration.

Therefore, BashGuard should not differentiate on a denylist, confirmation dialog, redaction filter, or checkpoint command by itself.

## UX Comparison

### Pi Native Experience

Pi provides the conversation, tool execution, session tree, branching, export, and extension UI surface.

Strengths:

- integrated terminal workflow;
- local sessions;
- flexible extension model;
- no separate product required.

Gap relative to the BashGuard vision:

- no first-class attached terminal companion focused on execution understanding;
- no unified live prompt-to-filesystem narrative;
- no resolved-command explanation layer connecting risk, command context, and recovery;
- no evidence-based session debrief designed for quick review.

### Small Pi Security Extensions

Typical experience:

```text
Dangerous command detected.
Allow? [y/N]
```

Strengths:

- low setup;
- immediate safety value;
- focused scope.

Gaps:

- little or no live execution narrative;
- limited causal timeline;
- limited repository impact context;
- basic approval is easy to copy;
- recovery and debugging remain separate workflows.

### Enterprise Governance Toolkits

Typical experience:

```text
Policy violation
Rule: destructive-command
Decision: deny
Event ID: ...
```

Strengths:

- broad policy and audit capabilities;
- identity, control-plane, compliance, and team support.

Gaps:

- designed for platform or security teams;
- heavy configuration;
- not embedded in a local Pi development workflow;
- audit logs are not the same as a calm developer-facing live companion;
- dashboards and queues add context switching.

### MCP Gateways

Typical experience:

- configure a proxy or gateway;
- inspect, authenticate, filter, or approve MCP traffic;
- review gateway logs or dashboards.

Strengths:

- strong mediation point for MCP tools.

Gaps:

- does not cover the full local Pi shell and repository workflow;
- protocol events do not automatically explain file impact;
- not the right MVP layer for a Pi session companion.

### Git and Manual Checkpoints

Typical experience:

- inspect `git status` or `git diff`;
- create commits, branches, worktrees, or stashes;
- manually relate changes back to the agent conversation.

Strengths:

- trusted and mature recovery mechanism.

Gaps:

- no automatic causal link to prompts, tool calls, approvals, or command results;
- recovery context is fragmented across Pi, shell output, and Git.

### Terminal Monitoring Tools

Tools such as `htop`, `lazygit`, log tailers, and terminal multiplexers establish familiar interaction patterns:

- persistent second-pane visibility;
- keyboard-first navigation;
- live status plus drill-down;
- low context switching.

They are not direct competitors, but they are important UX substitutes. BashGuard must be as glanceable and useful as these tools or developers will close it.

## Competitive Classification

### Direct competitors

No verified project currently provides the complete Pi-native experience proposed for BashGuard:

- attach to a Pi session from a separate terminal;
- narrate meaningful execution live;
- expose resolved command context;
- connect prompts, tools, commands, results, files, and Git state;
- replay recorded events;
- provide evidence-based debrief and recovery.

The closest substitutes are combinations of Pi's native session experience, small security extensions, shell output, and Git tools.

### Partial competitors

#### Project CodeGuard

Provides rules, skills, validators, translators, and an MCP server for securing agent-driven development.

Relevant overlap:

- repository-focused security rules;
- agent-facing guidance and validation.

Limitation relative to BashGuard:

- not centered on Pi session attachment, live narration, or developer-facing execution replay.

#### SentinelMCP

Appears to inspect, redact, approve, and audit MCP tool calls.

Relevant overlap:

- interception;
- redaction;
- approvals;
- auditing.

Limitation:

- insufficient evidence of a Pi-native terminal companion or prompt-to-file replay.

#### Agent Approve

Positioned around human approval of agent actions.

Limitation:

- public technical evidence remains too limited for a reliable comparison;
- approval alone does not provide the broader execution-understanding experience.

### Adjacent infrastructure

#### Microsoft Agent Governance Toolkit

A strong adjacent open-source governance competitor covering policy enforcement, identity, approvals, audit, sandboxing, MCP governance, and tamper-evident records.

What it proves:

- BashGuard cannot credibly claim to invent agent governance or tamper-evident audit.

Why it is not the same product:

- it targets agent-system builders and enterprise operators rather than the local developer experience attached to a Pi session.

#### agentgateway, Lasso MCP Gateway, and Obot MCP Gateway

Govern traffic between agents, models, tools, and MCP servers.

They matter only if BashGuard later expands into MCP mediation. They are not direct competitors to the Pi-first terminal companion.

#### Snyk, GitHub Advanced Security, Sysdig, Straiker, and Cisco

Cover AI-generated code scanning, repository security, runtime detection, or enterprise agent security.

They may identify insecure outputs or dangerous behavior, but they do not provide the same local session-oriented Pi workflow.

### Substitutes

- Pi's native sessions, tree navigation, fork, clone, export, and JSONL storage;
- Git commits, stashes, worktrees, and manual checkpoints;
- terminal split panes, tmux, and shell log tailing;
- development containers and sandboxes;
- project instruction files;
- small Pi approval, filtering, checkpoint, and rewind extensions;
- general policy engines such as OPA, Cedar, and Conftest;
- secret scanners such as Gitleaks and TruffleHog.

## What BashGuard Should Not Rebuild

- Pi's conversation or session-tree browser;
- a general-purpose policy language;
- repository secret scanning;
- static application-security scanning;
- container or operating-system sandboxing;
- MCP authentication and gateway infrastructure;
- a custom source-control system;
- a generic confirmation dialog;
- a hosted web dashboard before the terminal UX is validated;
- a heavy daemon before local file transport proves insufficient;
- hidden chain-of-thought replay;
- an unexplained trust score.

## Underserved UX

### Live Session Narration

Developers can see tool output in Pi, but there is no dedicated, glanceable view that groups execution into a calm story while preserving the underlying evidence.

This is the new primary product hypothesis.

### Frictionless Session Attachment

A companion is only viable if attaching is easy:

```bash
bashguard attach
bashguard attach <pi-session-id>
```

Repository-aware discovery, canonical Pi identity, reconnect, and completed-session access are part of the experience, not implementation details.

### Resolved Command Visibility

The approval experience should show the materially relevant command that will execute, including prefixes, wrappers, working directory, and targeted paths where observable.

This is stronger than presenting the raw tool argument alone.

### Prompt-to-Effect Investigation

Pi contains many underlying events, but does not currently present a first-class developer view connecting intent, action, result, and repository impact.

The key user question is:

> Why did Pi change this file?

### Explainable Decisions

A developer should see:

- why the action matters;
- which condition matched;
- what can be affected;
- how certain BashGuard is;
- what safer option is available.

A severity badge or binary approval prompt is insufficient.

### Event Replay

A developer-friendly replay should reconstruct meaningful recorded events without rerunning commands or pretending to expose hidden reasoning.

This differs from raw logs, exported transcripts, and video playback.

### Evidence-Based Debrief

The session end state should summarize commands, tests, files, approvals, warnings, checkpoints, capture completeness, and items worth reviewing.

The user should receive evidence rather than a synthetic trust score.

### Repository-Linked Recovery

Pi session history and Git recovery are separate experiences. BashGuard can join them without replacing either system.

### Honest Capture Completeness

No competitor evidence reviewed showed a developer-first UI that consistently communicates which causal links were captured, model-reported, inferred, redacted, or missed.

This can become an important trust feature.

## Recommended MVP

1. **Session discovery and attachment**  
   Find active and completed Pi sessions and follow one from a second terminal.

2. **Live terminal narration**  
   Group recorded activity into meaningful, glanceable statements.

3. **Investigation and debrief**  
   Browse the event timeline, inspect evidence, and summarize what is worth reviewing.

4. **Resolved command preview**  
   Show command, working directory, prefixes, wrappers, targets, and relevant redacted context before risky execution.

5. **Explainable command decisions**  
   Use a small built-in rule set and provide plain-language outcomes and safer alternatives.

6. **Git-backed file impact and recovery**  
   Associate actions with diffs and optional checkpoints, then provide reviewable restore guidance.

7. **Event replay**  
   Step through the recorded execution story without rerunning actions.

## Positioning Options

### Pi Security Extension

**Job:** Prevent dangerous commands and data exposure.  
**Risk:** Existing community extensions cover the basic version.  
**Assessment:** Too narrow as the primary category.

### Pi Observability and Session Recorder

**Job:** Help developers understand what Pi is doing and why.  
**Differentiator:** Attached terminal narration plus prompt-to-effect investigation.  
**Risk:** Users may consider Pi sessions, shell output, and Git sufficient.  
**Assessment:** Best initial adoption wedge.

### Pi Terminal Companion

**Job:** Give developers a persistent second-pane view for live understanding, investigation, replay, and recovery.  
**Differentiator:** Fits existing terminal workflows and separates acting from understanding.  
**Risk:** The companion could become a noisy log window or require too much setup.  
**Assessment:** Best UX framing if attach and narration are executed well.

### Pi Execution-Governance Companion

**Job:** Observe, explain, approve, record, and eventually enforce Pi actions.  
**Differentiator:** Combines developer observability with narrow governance.  
**Risk:** Can become enterprise-heavy too early.  
**Assessment:** Best long-term direction after the recorder proves useful.

## Recommended Position

BashGuard should launch as:

> **The local terminal companion, flight recorder, and explainable command guard for Pi.**

The initial adoption wedge is live developer observability. Governance should grow from the evidence BashGuard records rather than define the first release.

## Evidence That Would Invalidate the Project

Reconsider BashGuard if:

- Pi ships a first-party attached terminal companion with equivalent execution narration;
- Pi ships a unified prompt, tool, command, diff, repository-state, and recovery timeline;
- an established Pi extension provides the integrated experience with meaningful adoption;
- Pi users consistently find native sessions, shell output, and Git sufficient;
- users do not keep or revisit the BashGuard terminal;
- narration is consistently perceived as noise;
- Pi hooks cannot reliably associate commands and results;
- local session attachment requires a heavy service that undermines the product;
- file-impact correlation is too inaccurate to be useful;
- recording or approvals create unacceptable friction.

## Open Research Questions

- How frequently do Pi users experience surprising or unsafe execution?
- Will users keep a BashGuard terminal open during normal work?
- What level of narration is useful without becoming noise?
- Which Pi events provide stable correlation identifiers in practice?
- How should the companion discover active sessions across repositories?
- Can append-only files provide reliable live transport and reconnect behavior?
- How accurately can BashGuard detect file impact without intrusive snapshots?
- Which command transformations remain invisible until shell runtime?
- Which capture modes give useful context without exposing secrets?
- Do users value event replay after failed or surprising sessions?
- Do developers prefer two-pane terminal inspection over an optional browser view?

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

**High confidence:** Pi can support a TypeScript capture and command-guard MVP; Pi is not an OS security boundary; basic approval and checkpoint features already exist.  
**Medium confidence:** Resolved-command visibility, prompt-to-effect investigation, and evidence-based debrief remain underserved.  
**Low confidence:** Developers will keep a separate BashGuard terminal visible and value live narration enough to form a durable habit. This is the first product hypothesis to validate.