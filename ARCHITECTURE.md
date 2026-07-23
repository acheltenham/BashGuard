# BashGuard Architecture

**Status:** Placeholder  
**Last updated:** July 22, 2026

This document will define the architecture for BashGuard's Pi extension, local service, storage, dashboard, policy engine, repository intelligence, and event model.

## Initial Direction

```text
Pi
  |
  v
Pi Extension (TypeScript)
  |
  v
Local BashGuard Service (Rust)
  |-- Session and event ingestion
  |-- Bash execution guard
  |-- Guardrail engine
  |-- Repository intelligence
  |-- Recommendation engine
  |-- Local API and event stream
  |
  +--> SQLite
  |
  +--> Local Dashboard (TypeScript / React)
```

Detailed architecture will be developed after the competitive analysis and product requirements review.
