# Recursive Forced-Deletion Approval Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Require one-time in-Pi approval for agent-initiated Bash tool calls whose BashGuard-observed command matches the existing recursive forced-deletion check, while preserving safe workflows and grounded decision evidence.

**Architecture:** Extract risk classification into a shared pure module, add a pure evaluator plus Pi-independent approval orchestration, and keep the extension as a thin owner-aware adapter over Pi UI, event recording, and `tool_call` blocking. Existing CLI projections consume the same recorded decision events; no general policy engine or resolved-command claim is introduced.

**Tech Stack:** TypeScript, Node.js test runner, Pi extension SDK `tool_call`/`ctx.ui.confirm`, append-only JSONL, existing CLI/PTY/real-Pi harnesses.

---

### Task 0: Stabilize the inherited real-PTY baseline

**Files:**
- Modify: `src/live-footer.integration.test.ts`

**Steps:**
1. Reproduce the inherited footer PTY failures where fixed sleeps append shutdown before attach becomes active.
2. Replace startup sleeps with `runPortablePty`'s output-driven readiness: wait for `ACTIVE ·` before live/Ctrl+C input and `Live status` before plain shutdown; poll redirected output for the same marker.
3. Run the three PTY tests three times and verify all pass.
4. Run `npm test`, `npm run check`, and `git diff --check`.
5. Commit `test: synchronize live footer PTY readiness`.

### Task 1: Extract the shared command-risk classifier

**Files:**
- Create: `src/command-risk.ts`
- Create: `src/command-risk.test.ts`
- Modify: `src/cli.ts`
- Modify: `src/cli.test.ts`

**Steps:**
1. Write failing tests importing `classifyCommandRisk`, `explainCommandRisk`, and the recursive-deletion risk/check constants from `src/command-risk.ts`. Cover all current patterns and nonmatches, including `rm -rf`, `rm -fr`, safe `rm -f`, Git rewrite, network-to-shell, and secret-looking text.
2. Run `node --experimental-strip-types --test src/command-risk.test.ts` and verify module-not-found RED.
3. Move the existing classifier and explanations unchanged into the shared module; export stable constants for `destructive filesystem removal` and `recursive-forced-deletion`.
4. Import the shared functions into `src/cli.ts`; remove the local duplicate without changing output bytes.
5. Run `src/command-risk.test.ts` and the risk-related `src/cli.test.ts` tests GREEN, then `npm run check`.
6. Commit `refactor: share command risk classification`.

### Task 2: Build the pure authorization evaluator

**Files:**
- Create: `src/command-authorization.ts`
- Create: `src/command-authorization.test.ts`

**Steps:**
1. Write failing tests for non-Bash tools, missing/non-object input, missing command, safe Bash, other risk categories, and recursive forced-deletion variants.
2. Assert the approval evaluation contains the exact observed command, cwd, matched check, risk factor, plain reason, potential impact, one-time override flag, evidence source, and all three command-identity limitations.
3. Verify RED.
4. Implement `evaluateToolCallAuthorization()` as a pure structural function using the shared classifier. It must never parse target paths or call Pi/storage APIs.
5. Run focused tests GREEN and commit `feat: evaluate recursive deletion approval`.

### Task 3: Build approval orchestration independent of Pi

**Files:**
- Modify: `src/command-authorization.ts`
- Modify: `src/command-authorization.test.ts`

**Steps:**
1. Write failing tests for event order and return values across allow, Run once, decline, unavailable UI, confirmation error, and recorder rejection.
2. Define injected dependencies: `record(type, payload)`, `confirm(title, body)`, and `hasUI`. The result is `undefined` to allow or `{ block: true, reason }` to block.
3. Assert unavailable UI records only evaluated + blocked, decline records evaluated + requested + declined + blocked, approval records evaluated + requested + approved, and confirmation error records evaluated + requested + blocked.
4. Assert recorder rejection never reverses approval/decline and does not prevent the confirmation attempt.
5. Implement safe decision-event recording, exact two-choice prompt formatting, conservative UI failure behavior, and structured cause values.
6. Run focused tests GREEN and commit `feat: orchestrate one-time command approval`.

### Task 4: Integrate the active recorder owner with Pi `tool_call`

**Files:**
- Modify: `extensions/bashguard/index.ts`
- Create: `src/extension-authorization.test.ts`
- Modify: `src/extension-failure.test.ts`

