# Command Resolution Spike 2 Results

**Status:** Complete
**Date:** August 22, 2026
**Tracking:** [Issue #83](https://github.com/acheltenham/BashGuard/issues/83)
**Design:** [Command Resolution Spike Design](../plans/2026-08-22-command-resolution-spike-design.md)

## Question

Which command representation can BashGuard observe between a model's `bash` tool request and a running process, and which transformations remain outside BashGuard's current hook evidence?

## Test environment

- BashGuard branch based on merge commit `08a7ab1`, with the final evidence rerun using harness commit `99f96ff`
- `@earendil-works/pi-coding-agent` 0.84.0
- macOS (`darwin`)
- OpenAI Codex provider, `gpt-5.4-mini`, thinking off
- fresh print-mode Pi session per scenario
- explicitly ordered extensions only
- isolated temporary BashGuard and probe JSONL per attempt

The raw Pi sessions and probe JSONL stayed under `/tmp` and were not committed. The matrix below is a sanitized projection from those records.

## Observed layers

The spike used these evidence names rather than treating one value as universally resolved:

1. **Requested** — command seen by the earliest `tool_call` observer.
2. **BashGuard recorded** — command persisted by BashGuard's current `tool_call` handler.
3. **Post-hook** — command seen by a later `tool_call` observer.
4. **Spawn output** — command returned by a replacement Bash tool's `spawnHook` immediately before shell execution.
5. **Runtime** — argv, cwd, stdin, and allowlisted sentinels recorded by a controlled child process.

Probe and BashGuard records correlated directly by Pi `toolCallId`. Runtime fixture records correlated by a unique scenario token embedded in the exact requested command.

## Scenario matrix

| Scenario | Status | BashGuard recorded | Post-hook | Spawn output | Runtime records |
|---|---|---|---|---|---:|
| simple | passed | same as requested | same as requested | missing | 1 |
| pipeline | passed | same as requested | same as requested | missing | 1 |
| chain | passed | same as requested | same as requested | missing | 2 |
| prefix-env | passed | same as requested | same as requested | missing | 1 |
| environment-load | passed | same as requested | same as requested | missing | 1 |
| relative-path | passed | same as requested | same as requested | missing | 1 |
| directory-change | passed | same as requested | same as requested | missing | 1 |
| harmless-rm | passed | same as requested | same as requested | missing | 1 |
| BashGuard before mutator | passed | same as requested | changed | missing | 1 |
| mutator before BashGuard | passed | changed | changed | missing | 1 |
| replacement spawn hook | passed | same as requested | same as requested | wrapped after `tool_call` | 1 |

“Missing” means that layer did not exist in that scenario. It is not inferred from another layer.

## Findings

### 1. Extension order determines what BashGuard records

Pi runs `tool_call` handlers in extension load order, and `event.input` is shared mutable input.

When BashGuard loaded before the mutator, direct evidence showed:

```text
early observer       requested command
BashGuard            requested command
late observer        export BASHGUARD_SPIKE_MUTATED=1; <requested command>
runtime              BASHGUARD_SPIKE_MUTATED=1
```

When the mutator loaded before BashGuard:

```text
early observer       requested command
BashGuard            export BASHGUARD_SPIKE_MUTATED=1; <requested command>
late observer        export BASHGUARD_SPIKE_MUTATED=1; <requested command>
runtime              BASHGUARD_SPIKE_MUTATED=1
```

Therefore, BashGuard's current `tool.requested` command means **the command input observed when BashGuard's handler ran**. It is not necessarily the original model argument and is not necessarily the final execution input.

### 2. Later handlers can change execution after BashGuard records

The BashGuard-before-mutator scenario proved that a later extension can modify `event.input.command` after BashGuard persists its event. The changed command executed and its controlled runtime sentinel was present.

BashGuard cannot guarantee that its recorded `tool.requested` command is what will execute unless it either runs after every mutator or Pi provides a final post-mutation hook. Extension load order alone is not a durable security guarantee.

### 3. Replacement tools can wrap commands after every `tool_call` observer

The replacement-tool scenario showed identical requested, BashGuard-recorded, and late-observer command text. Inside the replacement Bash tool, `spawnHook` then prepended a wrapper, and the runtime fixture observed the wrapper sentinel.

No `tool_call` observer saw that internal transformation. Pi's first-party sandbox example has the same architectural shape: its replacement Bash operations call `SandboxManager.wrapWithSandbox(command)` inside execution. This spike did not run ASRT itself; that remains Spike 6.

### 4. Shell semantics remain runtime behavior

The controlled runtime evidence confirmed:

- the pipeline delivered `pipeline-data\n` on stdin;
- the `&&` chain ran two child processes in order;
- the environment prefix set only the controlled prefix sentinel;
- explicit environment-file loading set the controlled loaded sentinel;
- the relative executable resolved from the Pi working directory;
- `cd` changed the child process cwd to the nested fixture directory;
- the destructive-looking `rm -rf` removed only the disposable target, then the verification fixture ran.

The pre-execution hooks retained the shell command string. They did not expose the resulting child-process argv, pipeline data flow, environment-file contents, internal `cd` result, or filesystem effect as a final resolved structure.

### 5. Working-directory evidence has layers too

`ctx.cwd` and the Bash tool's initial cwd are observable before execution. A shell built-in such as `cd` can change the cwd for later segments inside the same command. BashGuard should present the initial cwd as observed context and avoid calling it the cwd of every child process.

## Product contract for Phase 3

BashGuard can safely preview before execution:

- the command input visible at its own `tool_call` handler;
- Pi `toolCallId`;
- initial `ctx.cwd`;
- transparent analysis of visible shell text, if clearly labelled as analysis rather than execution fact;
- known mutations made by earlier handlers, because they are already present in the observed input.

BashGuard cannot currently guarantee before execution:

- the original model argument when an earlier extension already mutated it;
- mutations performed by later `tool_call` handlers;
- wrappers applied inside replacement tools or sandbox operations;
- shell expansion results, sourced environment values, pipeline flow, aliases/functions, child-process behavior, or effects;
- the final argv, cwd, environment, or resources reached by every descendant process.

Phase 3 should therefore avoid a bare **resolved command** claim. Recommended concepts are:

- **Requested/observed command** — command visible when BashGuard evaluated the tool call;
- **Known wrappers or prefixes** — only when directly exposed;
- **Execution may differ** — explicit limitation when later handlers, replacement tools, or shell runtime can transform behavior.

Authorization can still evaluate the command visible at BashGuard's hook, but the approval surface must disclose that it is not containment and may not include later/internal/runtime transformations.

## Harness validation

The first real smoke exposed one harness-only portability issue: macOS canonicalizes temporary paths (for example `/tmp` to `/private/tmp`). A failing regression test was added before canonicalizing confinement checks. The simple smoke and all eleven matrix scenarios then passed.

The final full matrix was rerun after restricting spawned Pi processes to an allowlisted environment and requiring a fresh root beneath an operating-system temporary directory.

The harness also verified:

- one BashGuard session and shutdown event per attempt;
- complete `toolCallId` correlation for every included scenario;
- no capture gaps, redactions, or truncations in representative BashGuard debriefs;
- no generated `events.jsonl` or probe evidence committed to the repository.

## Next step

Spike 2 is complete. Per the roadmap's explicit restart sequence, the next implementation slice is the paused Phase 1 split-pane `bashguard inspect --browse` event browser. Phase 3 authorization follows that browser slice.
