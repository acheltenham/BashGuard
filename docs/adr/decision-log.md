# BashGuard Decision Log

This log records product-level decisions. Detailed technical decisions should use Architecture Decision Records in this directory.

## Decision 001: Focus on Pi for the MVP

**Status:** Accepted  
**Date:** July 22, 2026

### Decision

BashGuard will focus deeply on Pi for the MVP instead of supporting multiple agent harnesses.

### Rationale

Pi's openness and extensibility create a clear need for a companion security, governance, and observability layer. Other harnesses are commonly tied to vendors that provide their own safeguards.

A narrow focus allows BashGuard to provide a stronger product experience and avoid premature abstraction.

### Consequences

- The MVP will include a first-party Pi extension.
- Product requirements and user journeys will be designed around Pi.
- Other harnesses are explicitly deferred.
- The architecture may retain clean internal boundaries, but will not introduce a generic harness framework without a demonstrated need.

## Decision 002: Observe Before Enforcing

**Status:** Accepted  
**Date:** July 22, 2026

### Decision

BashGuard will begin with visibility and observation before encouraging stricter guardrail enforcement.

### Rationale

Developers need to understand agent behaviour before they can write useful controls. Starting with blocking would create friction and increase false positives.

## Decision 003: Execution Provenance Is First-Class

**Status:** Accepted  
**Date:** July 22, 2026

### Decision

BashGuard will connect human intent, Pi sessions, tool calls, commands, repository context, policy decisions, and results as a first-class product concept.

### Rationale

Command history alone cannot explain why an action occurred or what it affected.

## Decision 004: GitHub Is the Canonical Documentation Source

**Status:** Accepted  
**Date:** July 22, 2026

### Decision

The BashGuard repository will be the source of truth for product and technical documentation.

### Rationale

Markdown in Git provides version history, reviewable changes, stable references, and a natural path for future contributors.

## Decision 005: Own Authorization and Observability, Delegate Containment

**Status:** Accepted  
**Date:** August 22, 2026

### Decision

BashGuard will own the authorization and observability controls and will delegate containment and network policy to external sandbox backends. It will integrate with those backends through a narrow, two-method `SandboxAdapter` that describes and observes, and it will not execute or orchestrate through them.

```text
SandboxAdapter
  describe()   → the boundary in force
  observe()    → decisions, where the backend exposes them
```

### Rationale

["Your agent can run code — what can that code reach?"](https://cheltenham.dev/research/your-agent-can-run-code-what-can-that-code-reach) separates agent security into independent controls — authorization, containment, network policy, downstream authorization, and observability — rather than one thing called "sandboxing". Its framing, **"authorization is not containment"**, distinguishes two questions BashGuard had been treating as one.

BashGuard already ships the observability control and, through Pi's blocking `tool_call` hook, can own authorization. Containment requires operating-system enforcement that BashGuard must not reimplement; Pi's own security documentation states that real isolation has to come from the OS, a VM, or a container.

An earlier draft of issue #79 proposed an `EnforcementAdapter` including `execute()` and `escalate()`. Those methods would put BashGuard on the execution path, making it a sandbox orchestrator that must track each backend's execution model, and implicitly claiming to be a single sufficient mechanism. Describing and observing keeps BashGuard in the role it is good at and leaves enforcement where it belongs.

### Consequences

- Pi executes, the backend enforces, BashGuard describes and reports.
- BashGuard must distinguish a boundary **reported** from configuration from one **observed** in recorded events, and must never present the former as active.
- BashGuard runs inside whatever boundary exists, so it cannot prove the absence of an outer container or VM. The no-backend case reports "no containment boundary detected", never "none exists".
- Two adapter implementations ship initially — no backend, and the first-party Anthropic sandbox runtime path. Further backends require demonstrated demand rather than anticipated breadth.
- BashGuard must remain explicit about which controls are enforced by a backend versus only observed or evaluated by BashGuard.
- No policy language is introduced until an integration proves what a backend supports cleanly.

### Supersedes

Extends [Decision 002](#decision-002-observe-before-enforcing). Observation remains first, and enforcement — when it arrives — is authorization at the tool-call boundary, not containment.