**Steps:**
1. Build a reusable mock Pi extension fixture that captures registered handlers, notifications, confirmations, and JSONL events under a temporary `BASHGUARD_DATA_DIR`.
2. Write failing extension tests proving safe Bash and non-Bash calls keep current behavior and return no block.
3. Write failing tests proving Run once allows, decline blocks, no UI blocks, and confirmation errors block with useful reasons.
4. Assert JSONL append order begins with `tool.requested` and contains the expected decision event sequence with matching `toolCallId`.
5. Instantiate two extensions against one session and assert the inactive lock loser neither prompts nor blocks.
6. Extend the unwritable-stream test with a matching command and approval/decline cases; assert capture failure notification does not reverse the UI decision.
7. Implement owner-aware evaluation after `tool.requested`, call `ctx.ui.confirm`, and return Pi's documented blocking shape. Do not mutate `event.input`.
8. Run focused tests GREEN, `npm run check`, and commit `feat: require approval for recursive deletion`.

### Task 5: Project decision evidence through CLI and browser

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/cli.test.ts`
- Modify: `src/browse-view.test.ts` only if layout-specific regression coverage is needed

**Steps:**
1. Write failing timeline tests for evaluated/requested/approved/declined/blocked events, with wording that says BashGuard-observed rather than resolved.
2. Write failing inspection tests for command, cwd, matched check, reason, impact, source, limitations, authorization choice, and block cause.
3. Write failing filter tests so authorization events are reachable through relevant risk/tool activity and exact event type.
4. Write failing debrief tests for approval-request, approval, decline, and block counts/notes without synthetic completion or containment claims.
5. Implement the smallest projection/debrief changes using only recorded payload fields.
6. Run focused tests GREEN and commit `feat: explain recorded authorization decisions`.

### Task 6: Integration and real Pi validation

**Files:**
- Create: `src/authorization.integration.test.ts`
- Optionally create: `scripts/authorization-smoke/` only if deterministic reusable orchestration is needed

**Steps:**
1. Add an integration fixture that exercises the actual extension handler and CLI reader against one JSONL session; assert blocked and approved evidence is inspectable in append order.
2. Start an isolated non-interactive Pi session with `--no-extensions -e .`, an available OpenAI model, and a fresh temporary target. Instruct Pi to request recursive forced deletion only inside that target.
3. Verify unavailable approval returns a block and the target remains. Inspect/debrief the recorded session using exact `--session-id`.
4. If deterministic interactive automation is feasible, run a real PTY approval/decline smoke against another disposable target; otherwise document the exact limitation and rely on the tested Pi adapter plus noninteractive real-Pi block.
5. Verify safe Bash commands and the other three existing risk notices remain non-blocking.
6. Commit `test: validate recursive deletion authorization`.

### Task 7: Documentation and deferred-work ledger

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/current-state.md`
- Modify: `docs/product/roadmap.md`
- Modify: `docs/product/requirements.md` only if wording must distinguish observed from resolved
- Modify: `docs/architecture/event-model.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/research/pi-capability-matrix.md`
- Modify: `docs/testing/milestone-0-smoke-checklist.md`
- Modify: `docs/release/checklist.md`
- Modify: `skills/bashguard/SKILL.md`
- Modify: `docs/plans/2026-08-22-recursive-delete-approval-design.md`

**Steps:**
1. Document the exact rule, Run once/Decline semantics, no-UI/error blocking, owner-only behavior, and authorization-not-containment boundary.
2. Replace “non-blocking only” statements narrowly; preserve that all other current risk categories remain notices.
3. Link the design's deferred-work ledger from roadmap and current state. Keep visible: additional rules, user Bash/file/replacement tools, persistent policy, command identity/resolution, safer mutations, checkpoints/recovery, secret-aware persistence, sandbox/network/downstream controls.
4. Mark issue #87/Slice 1 complete only after real-session evidence and review; select the next slice explicitly rather than deleting deferred items.
5. Run `git diff --check` and commit `docs: document recursive deletion approval`.

### Task 8: Review and delivery gate

**Steps:**
1. Run `npm test`, `npm run check`, `npm audit`, and `git diff --check origin/main...HEAD`.
2. Request an independent OpenAI review against the approved design and this plan; fix every Critical/Important finding test-first.
3. Rerun the complete gate and repeated targeted authorization/PTY tests.
4. Prepare a PR closing #87 with exact real-Pi evidence, explicit unsupported scope, and proof that safe/plain workflows remain unchanged.
