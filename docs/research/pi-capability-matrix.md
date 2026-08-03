# Pi Capability Matrix

**Status:** Working document  
**Last updated:** August 3, 2026

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

| Area | Capability | Why BashGuard Needs It | Status | Evidence / Remaining Proof |
|---|---|---|---|---|
| Session lifecycle | Detect session start and end | Create bounded BashGuard session records | Confirmed | Pi 0.80.6 produced `session.started` and `session.shutdown` in the local spike |
| Session identity | Read stable Pi session ID | Use Pi session ID as canonical BashGuard identity | Confirmed | Stable ID observed across the tested session and matched BashGuard output directory |
| Session discovery | Find active and recent sessions | Support `bashguard sessions` and `attach` | Confirmed | PR #5 discovered active and completed JSONL sessions from a separate process without terminal scraping |
| Prompt correlation | Associate a prompt or turn with later actions | Explain what initiated a command or edit | Partial | `turnIndex` and timestamps observed; no explicit turn ID in tested payload |
| Tool interception | Observe tool calls before execution | Preview and evaluate shell actions | Confirmed | `tool.requested` captured name, input, and `toolCallId` |
| Tool results | Observe completion, result, and error metadata | Complete the action story | Confirmed | `tool.completed` correlated deterministically by `toolCallId` |
| User bash | Observe or wrap direct user shell execution | Avoid blind spots between agent and user commands | Confirmed | Interactive `!` commands produced `bash.user_requested` with `payload.command` and `payload.excludeFromContext`; distinct from agent `bash` tool events |
| Command mutation | Block or modify a command before execution | Implement narrow safeguards and safer alternatives | Documented | Verify mutation semantics and approval UI later |
| Resolved command | Observe the materially executed command | Avoid approving one command while another runs | Partial | Raw agent `bash` input is visible; wrappers, expansion, aliases, and runtime mutation still need dedicated testing |
| Working directory | Capture effective command directory | Explain command scope and targeted repository | Confirmed | `ctx.cwd` recorded consistently in tested session |
| Environment context | Observe relevant environment metadata | Explain hidden execution context without exposing secrets | Partial | Define which context is necessary and safe to persist |
| File reads | Observe file-read tools | Narrate repository exploration | Confirmed | `read` observed as correlated tool request/result events |
| File writes | Observe file-edit/write tools | Connect actions to modified files | Confirmed | `write` confirmed in earlier spike; targeted `edit` test on Aug 3, 2026 captured correlated request/result events with path, edit blocks, diff, patch, and `firstChangedLine` |
| Out-of-band changes | Detect file changes caused by shell commands | Correlate command execution with repository impact | Unknown | Compare Git state before and after controlled command windows |
| Git context | Read repository root, branch, and dirty state | Provide file-impact and recovery context | External capability | Prove reliable Git queries with timeouts and non-repo fallback |
| Extension state | Persist BashGuard metadata in Pi sessions | Keep event correlation close to Pi data | Documented | Current spike uses independent JSONL; extension-entry semantics still need evaluation |
| Local event transport | Tail new events from a second process | Power the live companion without a daemon | Confirmed | PR #5 tailed append-only JSONL live from a second process and replayed completed sessions; no daemon required |
| Session storage path | Locate Pi session files locally | Support active and completed session browsing | Documented | Validate platform paths and project-specific directories during attach spike |
| Custom UI | Render approval and explanation views inside Pi | Keep decisions in the active Pi terminal | Documented | Build minimal interaction after capture/attach foundation |
| TUI components | Build a rich companion terminal | Provide timeline and event inspection | External capability | Select/prove Node terminal UI approach |
| Status/footer | Show quiet recording state | Communicate capture health without noise | Confirmed | Spike successfully displays BashGuard recording status in interactive mode |
| Performance | Add capture with low overhead | Avoid making Pi feel slower | Unknown | Measure event latency, write overhead, and memory use |
| Failure isolation | Allow Pi to continue if BashGuard fails | Preserve the developer workflow | Confirmed | Invalid data directory surfaced extension errors while Pi still exited successfully in smoke test |
| Secret redaction | Remove likely secrets before persistence | Keep local records safer to inspect and share | Partial | Key matching implemented; false-positive on `totalTokens` found and fixed; value-based secret detection remains future work |
| Capture completeness | Mark missing or uncertain links | Avoid inventing provenance | Partial | Event envelope supports `capture.missing`, `capture.redacted`, and `capture.truncated`; CLI inspect/debrief surface these fields. `capture.gap` timeline events are supported and recorder write failures attempt a best-effort gap event, but total storage failure can still only be surfaced through Pi UI notification. |

