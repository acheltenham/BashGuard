# Interactive Session Picker Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Add a shared interactive numbered session picker for selector-less `attach`, `inspect`, and `debrief` while preserving deterministic explicit and non-interactive behavior.

**Architecture:** Keep discovery, candidate policy, selector resolution, and terminal input separate. One discovery snapshot produces indexed session choices; explicit selectors resolve against the complete snapshot, while selector-less commands derive command-specific candidates and either auto-select one, prompt interactively, or return an actionable non-interactive error. Use Node's readline APIs behind injectable streams; do not introduce a full-screen TUI dependency.

**Tech Stack:** TypeScript on Node.js, `node:readline/promises`, Node streams/test runner, existing append-only JSONL CLI and subprocess integration tests.

---

### Task 1: Track the focused Phase 1 slice

**Files:**
- External: GitHub issue under Phase 1 tracker `#61`

**Step 1: Create a focused issue**

Create an issue titled `Add interactive session picker for selector-less commands` with:

- approved command policy for attach versus inspect/debrief;
- TTY-only prompting;
- explicit-number requirement;
- stable snapshot/global selector requirement;
- non-interactive error behavior;
- test and documentation acceptance criteria.

**Step 2: Link the issue to Phase 1**

Comment on `#61` with the focused issue URL and scope boundary: selection only, no full-screen TUI.

**Step 3: Record issue number**

Use the focused issue number in the implementation PR and final tracker updates.

---

### Task 2: Add pure indexed-candidate and selector policy

**Files:**
- Modify: `src/cli.ts:37-57` session types
- Modify: `src/cli.ts:376-396` session formatting
- Modify: `src/cli.ts:1510-1545` selector logic
- Test: `src/cli.test.ts:76-121`

**Step 1: Write failing candidate-policy tests**

Import proposed helpers `indexSessionChoices`, `eligibleSessionChoices`, and `resolveSessionChoice` in `src/cli.test.ts`.

Cover:

```ts
const choices = indexSessionChoices([completed, activeA, activeB]);
assert.deepEqual(choices.map((choice) => choice.selector), [1, 2, 3]);
assert.deepEqual(eligibleSessionChoices("attach", choices).map((choice) => choice.selector), [2, 3]);
assert.deepEqual(eligibleSessionChoices("inspect", choices).map((choice) => choice.selector), [1, 2, 3]);
assert.deepEqual(eligibleSessionChoices("debrief", choices).map((choice) => choice.selector), [1, 2, 3]);
```

Also cover attach fallback when no sessions are active and explicit index/exact-ID/unique-prefix resolution against the complete snapshot.

**Step 2: Run tests and verify RED**

Run:

```bash
node --experimental-strip-types --test --test-name-pattern='session choice|eligible session|resolve session' src/cli.test.ts
```

Expected: import/export failure because the policy helpers do not exist.

**Step 3: Implement minimal pure helpers**

Add:

```ts
export type SessionCommand = "attach" | "inspect" | "debrief";
export type SessionChoice = { selector: number; session: SessionSummary };

export function indexSessionChoices(sessions: SessionSummary[]): SessionChoice[] {
  return sessions.map((session, index) => ({ selector: index + 1, session }));
}

export function eligibleSessionChoices(command: SessionCommand, choices: SessionChoice[]): SessionChoice[] {
  if (command !== "attach") return choices;
  const active = choices.filter((choice) => choice.session.active);
  return active.length > 0 ? active : choices;
}
```

Extract existing explicit index/ID/prefix matching into `resolveSessionChoice(requestedId, choices)` without changing semantics. Preserve `formatSessionNotFound()` evidence scope wording.

Stable selectors must remain the original global `bashguard sessions` indexes even when attach filters to active candidates. Do not renumber the active subset.

**Step 4: Run focused and full unit tests**

Run:

```bash
node --experimental-strip-types --test src/cli.test.ts
npm run check
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "refactor: separate session selection policy"
```

---

### Task 3: Build the injectable numbered terminal prompt

**Files:**
- Modify: `src/cli.ts:1-10` imports
- Modify: `src/cli.ts:376-396` picker formatting
- Modify: `src/cli.ts:1510-1545` prompt helper area
- Test: `src/session-picker.test.ts` (create)

**Step 1: Write failing prompt tests with real streams**

Create `src/session-picker.test.ts` using `PassThrough` streams and the proposed exported `promptForSessionChoice()`.

Cover:

- displays stable selectors and distinguishing session columns;
- input `2\n` returns the choice whose global selector is 2;
- blank, non-number, and unavailable selector print guidance and retry;
- Enter does not select a default;
- EOF rejects with `Session selection cancelled.`;
- an emitted `SIGINT`/readline interruption rejects with the same concise cancellation error;
- sessions are returned from the supplied snapshot rather than rediscovered.

