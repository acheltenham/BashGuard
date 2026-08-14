# Live-Updating Attach Footer Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Add a compact, adaptive, evidence-grounded sticky footer to active interactive `bashguard attach` while preserving existing completed and non-TTY plain-text output.

**Architecture:** Introduce a pure live-footer projection/formatter and a terminal-only controller that owns ANSI clear/redraw behavior. The existing attach loop remains responsible for JSONL transport and grounded status projection; it maintains one append-order event snapshot, rebuilds status after accepted events, and delegates presentation to the controller only in supported active TTY mode. Plain-text paths continue through existing formatters.

**Tech Stack:** TypeScript on Node.js, Node test runner, ANSI cursor control, structural TTY streams, existing `AttachStatus`/JSONL attach logic, Expect/system PTY integration tests.

---

### Task 1: Build compact live-footer projection and adaptive formatter

**Files:**
- Create: `src/live-footer.ts`
- Create: `src/live-footer.test.ts`
- Modify: `src/cli.ts` only if a small shared capture-summary helper is required

**Step 1: Write failing formatter tests**

Import proposed exports:

```ts
buildLiveFooterModel
formatLiveFooter
```

Cover:

- active unmatched request maps to `ACTIVE`, compact activity, and `awaiting completion evidence`;
- completed/latest recorded activity maps to `DONE` and `recorded`;
- no limitations maps to `capture ok`;
- partial capture maps to `capture partial` plus compact gap/truncated/missing counts when they fit;
- no capture metadata maps to an honest compact unknown label;
- 72+ columns returns three content lines plus a separator;
- 40–71 columns remains within width and no more than four content lines;
- below 40 columns returns one bounded status line;
- state/activity/evidence/capture/freshness/event-count priority removes event count first;
- long/multiline/control-character activity is sanitized and ellipsized without exceeding width;
- extremely small positive widths do not throw or emit over-width lines;
- ordinary Unicode is preserved when it fits.

**Step 2: Verify RED**

```bash
node --experimental-strip-types --test src/live-footer.test.ts
```

Expected: missing module/export failure.

**Step 3: Implement pure model and formatter**

Add types such as:

```ts
export type LiveFooterModel = {
  state: "ACTIVE" | "DONE";
  activity: string;
  evidence: "recorded" | "awaiting completion evidence" | "no activity evidence";
  capture: "capture ok" | "capture partial" | "capture unknown";
  captureDetails: string[];
  eventCount: number;
  freshness: string;
};
```

`buildLiveFooterModel(status: AttachStatus)` must reuse existing grounded status output rather than infer execution. Map exact existing evidence/capture semantics; if parsing existing capture wording becomes brittle, extract one shared structured capture summary from `buildAttachStatus` internals without changing public plain-text output.

`formatLiveFooter(model, columns)` returns an array of lines including a separator. Use `singleLineDisplay`, a width-aware truncate helper, and compact tokens. No ANSI or I/O belongs here.

Implementation divergence: the initial JavaScript string-length approximation was replaced before completion with the `string-width` runtime dependency plus `Intl.Segmenter` grapheme boundaries. Formatter tests therefore assert measured terminal display-cell bounds for ASCII, CJK, combining text, and emoji.

**Step 4: Verify GREEN**

```bash
node --experimental-strip-types --test src/live-footer.test.ts src/cli.test.ts
npm run check
git diff --check
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/live-footer.ts src/live-footer.test.ts src/cli.ts src/cli.test.ts
git commit -m "feat: format compact live attach footer"
```

---

### Task 2: Implement terminal footer controller

**Files:**
- Modify: `src/live-footer.ts`
- Modify: `src/live-footer.test.ts`

**Step 1: Write failing controller tests**

Use a real `PassThrough` or recording writable stream and injected clock/width provider. Import proposed `LiveFooterController` or `createLiveFooterController`.

Cover:

- first render writes footer lines and tracks rendered line count;
- clearing one and multiple lines emits exact cursor-up/carriage-return/erase sequences;
- `writeTimeline()` clears footer, writes exactly one timeline payload/newline, then redraws footer;
- a changed model redraws immediately;
- unchanged model before one second does not redraw;
- unchanged model at/after one second redraws freshness;
- resize/width change forces one redraw with new bounded layout;
- cleanup clears temporary lines and leaves exactly one normal newline position;
- repeated cleanup is idempotent;
- write failure propagates ordinary errors but identifies `EPIPE` for caller degradation;
- controller never emits alternate-screen or cursor-hide sequences.

**Step 2: Verify RED**

```bash
node --experimental-strip-types --test --test-name-pattern='controller|timeline|redraw|cleanup' src/live-footer.test.ts
```

Expected: missing controller API.

**Step 3: Implement controller**

The controller should own:

- current model;
- rendered line count;
- last render time;
- current width;
- output stream;
- renderer and clock injections.

Use explicit constants for ANSI erase-line and cursor-up. Render footer without a trailing newline so the cursor remains on the final footer line. Clearing must remove only the tracked footer region and return the cursor to its first line. `writeTimeline` must preserve ordering under synchronous `write()` calls.

Do not register process signals or resize listeners inside the pure controller; expose `resize()`, `cleanup()`, and state needed by attach integration.

**Step 4: Verify GREEN**

```bash
node --experimental-strip-types --test src/live-footer.test.ts
npm run check
git diff --check
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/live-footer.ts src/live-footer.test.ts
git commit -m "feat: add terminal footer controller"
```

---

### Task 3: Add CLI option and sticky-mode policy

**Files:**
- Modify: `src/cli.ts` argument types/parser/usage
- Modify: `src/cli.test.ts`

**Step 1: Write failing parser/policy tests**

Cover:

```text
bashguard attach --no-live-footer
bashguard attach 1 --no-live-footer
```

and reject the flag for inspect/debrief/sessions.

Add a pure proposed `shouldUseLiveFooter` policy covering:

- active + stdout TTY + nonempty non-dumb TERM + no opt-out => true;
- completed => false;
- non-TTY => false;
- missing TERM => false;
- `TERM=dumb` case-insensitive => false;
- opt-out => false.

**Step 2: Verify RED**

```bash
node --experimental-strip-types --test --test-name-pattern='live footer|no-live-footer' src/cli.test.ts
```

Expected: parser/policy failure.

**Step 3: Implement parser and policy**

Add `noLiveFooter?: boolean` to parsed options. Update usage and enforce attach-only scope consistently with history options. Export a pure policy whose inputs are explicit rather than reading globals in tests.

No attach rendering changes in this task.

**Step 4: Verify GREEN**

```bash
node --experimental-strip-types --test src/cli.test.ts
npm run check
git diff --check
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat: add live footer mode policy"
```

---

### Task 4: Integrate footer into active attach event flow

**Files:**
- Modify: `src/cli.ts` attach implementation
- Modify: `src/attach-history.integration.test.ts`
- Create: `src/live-footer.integration.test.ts`

**Step 1: Write failing integration tests**

Build temporary active session stores and invoke attach through an exported/injectable runner or subprocess/PTY as appropriate.

Cover:

- supported active TTY mode replaces the startup static status block with footer output;
- header, bounded history, and guidance print before footer;
- newly appended narrated event appears above a redrawn footer;
- non-narrated accepted events still update event count/freshness/capture/current status;
- request then matching completion changes `awaiting completion evidence` to recorded last activity;
- append-order event snapshot includes every accepted valid event exactly once;
- malformed complete lines and partial final lines do not update footer until valid completion;
- `--history 0` still follows all new events;
- non-TTY active attach remains free of footer ANSI and retains existing static status output;
- `--no-live-footer` and `TERM=dumb` retain existing output;
- completed attach retains existing output byte shape except documented guidance changes.

**Step 2: Verify RED**

```bash
node --experimental-strip-types --test src/live-footer.integration.test.ts
```

Expected: no sticky integration.

**Step 3: Refactor attach minimally**

In attach:

