# Command Resolution Spike Design

**Status:** Approved — implementation in progress
**Date:** August 22, 2026
**Roadmap:** Command Resolution Spike 2
**Tracking:** [Issue #83](https://github.com/acheltenham/BashGuard/issues/83)

## Goal

Establish, with reproducible evidence from real Pi sessions, which command representation BashGuard can observe at each stage between a model tool request and a running process.

The spike must answer:

- What command did the model request?
- What command did BashGuard's `tool_call` handler record?
- How does extension load order affect that evidence?
- Can a later `tool_call` handler mutate what executes after BashGuard records it?
- Can a replacement `bash` tool or `spawnHook` wrap a command after all `tool_call` handlers run?
- Which shell transformations remain unknowable until runtime?

The result is an evidence-backed product contract for later command previews and authorization. It is not a user-facing resolved-command feature.

## Non-goals

This spike does not:

- add `command.requested` or `command.resolved` production events;
- block, approve, or mutate ordinary BashGuard user commands;
- introduce shell parsing as a security boundary;
- integrate the Anthropic sandbox runtime adapter;
- parse sandbox output into inferred decisions;
- persist ambient environment values or raw private session logs;
- change `attach`, `inspect`, `debrief`, `boundary`, or recorder behavior.

## Architecture

The spike lives under `scripts/command-resolution-spike/` and writes every generated artifact beneath a caller-supplied temporary root. Product source and session schemas remain unchanged.

A controlled Pi run loads small probe extensions in deliberate order:

```text
model tool request
  ↓
early tool_call observer
  ↓
BashGuard tool_call recorder
  ↓
mutating tool_call handler
  ↓
late tool_call observer
  ↓
replacement bash tool
  ↓
spawnHook observation and wrapping
  ↓
bash -c
  ↓
runtime fixture records argv, cwd, and approved sentinels
```

Not every scenario uses every stage. Baseline scenarios omit mutation and replacement. Ordering scenarios place BashGuard before and after the mutator. Replacement scenarios demonstrate transformations internal to tool execution that no `tool_call` observer can see.

The harness treats the first-party sandbox example as source evidence for the same architectural pattern: `SandboxManager.wrapWithSandbox(command)` runs inside replacement `BashOperations`, after `tool_call`. Running the ASRT backend itself remains Spike 6.

## Evidence layers

The spike names layers explicitly instead of calling any one value “resolved”:

1. **Model-requested input** — the exact `bash` tool argument first observed before mutation.
2. **BashGuard-recorded input** — the command persisted in BashGuard's `tool.requested` event.
3. **Post-hook input** — the mutable command visible to a late `tool_call` observer.
4. **Tool execution input** — the command entering a replacement tool's `spawnHook` and the wrapper returned by that hook.
5. **Runtime fixture evidence** — argv, cwd, and explicitly allowlisted sentinel values observed by a child process.

Relationships use Pi's `toolCallId` wherever the hook exposes it. Runtime fixture records additionally carry a generated scenario token passed through the controlled command.

## Probe record

Probe extensions append JSONL records shaped like:

```typescript
interface CommandResolutionProbeRecord {
  runId: string;
  scenario: string;
  stage:
    | "early_tool_call"
    | "late_tool_call"
    | "spawn_hook_input"
    | "spawn_hook_output"
    | "runtime_fixture";
  toolCallId?: string;
  command?: string;
  cwd?: string;
  extensionOrder: string[];
  timestamp: string;
  sentinels?: Record<string, string>;
}
```

Only controlled sentinel names are captured. The harness never records the complete process environment.

BashGuard's independent JSONL remains the source for `bashguard_recorded`. The analyzer joins probe records and BashGuard events by `toolCallId`, then joins runtime records by scenario token. Missing joins remain missing evidence.

## Scenario matrix

The command matrix covers:

- a simple executable with arguments;
- a pipeline;
- an `&&` chain;
- a leading environment assignment or shell prefix;
- explicit loading of a controlled environment file;
- a relative executable path;
- `cd` followed by execution;
- a destructive-looking `rm -rf` confined to a newly created temporary fixture tree.

The ordering matrix covers:

- BashGuard before a mutating handler;
- mutating handler before BashGuard;
- early and late observers around both;
- a replacement `bash` tool whose `spawnHook` adds a controlled wrapper after hook processing.

Mutation uses harmless sentinels, for example prepending `export BASHGUARD_SPIKE_MUTATED=1;`. Spawn wrapping similarly adds only a controlled sentinel. The fixture verifies the sentinel without reading unrelated environment values.

## Orchestration and model behavior

The orchestrator starts fresh print-mode Pi sessions with:

- an isolated `BASHGUARD_DATA_DIR`;
- only explicitly listed extensions;
- an available OpenAI model;
- one exact command request per turn;
- a bounded process timeout;
- a disposable fixture root.

Model output is not considered deterministic. The early observer must match the scenario's expected command exactly. A mismatch makes that attempt invalid; the harness may retry a bounded number of times but may not rewrite or reinterpret the command. Repeated mismatch is a visible scenario failure.

The runner validates that Pi emitted shutdown evidence and that every file created by the spike remains under its temporary root. Raw Pi and probe evidence remains local and uncommitted.

## Failure behavior

A scenario fails visibly when:

- Pi exits nonzero or times out;
- the model requests a different command;
- a required stage is absent or duplicated;
- `toolCallId` correlation is ambiguous;
- runtime evidence has the wrong scenario token;
- a mutation or wrapper sentinel is unexpectedly present or missing;
- the BashGuard session lacks shutdown evidence;
- the fixture touches a path outside the temporary root.

Failure output identifies the exact stage and retains the temporary artifact path for diagnosis. The harness does not fill gaps through timing inference.

## Testing

Tests are written before implementation for:

- scenario definition validation and shell-safe fixture paths;
- JSONL probe parsing, including incomplete final lines;
- `toolCallId` and scenario-token correlation;
- extension-order expectations;
- detection of model command mismatch, missing stages, duplicate stages, and unexpected sentinels;
- sanitized findings-table projection;
- subprocess timeout and cleanup behavior where practical.

A real OpenAI-backed Pi smoke is required for completion. Synthetic unit tests alone cannot establish extension ordering or execution behavior.

## Deliverables

The repository receives:

- the reusable spike runner and probe extensions;
- deterministic harmless fixtures;
- automated analyzer tests;
- a sanitized findings document with the observed layer matrix;
- capability-matrix and roadmap updates.

Raw session stores, provider responses, ambient environment data, and temporary fixture output are not committed.

## Completion criteria

Spike 2 is complete when:

- the full command and extension-order matrices run against real Pi;
- every included finding points to direct probe or BashGuard evidence;
- the findings distinguish pre-execution previewable context from runtime-only behavior;
- the capability matrix records the strongest supportable resolved-command claim;
- no production event semantics were added;
- the roadmap advances to the paused split-pane event browser.