Example:

```ts
const input = new PassThrough();
const output = new PassThrough();
const pending = promptForSessionChoice(choices, { input, output });
input.end("\ninvalid\n3\n");
assert.equal((await pending).selector, 3);
assert.match(readOutput(output), /Enter one of: 1, 3/);
```

**Step 2: Run tests and verify RED**

Run:

```bash
node --experimental-strip-types --test src/session-picker.test.ts
```

Expected: import/export failure for `promptForSessionChoice`.

**Step 3: Implement minimal prompt**

Use `createInterface` from `node:readline/promises`. Add a formatter that renders candidate rows using each `SessionChoice.selector`; do not call `formatSessionList()` if it would renumber filtered choices.

Prompt text should be explicit:

```text
Select a session [1, 3]:
```

Validation should accept only an integer exactly matching a displayed selector. On invalid input, write:

```text
Enter one of: 1, 3.
```

Close readline in `finally`. Convert EOF and `SIGINT` to `Error("Session selection cancelled.")`; do not call `process.exit()` inside the helper.

**Step 4: Run prompt, unit, and type tests**

Run:

```bash
node --experimental-strip-types --test src/session-picker.test.ts src/cli.test.ts
npm run check
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/cli.ts src/session-picker.test.ts
git commit -m "feat: add interactive numbered session prompt"
```

---

### Task 4: Add shared interactive/non-interactive selection orchestration

**Files:**
- Modify: `src/cli.ts:1510-1545`
- Test: `src/cli.test.ts:76-121`
- Test: `src/session-picker.test.ts`

**Step 1: Write failing orchestration tests**

Define a proposed `selectSessionForCommand(command, requestedId, options)` API whose options allow injection of:

```ts
{
  root?: string;
  input?: NodeJS.ReadableStream & { isTTY?: boolean };
  output?: NodeJS.WritableStream & { isTTY?: boolean };
  prompt?: typeof promptForSessionChoice;
}
```

Cover:

- explicit selector bypasses the prompt even with multiple sessions;
- one eligible candidate auto-selects without prompt;
- attach with multiple active sessions passes only active choices to prompt;
- attach with no active sessions passes completed choices;
- inspect/debrief pass all sessions;
- multiple candidates with either non-TTY stream reject without invoking prompt;
- non-interactive error lists stable selectors and a copyable command for the invoking command;
- discovery occurs once (inject or observe one snapshot, not a second read).

**Step 2: Run tests and verify RED**

Run:

```bash
node --experimental-strip-types --test --test-name-pattern='selectSessionForCommand|non-interactive session' src/*.test.ts
```

Expected: missing export/API failure.

**Step 3: Implement orchestration**

Implement `selectSessionForCommand()`:

1. discover once;
2. fail with the existing no-sessions error;
3. index the complete snapshot;
4. resolve explicit selectors against all choices;
5. derive eligible candidates for omitted selectors;
6. auto-select one;
7. require `input.isTTY === true && output.isTTY === true` before prompting;
8. otherwise throw a formatted ambiguity error.

The non-interactive message should state that more than one eligible session exists, render stable global selectors, and include a copyable command such as `bashguard attach 2`. It must not silently select the newest session.

Keep `chooseSession()` as a compatibility wrapper for existing exported API/tests if useful, but route command execution through the shared selector.

**Step 4: Run focused and full tests**

Run:

```bash
node --experimental-strip-types --test src/session-picker.test.ts src/cli.test.ts
npm test
npm run check
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/cli.ts src/cli.test.ts src/session-picker.test.ts
git commit -m "feat: select sessions by command context"
```

---

### Task 5: Integrate attach, inspect, and debrief

**Files:**
- Modify: `src/cli.ts:110-125` usage
- Modify: `src/cli.ts:1547-1603` inspect/debrief
- Modify: `src/cli.ts:1604-1727` attach
- Modify: `src/cli.ts:1729-1740` main dispatch
- Test: `src/session-selection.integration.test.ts` (create)
- Test: `src/attach-history.integration.test.ts`

**Step 1: Write failing subprocess integration tests**

Create temporary BashGuard stores and spawn the CLI.

Cover:

- selector-less inspect with one session auto-selects and renders events;
- selector-less debrief with one session auto-selects and renders debrief;
- selector-less attach with one active session auto-selects;
- selector-less inspect/debrief with multiple sessions and piped stdio exit non-zero, never print a prompt, and list copyable selectors;
- selector-less attach with multiple active sessions and piped stdio exits non-zero and lists only eligible active choices with stable global selectors;
- explicit `attach 2`, `inspect 2`, and `debrief 2` remain non-interactive and unchanged;
- `inspect --activity list` remains session-independent and does not invoke selection.

A subprocess pipe is intentionally non-TTY; assert it never hangs and never writes `Select a session`.