1. build initial complete event snapshot;
2. choose sticky mode after active state is grounded;
3. plain mode preserves existing writes;
4. sticky mode prints header/history/guidance then creates controller and renders footer;
5. each parsed accepted event is normalized and appended once to the snapshot;
6. timeline narration goes through `controller.writeTimeline()`;
7. rebuild `AttachStatus`/footer model after accepted event batches;
8. on idle polls, request refresh only when one second has elapsed;
9. preserve current offset/remainder/StringDecoder/restart behavior.

Avoid broad transport refactoring. Keep complete JSONL evidence and seen-event behavior unchanged.

**Step 4: Verify GREEN**

```bash
node --experimental-strip-types --test src/live-footer.integration.test.ts src/attach-history.integration.test.ts
npm test
npm run check
git diff --check
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/cli.ts src/live-footer.integration.test.ts src/attach-history.integration.test.ts
git commit -m "feat: render live status footer during attach"
```

---

### Task 5: Add resize, shutdown, interruption, and degraded cleanup

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/live-footer.ts`
- Modify: `src/live-footer.test.ts`
- Modify: `src/live-footer.integration.test.ts`
- Modify if shared process helper is useful: `src/test-process.ts`

**Step 1: Write failing lifecycle tests**

Cover:

- output `resize` event recalculates width and redraws once;
- resize listeners are removed after attach finishes;
- recorded shutdown clears sticky footer and prints one final ordinary completed status block;
- PID-death completion without shutdown also finalizes honestly;
- recorder replacement continues without finalizing early;
- Ctrl+C clears footer, leaves newline, exits/detaches without stack trace, and removes handlers;
- ordinary unexpected errors clear footer before propagating to main error formatting;
- `EPIPE` does not recurse through cleanup or print a stack trace;
- cleanup is safe if footer was never rendered or output already failed.

Use injected streams/events and PTY subprocesses rather than mutating process globals in parallel tests where possible.

**Step 2: Verify RED**

```bash
node --experimental-strip-types --test --test-name-pattern='resize|shutdown|SIGINT|EPIPE|cleanup|replacement' src/live-footer*.test.ts
```

Expected: lifecycle gaps.

**Step 3: Implement scoped lifecycle adapter**

Attach should register only the listeners it needs and remove them in `finally`:

- stdout `resize` when available;
- scoped SIGINT handling that cleans the footer and causes attach to return/exit with conventional interruption status without leaving the loop alive;
- existing EPIPE behavior coordinated so footer cleanup does not write repeatedly to a closed stream.

On finalization:

1. clear temporary footer;
2. rebuild completed status from the final snapshot/process evidence;
3. print one ordinary `formatAttachStatus()` block when output remains writable;
4. leave terminal on a normal newline.

If ANSI writes fail or capabilities become unusable, disable sticky rendering and continue visibly in plain mode where safe; never invent events or state.

**Step 4: Verify GREEN**

```bash
node --experimental-strip-types --test src/live-footer.test.ts src/live-footer.integration.test.ts src/attach-history.integration.test.ts
npm test
npm run check
git diff --check
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/cli.ts src/live-footer.ts src/live-footer.test.ts src/live-footer.integration.test.ts src/attach-history.integration.test.ts src/test-process.ts
git commit -m "fix: clean up live footer lifecycle"
```

---

### Task 6: Add real PTY width and live-update coverage

**Files:**
- Modify: `src/live-footer.integration.test.ts`
- Modify: `src/session-selection.integration.test.ts` only to share PTY utilities if necessary
- Modify: `src/test-process.ts` if a portable helper is extracted

**Step 1: Write failing PTY tests**

Through `bin/bashguard`, cover:

- active attach in an 80-column PTY renders full compact footer;
- appending request/completion events updates footer and keeps timeline event above it;
- PTY resize to approximately 50 columns redraws bounded medium layout;
- resize below 40 columns yields one bounded line;
- shutdown leaves a final ordinary completed block and exits;
- `Ctrl+C` leaves no cursor-hide/alternate-screen sequences or dangling footer fragment;
- `--no-live-footer` in a PTY produces ordinary static status and no footer erase/up sequences;
- redirected stdout contains no footer ANSI sequences.

Use Expect/system `script` with bounded waits and platform-aware skipping, following existing PTY test patterns. Do not add a native PTY dependency in this slice.

**Step 2: Verify RED**

```bash
node --experimental-strip-types --test --test-name-pattern='PTY|width|resize|no-live-footer' src/live-footer.integration.test.ts
```

Expected: missing PTY behavior.

**Step 3: Implement minimal test utilities/fixes**

Adjust production only for defects exposed by realistic PTY behavior. Keep test helpers bounded and diagnostic on timeout.

**Step 4: Verify GREEN**

```bash
node --experimental-strip-types --test src/live-footer.integration.test.ts
npm test
npm run check
git diff --check
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/live-footer.integration.test.ts src/session-selection.integration.test.ts src/test-process.ts src/cli.ts src/live-footer.ts
git commit -m "test: validate live footer in real terminals"
```

---

### Task 7: Update documentation and project tracking

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
- Modify if implementation differs: `docs/plans/2026-08-14-live-attach-footer-design.md`
- External: issue `#77`, parent `#61`

