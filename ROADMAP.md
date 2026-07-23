# BashGuard Roadmap

**Status:** Draft v0.2  
**Last updated:** July 22, 2026

## Phase 0: Product Foundation

- align README, manifesto, PRD, architecture, and competitive analysis
- define the Pi-first MVP
- document UI principles and terminal workflows
- identify the minimum Pi hooks required for event correlation
- prototype command resolution and Git-state capture

Exit criteria:

- the product story is consistent
- the MVP contains no daemon, cloud, or multi-harness requirements
- the core technical assumptions are proven with small Pi extension experiments

## Phase 1: Developer Flight Recorder

Goal: make a Pi session understandable after it happens.

- Pi TypeScript extension skeleton
- session lifecycle capture
- tool-call and tool-result capture
- shell command capture
- local normalized event model
- session summary
- terminal timeline browser
- event detail inspector
- capture completeness indicators

Exit criteria:

- a developer can inspect a session and trace most shell actions to a Pi turn or tool call
- timeline gaps are visible rather than hidden

## Phase 2: Resolved Command Guard

Goal: make risky execution understandable before it happens.

- resolved command preview
- working-directory and project-root context
- prefix and wrapper visibility
- small built-in risk rule set
- allow, notice, approval, and block outcomes
- plain-language explanations
- safer alternatives where useful
- secret-aware display and persistence

Exit criteria:

- risky commands show the materially relevant command and context before approval
- every interrupted action includes a useful explanation
- common safe workflows are not burdened by excessive prompts

## Phase 3: Git Checkpoints and File Impact

Goal: connect agent execution to the repository changes it caused.

- repository and branch detection
- before-and-after Git status capture
- changed-file summaries
- diff summaries
- optional pre-risk checkpoints
- checkpoint references in the timeline
- restore guidance

Exit criteria:

- a developer can identify the files affected by a session
- a developer can locate a relevant Git recovery point after a mistaken action

## Phase 4: Repository Intelligence

Goal: improve explanations and risk context without introducing speculative complexity.

- protected-path configuration
- instruction-file discovery
- repository-local BashGuard settings
- branch and environment awareness
- framework-specific risk hints where evidence supports them
- improved file-impact visualization

Exit criteria:

- BashGuard can distinguish common repository-specific risks using explicit local signals

## Phase 5: Advanced Observability

Only after the core workflow proves useful:

- session comparison
- repository activity heatmaps
- richer filtering and search
- optional local index or SQLite storage
- exportable incident or debugging reports
- rule testing against recorded events
- user-reviewed recommendations

## Phase 6: Optional Stronger Boundaries

Evaluate only when the in-process extension is demonstrably insufficient:

- optional local execution broker or daemon
- filesystem and network restrictions
- stronger tamper resistance
- process observation beyond Pi hooks
- additional coding-harness adapters
- team sharing and centralized governance

## Explicitly Not Planned for the MVP

- Rust daemon
- browser dashboard
- cloud service
- accounts and billing
- enterprise control plane
- SIEM integrations
- multi-harness support
- general-purpose policy language
- autonomous policy changes
- custom filesystem rollback engine