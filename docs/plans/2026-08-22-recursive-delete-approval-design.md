# Recursive Forced-Deletion Approval Design

**Status:** Approved — implementation pending
**Phase:** Phase 3 — Resolved Command Guard, Slice 1
**Issue:** [#87](https://github.com/acheltenham/BashGuard/issues/87)

## Goal

Ship BashGuard's first narrow authorization control: an agent-initiated Pi `bash` tool call whose command input, as observed by BashGuard's `tool_call` handler, matches the existing recursive forced-deletion check must receive one-time in-Pi approval before that call may continue.

This is authorization, not containment. It neither creates an operating-system boundary nor proves the approved text is the final command executed.

## User contract

For a matching command such as `rm -rf build` or `rm -fr ./tmp`, Pi shows:

- the complete command input observed by BashGuard;
- current working directory;
- matched check: `destructive filesystem removal`;
- potential impact: recursive deletion without a trash or undo step;
- the choices **Run once** and **Decline**;
- a limitation that later extension handlers, replacement tools, and shell runtime behavior may differ from the observed input.

**Run once** permits only that tool call. **Decline** blocks it. There is no remembered approval, `always allow`, configuration mutation, or rule creation.

If interactive approval UI is absent or confirmation fails, BashGuard blocks conservatively with an actionable reason. The developer never has to switch to the companion terminal to decide.

## Why this first rule

BashGuard already has a transparent, tested recursive forced-deletion check. Reusing it gives the first authorization slice a deterministic boundary without pretending target paths, shell expansion, aliases, wrappers, child processes, or eventual runtime behavior have been resolved.

Prompting for every existing risk category would make the first slice broad and difficult to validate. Restricting this slice to absolute or out-of-repository targets would first require a shell/path resolver that BashGuard does not yet possess. The approved rule therefore covers every command matching the existing `rm` recursive-plus-force check and states that limitation honestly.

## Architecture

### Shared risk classification

Move `classifyCommandRisk` and its explanations out of `src/cli.ts` into a shared Pi-independent module, proposed as `src/command-risk.ts`. CLI narration, debriefing, inspection, and authorization import the same implementation so the visible non-blocking notice cannot drift from the approval rule.

This extraction does not change the other current classifications:

- history or working-tree rewrite;
- network download piped to a shell;
- secret-looking value in command text.

Those remain observation-only notices in Slice 1.

### Pure authorization evaluation

Add `src/command-authorization.ts` with a pure evaluator. It accepts structural tool-call context:

```ts
type AuthorizationInput = {
  toolName: string;
  input: unknown;
  cwd: string;
  hasUI: boolean;
};
```

It returns either an allow result for unmatched calls or a structured approval requirement:

```ts
type AuthorizationEvaluation =
  | { outcome: "allow" }
  | {
      outcome: "approval";
      observedCommand: string;
      workingDirectory: string;
      matchedCheck: "recursive-forced-deletion";
      riskFactors: ["destructive filesystem removal"];
      reason: string;
      potentialImpact: string;
      overrideAvailable: true;
      evidence: "bashguard_tool_call_input";
      limitations: string[];
    };
```

Malformed input, non-`bash` tools, and safe Bash commands allow without prompting. The evaluator performs no I/O and does not know about Pi UI or event storage.

### Thin Pi adapter

The extension remains the adapter between pure evaluation and Pi:

1. record the existing `tool.requested` event;
2. skip authorization when this extension instance is not the active recorder owner;
3. evaluate the observed tool call;
4. return normally for `allow`;
5. record `command.evaluated` for an approval result;
6. when UI exists, record `command.approval_requested` and call `ctx.ui.confirm`;
7. on **Run once**, record `command.approved` and return normally;
8. on **Decline**, record `command.declined`, record `command.blocked`, and return Pi's `{ block: true, reason }` result;
9. when UI is absent or confirmation throws, record `command.blocked` and return the blocking result.

Only the recorder-lock owner authorizes. A duplicate inactive BashGuard instance must neither prompt nor return a conflicting block result.

The orchestration should be testable through injected `record` and `confirm` functions rather than through a generic policy engine.

## Evidence model

Decision events use existing append-only JSONL and reference the Pi `toolCallId` and tool name. Their payloads include the evaluation fields above plus a decision source and, where applicable, a final reason:

- `command.evaluated` — `outcome: approval`;
- `command.approval_requested` — the request was presented;
- `command.approved` — `outcome: allow`, `authorization: run_once`;
- `command.declined` — the user's explicit response;
- `command.blocked` — Pi was instructed to block, with cause `declined`, `approval_unavailable`, or `approval_error`.

A declined call has both `command.declined` (human response evidence) and `command.blocked` (authorization enforcement evidence). A UI-unavailable call has no fabricated approval-request event. A confirmation error has an approval-request event followed by a blocked event.

Blocked calls normally have no `tool.completed` event; BashGuard must not invent one.

The UI receives the complete command string visible to the handler. Persisted events pass through the recorder's existing sanitization, truncation, and capture metadata. This slice does not claim complete secret-aware command redaction. Decision events should avoid command output and other new unbounded payloads.

## Presentation

The existing terminal companion mirrors authorization evidence without becoming the approval surface:

- timeline and browser rows narrate approval requested, approved, declined, and blocked events;
- event inspection shows the observed command, cwd, matched check, reason, impact, decision source, and limitations;
- debrief reports approval requests, approvals, declines, and blocks from recorded events;
- capture gaps remain visible and decision narration never replaces source events.

Wording must use **BashGuard-observed command** rather than **resolved command**. It may say Pi was instructed to block this supported tool call, but not that BashGuard contained the process or prevented every possible equivalent action.

## Failure behavior

Authorization and recording have separate failure semantics:

- explicit user approval remains allow even if decision-event persistence degrades;
- explicit decline remains block even if persistence degrades;
- absent UI remains block;
- thrown confirmation remains block;
- recorder write failure uses current capture-gap/notification behavior and does not reverse the decision;
- inactive duplicate instances remain inert;
- safe and unsupported calls remain unaffected by authorization UI failures because they never request approval.

BashGuard is an in-process authorization control, not a security boundary against compromised Pi or extension code.

## Testing and validation

### Unit tests

- shared classifier parity for all current risk patterns;
- evaluator allows non-Bash tools, malformed Bash input, and safe commands;
- evaluator requires approval for supported `rm -rf` and `rm -fr` forms;
- evaluation payload contains exact observed input, cwd, transparent check, impact, and limitations;
- orchestration covers Run once, decline, no UI, confirmation error, recording failure, and inactive ownership;
- append order is `tool.requested` before decision evidence and final response;
- safe calls and other existing risk notices do not prompt or block.

### Projection tests

- timeline, inspect/browser, filtering, and debrief render grounded decision evidence;
- blocked calls do not acquire a synthetic completion;
- capture limitations and command-resolution caveats remain visible.

### Real-session tests

- a non-interactive real Pi session requests recursive forced deletion inside a fresh disposable temporary root; unavailable approval blocks and the target remains;
- an interactive Pi/PTY smoke approves or declines a disposable target where deterministic automation is feasible;
- no real project path or user data is used for destructive testing;
- independent OpenAI review checks the implementation against this design.

## Explicitly deferred work

The following are intentionally not lost; they remain future roadmap work rather than accidental omissions from Slice 1.

### Authorization breadth

- approval or block behavior for Git rewrites, network-to-shell commands, secret-looking text, privileged commands, destructive databases, sensitive home access, and writes outside the repository;
- authorization for user `!` commands, `read`, `write`, `edit`, replacement tools, child processes, or commands outside supported Pi hooks;
- multi-segment shell parsing, pipeline/chain analysis, target-resource extraction, and safer alternatives;
- hard-block-only rules and notice-vs-approval policy refinement.

### Policy lifecycle

- persistent approvals, `always allow`, per-project configuration, custom rules, or a general-purpose policy language;
- rule creation suggestions, autonomous policy recommendations, historical simulation, and organization/team policy;
- approval expiry, approval reuse, and cross-session policy identity.

### Command identity

- a universal resolved-command claim;
- observing mutations made by later extension handlers;
- replacement-tool internal wrappers;
- shell aliases, expansion, sourced configuration, functions, child processes, or runtime argv guarantees;
- command mutation to a safer alternative.

### Recovery and stronger controls

- pre-action Git checkpoints, restore workflows, or automatic repository reset;
- sandbox runtime/backend integration and session-time boundary evidence;
- network policy, downstream authorization, or operating-system containment;
- complete secret-aware display/persistence beyond current recorder sanitization.

These items must remain visible in the roadmap/current-state documentation when Slice 1 is marked complete. The next slice should be selected explicitly rather than inferred from this list.

## Success criteria

Slice 1 is complete when:

- one transparent recursive forced-deletion rule requests approval inside Pi;
- **Run once** permits only that tool call;
- decline, unavailable UI, and confirmation failure return Pi's blocking result;
- only the active recorder owner authorizes;
- every available decision event is grounded, inspectable, and honestly caveated;
- safe commands and other current risk notices remain non-blocking;
- no documentation describes authorization as containment or the observed input as universally resolved;
- the deferred-work ledger remains linked from the roadmap.