**Step 1: Document actual behavior**

Cover:

- TTY-only active sticky footer;
- compact vocabulary and adaptive width;
- event-driven updates plus one-second freshness;
- evidence-grounded current/last activity;
- final ordinary completed status;
- plain behavior for completed/non-TTY/missing or dumb `TERM`;
- `--no-live-footer`;
- no alternate screen/full TUI;
- display-cell and grapheme-aware width behavior (replacing the original approximation);
- exact commands for smoke validation.

Keep v0.4.0 install pins until a later release exists.

**Step 2: Update roadmap/checklists/skill**

Mark the live footer slice implemented only after real PTY tests pass. Add wide/narrow/resize/shutdown/Ctrl+C/non-TTY/opt-out checks. Teach the skill that attach may maintain temporary ANSI footer output only in supported interactive terminals, while inspect/JSONL remain unchanged.

**Step 3: Verify docs**

```bash
rg -n "live footer|no-live-footer|TERM=dumb|resize|split-pane" README.md docs skills/bashguard/SKILL.md
npm test
npm run check
git diff --check
```

Expected: PASS with no stale startup-only claim.

**Step 4: Commit**

```bash
git add README.md CHANGELOG.md docs skills/bashguard/SKILL.md
git commit -m "docs: explain live attach footer"
```

---

### Task 8: Final real-session validation and delivery

**Files:**
- Modify only if evidence requires: docs/checklists or tests
- External: issue `#77`, parent `#61`, implementation PR

**Step 1: Run real Pi active-session smoke**

Use isolated `BASHGUARD_DATA_DIR` and local package worktree. Validate in a real PTY:

- active footer appears after bounded history/guidance;
- long current activity is compact rather than jumbled;
- request/completion changes evidence wording;
- freshness updates near one-second cadence without 250 ms flicker;
- wide, medium, and narrow resize behavior;
- timeline event appears above footer;
- shutdown produces final ordinary completed status;
- Ctrl+C cleanup;
- `--no-live-footer`, redirect, and `TERM=dumb` remain plain text with no footer-generated ANSI/cursor-control sequences; arbitrary recorded payload bytes are outside that claim.

Record only sanitized output.

**Step 2: Run full gate**

```bash
npm test
npm run check
npm audit
npm run baseline:milestone-0 -- --samples 25
git diff --check
git status --short
```

Expected: all tests pass, zero known audit vulnerabilities, baseline completes, and worktree is clean.

**Step 3: Request two-stage and final reviews**

Review for:

- evidence grounding and append-order snapshot correctness;
- ANSI line accounting/cursor safety;
- width budgets and untrusted text sanitization;
- signal/listener cleanup;
- EPIPE and degradation;
- byte-clean non-TTY output;
- no full-TUI scope creep.

Fix Critical/Important findings test-first and rerun the complete gate.

**Step 4: Push and open PR**

```bash
git push -u origin feat/live-attach-footer
gh pr create --base main --head feat/live-attach-footer
```

Close `#77` and update `#61` with automated and real-session evidence.

**Step 5: Finish branch**

After merge, verify `main`, remove the worktree, and prune/delete the feature branch using the finishing-a-development-branch workflow.