## Spike 1 Results: Lifecycle and Correlation

Tested locally against Pi `0.80.6` using PR #4.

A controlled session produced 35 normalized JSONL events and confirmed the core recorder path.

Observed event sequence included:

- `session.started`
- `agent.before_start`
- `agent.started`
- `turn.started` / `turn.ended`
- `message.started` / `message.ended`
- `tool.requested` / `tool.completed` for `read`, `bash`, and `write`
- `bash.user_requested` for direct interactive `!` shell commands
- `agent.ended`
- `session.shutdown`

### Correlation findings

- Pi session identity remained stable for the full tested session.
- `toolCallId` provides a deterministic request/result correlation key.
- Turn payloads exposed `turnIndex` and timestamp but no explicit turn ID in this test.
- Message payloads contained assistant tool-call IDs but no explicit top-level message ID in this test.
- Agent shell execution is distinguishable as the `bash` tool.
- Direct interactive user shell execution is distinguishable as `bash.user_requested`.
- Confirmed interactive examples included `pwd` and `curl google.com` with `payload.command` and `payload.excludeFromContext: false`.
- File reads, writes, and edits are directly visible as Pi tool events.
- Targeted `edit` capture confirmed `tool.requested` and `tool.completed` with matching `toolCallId`, `input.path`, edit blocks, result text, `details.diff`, `details.patch`, and `details.firstChangedLine`.

### Failure and privacy findings

- A recorder storage failure did not make Pi unusable, which validates the desired failure-isolation direction.
- Recorder write failures now attempt to record explicit `capture.gap` events; total stream unavailability falls back to Pi UI notification.
- Initial secret-key matching was too broad and incorrectly redacted `totalTokens`. The spike now uses exact normalized secret-key matching instead of substring matching.
- Capture metadata is now represented as `capture.missing`, `capture.redacted`, and `capture.truncated` on events and is visible in CLI inspection/debrief output.
- Redaction notices mean values were intentionally hidden before persistence. Inspection should show redacted payload paths so users know what kind of evidence was withheld without exposing the secret value.
- Truncation notices mean very large values were shortened before persistence. This is expected for large edits, diffs, patches, or command output; inspection shows the truncated payload paths so the user knows which evidence is partial.
- Capture-gap events (`capture.gap`) represent degraded recorder behavior such as failed event persistence. They include failed event type, tool name, tool-call ID, and command/path context when available. If the event stream itself is unavailable, BashGuard can only notify inside Pi rather than recording the gap.

## Required Spikes

### Spike 1: Lifecycle and Correlation

**Status: Complete for the Milestone 0 foundation.**

Confirmed lifecycle, prompt, turn, message, tool, user-bash, edit-tool, and shutdown capture against real Pi 0.80.6 sessions.

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

**Status: Complete for the Milestone 0 foundation.**

PR #5 proved that a second process can:

- discover an active session;
- identify its repository and state;
- tail new BashGuard events;
- render grounded live narration;
- avoid duplicate events within an attach invocation using event sequence numbers;
- mark a session complete after `session.shutdown`;
- open and render a completed session later by full ID or unique prefix.

Remaining hardening work:

- verify two simultaneous interactive Pi sessions;
- persist attach cursors only if later UX requires independent-invocation resume.

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