**Step 2: Run tests and verify RED**

Run:

```bash
node --experimental-strip-types --test src/session-selection.integration.test.ts
```

Expected: selector-less inspect/debrief still fail with usage errors and multi-session behavior lacks the new guidance.

**Step 3: Wire commands to shared selector**

- Update usage to show optional selectors for all three commands.
- Remove early omitted-session rejection from inspect/debrief.
- Preserve `--activity list` before session selection.
- Pass `process.stdin` and `process.stdout` to selection.
- After selection, derive a stable output selector from the chosen session ID prefix when no selector was supplied. Do not emit `undefined` in inspect/debrief guidance.
- Keep explicit-selector filtering, event lookup, history, and debrief behavior unchanged.
- Main dispatch should pass complete parsed options where needed rather than only `sessionId`.

**Step 4: Run integration and full automated tests**

Run:

```bash
node --experimental-strip-types --test src/session-selection.integration.test.ts src/attach-history.integration.test.ts
npm test
npm run check
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/cli.ts src/session-selection.integration.test.ts src/attach-history.integration.test.ts
git commit -m "feat: use session picker across CLI commands"
```

---

### Task 6: Update user and project documentation

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/current-state.md`
- Modify: `docs/product/roadmap.md`
- Modify: `docs/vision/terminal-ux.md`
- Modify: `docs/cli/live-attach.md`
- Modify: `docs/testing/milestone-0-smoke-checklist.md`
- Modify: `docs/release/checklist.md`
- Modify: `skills/bashguard/SKILL.md`
- Modify: `docs/plans/2026-08-13-interactive-session-picker-design.md`

**Step 1: Clarify stable selector semantics in the design**

Add that filtered picker candidates retain their original `bashguard sessions` numeric selectors. This ensures displayed choices are copyable and explicit selector behavior remains unchanged.

**Step 2: Document command behavior**

Document:

- ambiguity-first attach policy;
- all-session inspect/debrief policy;
- one-candidate auto-selection;
- TTY-only picker;
- explicit number requirement;
- stable global selectors;
- non-interactive errors rather than prompts;
- cancellation and later-restart boundaries;
- no full-screen TUI yet.

Use evidence-qualified wording and keep install examples pinned to v0.3.0 until a later release exists.

**Step 3: Update testing/release checks and bundled skill**

Add simultaneous active-session smoke steps and scripted non-prompt assertions. Teach the skill that omitted selectors may auto-select or prompt only in a TTY, and explicit selectors remain safest for automation.

**Step 4: Validate docs and tests**

Run:

```bash
rg -n "interactive|selector|multiple active" README.md docs skills/bashguard/SKILL.md
npm test
npm run check
git diff --check
```

Expected: PASS and no stale overclaims.

**Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs skills/bashguard/SKILL.md
git commit -m "docs: explain interactive session selection"
```

---

### Task 7: Real-session validation and completion gate

**Files:**
- Modify if evidence warrants: `docs/testing/milestone-0-smoke-checklist.md`
- External: focused issue and Phase 1 tracker `#61`

**Step 1: Run simultaneous-session smoke test**

Start two isolated real Pi sessions with BashGuard loaded and one shared test `BASHGUARD_DATA_DIR`. Keep both active long enough to exercise selection.

Verify in an actual terminal:

- selector-less attach shows only active candidates;
- Enter alone does not select;
- invalid input retries;
- a valid displayed number attaches to the matching session;
- selector-less inspect and debrief show all recent sessions;
- explicit selectors bypass the picker.

Record only sanitized IDs/output.

**Step 2: Run non-interactive smoke tests**

Pipe or redirect selector-less commands with multiple sessions and verify:

- no prompt;
- non-zero exit;
- stable eligible selectors and copyable commands;
- no stack trace.

**Step 3: Run complete verification**

Run:

```bash
npm test
npm run check
npm audit
npm run baseline:milestone-0 -- --samples 25
git diff --check
git status --short
```

Expected: all tests pass, TypeScript passes, zero known audit vulnerabilities, baseline completes, no whitespace errors, and only intended changes remain.

**Step 4: Request independent code review**

Review `origin/main..HEAD` for:

- selector/index stability;
- TTY detection and cancellation;
- scriptability/no hangs;
- one-snapshot behavior;
- inspect/debrief selector propagation;
- simultaneous-session edge cases.

Fix all Critical/Important findings test-first and rerun the full gate.

**Step 5: Push and open PR**

```bash
git push -u origin feat/interactive-session-picker
gh pr create --base main --head feat/interactive-session-picker
```

Link and close the focused issue in the PR body. Update both the focused issue and Phase 1 `#61` with verification evidence.

**Step 6: Finish branch**

After approval and merge, use the finishing-a-development-branch workflow. Confirm `main` is clean and remove the worktree only after integration is verified.
