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
