# Split-Pane Event Browser Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Add an opt-in, keyboard-driven `bashguard inspect [session] --browse` snapshot browser while preserving every existing plain-text and JSONL workflow.

**Architecture:** A pure browser model owns selection/filter/search/focus state, a pure view renders complete width/height-bounded frames, and a terminal adapter exclusively owns raw mode, alternate screen, cursor visibility, key decoding, redraw serialization, resize, and restoration. CLI wiring supplies existing BashGuard evidence projectors to avoid duplicate semantics and keeps `--browse` explicitly opt-in.

**Tech Stack:** TypeScript, Node.js streams/readline primitives, `string-width`, `Intl.Segmenter`, Node test runner, existing portable PTY harness.

---

### Task 1: Browser model transitions

**Files:**
- Create: `src/browse-model.ts`
- Create: `src/browse-model.test.ts`

**Steps:**
1. Write failing tests for initial narrated selection, empty snapshots, up/down and page clamping, first/last, split focus, narrow detail open/close, detail scroll bounds, activity cycling including `all-recorded`, search match navigation/wraparound, clear precedence, and reload preserving selection by event ID.
2. Run `node --experimental-strip-types --test src/browse-model.test.ts` and verify module-not-found RED.
3. Implement immutable transitions over structural `BashGuardEvent` values. Inject `isNarrated`, `matchesActivity`, and `matchesSearch` callbacks so the model does not import `cli.ts` at runtime.
4. Run focused tests GREEN.
5. Commit `feat: add event browser model`.

### Task 2: Width- and height-bounded frame rendering

**Files:**
- Create: `src/browse-view.ts`
- Create: `src/browse-view.test.ts`

**Steps:**
1. Write failing tests for exactly 80-column split and 79-column single pane, 45% detail clamp (36–72), row compression order, selected marker, viewport following, detail scroll, status counts/filter/search, help overlay, 8-row minimum, CJK/emoji/combining bounds, and no line wider than the supplied display-cell width.
2. Verify RED.
3. Implement pure `renderBrowserFrame(model, dimensions, projectors)` returning exact lines. Reuse `string-width` and grapheme-safe truncation. Projectors provide existing timeline and inspection text; all-recorded rows fall back to event type.
4. Run GREEN and commit `feat: render split-pane browser frames`.

### Task 3: Terminal adapter lifecycle

**Files:**
- Create: `src/browse-terminal.ts`
- Create: `src/browse-terminal.test.ts`

**Steps:**
1. Write failing tests for arrow/page/enter/escape/tab/control-C decoding, alternate-screen/raw-mode/cursor sequences, whole-frame writes, write serialization, redraw coalescing, resize callbacks, normal quit restoration, thrown-error restoration, accepted-write failure best-effort restoration, EPIPE quiet exit, and scoped listener cleanup.
2. Verify RED.
3. Implement a terminal controller receiving frames and emitting named keys. Enter order: alternate screen, hide cursor, raw mode. Restore order: raw mode off, show cursor, leave alternate screen. On any write failure, attempt one idempotent restoration and stop further writes.
4. Run GREEN and commit `feat: add event browser terminal adapter`.

### Task 4: CLI parsing, capability policy, and browser loop

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/cli.test.ts`
- Create: `src/browse.integration.test.ts`

**Steps:**
1. Write failing tests that `--browse` is accepted only for inspect and conflicts with `--event`, `--activity`, `--type`, `--grep`, `--limit`, `--all`, and `--format`; all conflicts fail before session selection.
2. Write failing policy tests for stdin/stdout TTY, missing/dumb TERM, and rows below 8. Unsupported explicit browse exits nonzero with equivalent plain commands and no ANSI.
3. Snapshot existing plain inspect outputs before wiring and add byte-identical regression assertions.
4. Implement `shouldUseEventBrowser`, session selection through the existing one-snapshot path, snapshot loading, callback wiring to `eventMatchesActivity`, `formatTimelineEvent`, and `formatEventInspection`, explicit reload, input loop, and final exact `--session-id` inspect command after restoration.
5. Run focused tests, full `npm test`, and `npm run check`; commit `feat: add opt-in inspect browser`.

### Task 5: Real PTY behavior and failure paths

**Files:**
- Modify: `src/browse.integration.test.ts`
- Reuse: `src/test-process.ts`

**Steps:**
1. Add real PTY tests that open a fixture session, move selection, enter detail, search, cycle activity, reload, resize across 80/79, show/close help, and quit.
2. Assert transcript contains alternate-screen entry/exit, cursor hide/show, selected-event changes, and ends with the exact durable inspect command.
3. Add Ctrl+C and narrow-terminal flows; assert no residual raw mode or hidden cursor.
4. Verify redirected/non-TTY explicit browse emits no ANSI and exits nonzero.
5. Run the PTY test repeatedly and full suite; fix every failure test-first. Commit `test: validate split-pane browser in real terminals`.

### Task 6: Documentation and roadmap completion

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/current-state.md`
- Modify: `docs/product/roadmap.md`
- Modify: `docs/plans/2026-08-17-split-pane-event-browser-design.md`
- Modify: `docs/vision/terminal-ux.md`
- Modify: `docs/cli/evidence-filtering.md`
- Modify: `docs/testing/milestone-0-smoke-checklist.md`
- Modify: `docs/release/checklist.md`
- Modify: `skills/bashguard/SKILL.md`

**Steps:**
1. Document opt-in/snapshot semantics, exact keys, wide/narrow behavior, explicit reload, final inspect command, and unchanged plain paths.
2. Mark issue #85/browser slice complete and advance the authoritative roadmap sequence to Phase 3 authorization.
3. Run docs diff check and commit `docs: document split-pane event browser`.

### Task 7: Dogfood, review, and delivery gate

**Steps:**
1. Start a fresh isolated real Pi session using an available OpenAI model and the worktree extension; generate prompts, shell calls, and file-tool evidence without modifying tracked files.
2. Browse the recorded snapshot in a real PTY at wide and narrow widths; exercise navigation, search, filter, help, reload, and quit; inspect the selected event with the emitted durable command.
3. Run `npm test`, `npm run check`, `npm audit`, and `git diff --check origin/main...HEAD`.
4. Request an independent OpenAI review against both browser plans; fix Critical/Important findings test-first.
5. Prepare a PR with PTY evidence and explicit plain-output regression results.
