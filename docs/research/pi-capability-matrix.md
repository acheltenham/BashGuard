# Pi Capability Matrix

**Status:** Working document  
**Last updated:** July 23, 2026

## Purpose

This document defines what BashGuard must prove about Pi before the first implementation milestone is considered technically grounded.

The goal is not to document every Pi feature. The goal is to identify the exact extension, session, storage, and terminal capabilities BashGuard depends on, then record whether each capability is confirmed, partially confirmed, or still unknown.

## Status Legend

- **Confirmed** — documented and demonstrated in a working spike.
- **Documented** — supported by Pi documentation but not yet proven in BashGuard.
- **Partial** — available with important limitations.
- **Unknown** — requires investigation.
- **Unsupported** — Pi does not expose the required capability.

## Capability Matrix

| Area | Capability | Why BashGuard Needs It | Initial Status | Proof Required |
|---|---|---|---|---|
| Session lifecycle | Detect session start and end | Create bounded BashGuard session records | Documented | Capture a real session start/end pair |
| Session identity | Read stable Pi session ID | Use Pi session ID as canonical BashGuard identity | Documented | Confirm stability across event hooks and stored session data |
| Session discovery | Find active and recent sessions | Support `bashguard sessions` and `attach` | Unknown | Discover sessions from a separate process without terminal scraping |
| Prompt correlation | Associate a prompt or turn with later actions | Explain what initiated a command or edit | Partial | Identify stable prompt/turn identifiers and known gaps |
| Tool interception | Observe tool calls before execution | Preview and evaluate shell actions | Documented | Capture name, arguments, call ID, and session context |
| Tool results | Observe completion, result, and error metadata | Complete the action story | Documented | Confirm result timing, exit status, truncation, and correlation IDs |
| User bash | Observe or wrap direct user shell execution | Avoid blind spots between agent and user commands | Documented | Determine whether direct shell activity is distinguishable from agent activity |
| Command mutation | Block or modify a command before execution | Implement narrow safeguards and safer alternatives | Documented | Verify mutation semantics and what the approval UI can safely display |
| Resolved command | Observe the materially executed command | Avoid approving one command while another runs | Partial | Test prefixes, wrappers, shell expansion, aliases, pipelines, and project hooks |
| Working directory | Capture effective command directory | Explain command scope and targeted repository | Documented | Verify correctness across directory changes and nested projects |
| Environment context | Observe relevant environment metadata | Explain hidden execution context without exposing secrets | Partial | Determine what is observable and define redaction boundaries |
| File reads | Observe file-read tools | Narrate repository exploration | Documented | Confirm path, tool ID, result, and prompt correlation |
| File writes | Observe file-edit/write tools | Connect actions to modified files | Documented | Confirm old/new paths, write type, and result metadata |
| Out-of-band changes | Detect file changes caused by shell commands | Correlate command execution with repository impact | Unknown | Compare Git state before and after controlled command windows |
| Git context | Read repository root, branch, and dirty state | Provide file-impact and recovery context | External capability | Prove reliable Git queries with timeouts and non-repo fallback |
| Extension state | Persist BashGuard metadata in Pi sessions | Keep event correlation close to Pi data | Documented | Measure limits, write semantics, and retrieval from another process |
| Local event transport | Tail new events from a second process | Power the live companion without a daemon | Unknown | Prove append-only JSONL or equivalent with reconnect and partial-write handling |
| Session storage path | Locate Pi session files locally | Support active and completed session browsing | Documented | Confirm platform paths, permissions, and project-specific session directories |
| Custom UI | Render approval and explanation views inside Pi | Keep decisions in the active Pi terminal | Documented | Build a minimal approval component and status indicator |
| TUI components | Build a rich companion terminal | Provide timeline and event inspection | External capability | Select a Node TUI library and prove resize, keyboard, and scroll behavior |
| Status/footer | Show quiet recording state | Communicate capture health without noise | Documented | Display state and degraded-capture messages |
| Performance | Add capture with low overhead | Avoid making Pi feel slower | Unknown | Measure event latency, write overhead, and memory use |
| Failure isolation | Allow Pi to continue if BashGuard fails | Preserve the developer workflow | Unknown | Force storage/UI failures and confirm safe degradation |
| Secret redaction | Remove likely secrets before persistence | Keep local records safer to inspect and share | BashGuard-owned | Define and test redaction order and false-positive handling |
| Capture completeness | Mark missing or uncertain links | Avoid inventing provenance | BashGuard-owned | Produce evidence states for observed, reported, inferred, redacted, and missing data |

## Required Spikes

### Spike 1: Lifecycle and Correlation

Capture one real Pi session containing:

1. a user prompt;
2. a file read;
3. a shell command;
4. a file edit;
5. a tool result;
6. session completion.

Record every identifier Pi exposes and determine which links are deterministic.

### Spike 2: Command Resolution

Test commands involving:

- a simple executable;
- a pipeline;
- chained commands;
- shell prefixes;
- environment loading;
- relative paths;
- directory changes;
- destructive-looking but harmless fixtures.

Document what BashGuard can show before execution and what remains unknowable until runtime.

### Spike 3: Separate-Process Attachment

Prove that a second process can:

- discover an active session;
- identify its repository and state;
- tail new BashGuard events;
- reconnect after closing;
- avoid duplicate events;
- handle an incomplete final JSONL line;
- open a completed session later.

### Spike 4: Pi-Native Interaction

Build one minimal Pi UI interaction that shows:

- requested command;
- available resolved context;
- reason for interruption;
- approve once;
- cancel.

The spike should also mirror the decision into the BashGuard event stream.

### Spike 5: File-Impact Correlation

Run controlled commands that:

- do not change files;
- modify one tracked file;
- create an untracked file;
- modify several files;
- operate outside a Git repository.

Determine which correlations can be observed directly and which require time-window inference.

## Decision Rules

The following decisions should be made from spike evidence:

- Use Pi extension entries when they are sufficient and readable from the companion.
- Use append-only JSONL when a simple independent stream is more reliable.
- Do not add a daemon merely to simplify discovery.
- Do not claim a resolved command is complete when shell/runtime behavior remains unknown.
- Do not block on weakly inferred file-impact relationships.
- Keep approval inside Pi even when the companion mirrors the event.
- Prefer visible degraded capture over silent failure.

## Completion Criteria

This matrix is complete for Milestone 0 when:

- every row required by the vertical slice is marked Confirmed, Partial, or Unsupported;
- each Partial result includes a documented product limitation;
- separate-process attachment works without terminal scraping;
- the event schema can represent every observed lifecycle event;
- performance and failure behavior are measured rather than assumed.
