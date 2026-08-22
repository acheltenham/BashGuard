# Boundary Reporting Slice 1 Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Add a read-only `bashguard boundary` command that honestly reports when BashGuard detects no supported containment backend, without claiming that no outer boundary exists.

**Architecture:** A new pure `src/boundary.ts` module owns the two-method `SandboxAdapter` contract, the deterministic `NoSandboxAdapter`, and width-aware plain-text formatting. `src/cli.ts` only validates/dispatches the session-independent command and writes the formatted report; no session JSONL, debrief, doctor, Pi extension, or sandbox configuration behavior changes in this slice.

**Tech Stack:** TypeScript, Node.js built-ins, Node test runner, existing BashGuard CLI wrapper.

---

### Task 1: Define the adapter contract and no-backend description

**Files:**
- Create: `src/boundary.ts`
- Create: `src/boundary.test.ts`

**Step 1: Write the failing contract test**

Create `src/boundary.test.ts` with a test that imports `NoSandboxAdapter`, calls both methods, and expects a structured, immutable-by-convention description:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { NoSandboxAdapter } from "./boundary.ts";

test("NoSandboxAdapter reports only that no supported boundary was detected", async () => {
  const adapter = new NoSandboxAdapter();

  assert.deepEqual(await adapter.describe(), {
    adapterId: "none-detected",
    evidence: "unknown",
    isolation: "none detected",
    mediatedTools: [],
    filesystem: "no supported restrictions detected",
    network: "no supported restrictions detected",
    implications: [
      "Without an outer boundary, Pi tools run with the permissions of your user account.",
    ],
    notCovered: [
      "any outer container or VM, which BashGuard cannot characterize from inside",
      "downstream authority of credentials available to the session",
    ],
  });
  assert.deepEqual(await adapter.observe([]), []);
});
```

The test must assert `evidence: "unknown"`, not `observed`, because absence cannot be observed from inside a possible outer boundary.

**Step 2: Run the test to verify RED**

Run:

```bash
node --experimental-strip-types --test src/boundary.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/boundary.ts`.

**Step 3: Implement the minimal contract and adapter**

Create `src/boundary.ts` with these public types and implementation:

```ts
export type BoundaryEvidence = "observed" | "reported" | "unknown";

export type SandboxDecision = {
  toolCallId?: string;
  outcome: "allow" | "deny" | "violation";
  evidence: BoundaryEvidence;
  summary: string;
};

export type SandboxBoundaryDescription = {
  adapterId: string;
  evidence: BoundaryEvidence;
  isolation: string;
  mediatedTools: string[];
  filesystem: string;
  network: string;
  implications: string[];
  notCovered: string[];
};

export interface SandboxAdapter {
  describe(): Promise<SandboxBoundaryDescription>;
  observe(events: readonly unknown[]): Promise<SandboxDecision[]>;
}

export class NoSandboxAdapter implements SandboxAdapter {
  async describe(): Promise<SandboxBoundaryDescription> {
    return {
      adapterId: "none-detected",
      evidence: "unknown",
      isolation: "none detected",
      mediatedTools: [],
      filesystem: "no supported restrictions detected",
      network: "no supported restrictions detected",
      implications: [
        "Without an outer boundary, Pi tools run with the permissions of your user account.",
      ],
      notCovered: [
        "any outer container or VM, which BashGuard cannot characterize from inside",
        "downstream authority of credentials available to the session",
      ],
    };
  }

  async observe(_events: readonly unknown[]): Promise<SandboxDecision[]> {
    return [];
  }
}
```

Do not read configuration, inspect environment/container hints, or add other adapters.

**Step 4: Run the focused test to verify GREEN**

Run:

```bash
node --experimental-strip-types --test src/boundary.test.ts
```

Expected: 1 test passes.

**Step 5: Commit**

```bash
git add src/boundary.ts src/boundary.test.ts
git commit -m "feat: define sandbox boundary adapter"
```

### Task 2: Format wide and narrow boundary reports without dropping limitations

**Files:**
- Modify: `src/boundary.ts`
- Modify: `src/boundary.test.ts`

**Step 1: Write failing formatter tests**

Add tests for `formatBoundaryReport(description, columns)` using the `NoSandboxAdapter` description.

At 80 columns, assert headings and aligned labels:

```text
Boundary

  Isolation      none detected · unknown
  Mediated       nothing
  Filesystem     no supported restrictions detected
  Network        no supported restrictions detected

What this means

  - Without an outer boundary, Pi tools run with the permissions of your user account.

Not covered by this boundary

  - any outer container or VM, which BashGuard cannot characterize from inside
  - downstream authority of credentials available to the session
```

At 39 columns, assert the formatter switches to stacked labels (`Isolation\n  none detected · unknown`) while retaining both `Not covered` entries. In both outputs assert there are no ANSI escape bytes and no sentence claiming that no sandbox or containment boundary exists.

**Step 2: Run the test to verify RED**

Run:

```bash
node --experimental-strip-types --test src/boundary.test.ts
```

Expected: FAIL because `formatBoundaryReport` is not exported.

**Step 3: Implement minimal width-aware formatting**

Add `formatBoundaryReport(description, columns = 80): string` to `src/boundary.ts`.

- Normalize non-finite/non-positive widths to 80.
- At 60+ columns, render four aligned rows.
- Below 60 columns, render each label and value on separate lines.
- Render all implication and limitation bullets in both layouts.
- Use ordinary text only; do not add color, ANSI, terminal mode detection, or truncation.
- Render mediated tools as `nothing` when the list is empty.

Keep line construction pure and deterministic so redirected and TTY output share evidence semantics.

**Step 4: Run focused tests to verify GREEN**

Run:

```bash
node --experimental-strip-types --test src/boundary.test.ts
```

Expected: all boundary tests pass.

**Step 5: Commit**

```bash
git add src/boundary.ts src/boundary.test.ts
git commit -m "feat: format containment boundary report"
```

### Task 3: Add the session-independent `bashguard boundary` command

**Files:**
- Modify: `src/cli.ts:1-15,150-300,2332-2349`
- Modify: `src/cli.test.ts:1-10,630-715`

**Step 1: Write failing parser and CLI tests**

In `src/cli.test.ts`:

1. Assert `parseCommandArgs(["boundary"])` returns `{ command: "boundary" }`.
2. Assert positional arguments and options fail before dispatch, for example `boundary session-a` and `boundary --session=1`.
3. Spawn `src/cli.ts boundary` with redirected stdout and assert:
   - exit status 0;
   - empty stderr;
   - stdout contains `Boundary`, `none detected · unknown`, the conditional full-user-permission explanation, and the outer-container limitation;
   - stdout does not contain ANSI or `Session`/debrief output.
4. Extend the usage test to require `bashguard boundary`.

**Step 2: Run focused tests to verify RED**

Run:

```bash
node --experimental-strip-types --test --test-name-pattern="boundary|CLI usage" src/cli.test.ts
```

Expected: FAIL because `boundary` is not dispatched or advertised and accepts invalid arguments.

**Step 3: Implement minimal CLI wiring**

In `src/cli.ts`:

- Import `formatBoundaryReport` and `NoSandboxAdapter` from `./boundary.ts`.
- Add `bashguard boundary` to `usage()`.
- In `parseCommandArgs`, reject every argument when `command === "boundary"` with a concise error such as `` `bashguard boundary` does not accept arguments ``.
- Add a private async runner that calls `NoSandboxAdapter.describe()`, formats with `terminalColumns(process.stdout)`, and writes exactly one trailing newline.
- Dispatch `boundary` before all session commands in `main()`.

Do not touch debrief, doctor, session selection, event recording, or extension behavior.

**Step 4: Run focused and full tests to verify GREEN**

Run:

```bash
node --experimental-strip-types --test --test-name-pattern="boundary|CLI usage" src/cli.test.ts
npm test
npm run check
```

Expected: focused tests pass, then the complete suite and TypeScript check pass.

**Step 5: Commit**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat: add boundary reporting command"
```

### Task 4: Document the shipped slice and preserve the restart sequence

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/current-state.md`
- Modify: `docs/product/roadmap.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/research/pi-capability-matrix.md`
- Modify: `docs/plans/2026-08-22-sandbox-adapter-and-boundary-reporting-design.md`
- Modify: `docs/release/checklist.md`
- Modify: `skills/bashguard/SKILL.md`

**Step 1: Update capability documentation**

Document only shipped Slice 1 behavior:

- add `bashguard boundary` to command lists and the bundled skill;
- state that it reports the current environment, not a historical session;
- state that `NoSandboxAdapter` means no **supported** boundary was detected, not that none exists;
- state that no ASRT adapter, configuration detection, decision observation, session-time evidence, or debrief section has shipped;
- update the architecture and capability matrix to distinguish the adapter contract from later backend integrations;
- add a release-checklist smoke asserting exit 0, no ANSI in redirected output, detected-not-absent wording, and the outer-boundary limitation;
- move the Changelog entry from “documentation only” wording by adding an `Added` item for the command while preserving the architectural `Changed` entry.

**Step 2: Update progress tracking without skipping queued work**

In `docs/product/roadmap.md`:

1. Mark Boundary Reporting Slice 1 complete.
2. Mark Command Resolution Spike 2 as next.
3. Leave the split-pane browser explicitly queued immediately after Spike 2.

In the boundary design, mark Slice 1 implemented with the completion date and keep ASRT/session/debrief work deferred. Do not mark all of Phase 2.5 complete.

**Step 3: Run documentation and CLI verification**

Run:

```bash
git diff --check
./bin/bashguard boundary
./bin/bashguard boundary | perl -ne 'exit 1 if /\e\[/'
./bin/bashguard boundary unexpected-argument >/tmp/bashguard-boundary.out 2>/tmp/bashguard-boundary.err; test $? -ne 0
npm test
npm run check
npm audit
```

Expected:

- wide report includes every limitation;
- redirected report contains no ANSI;
- unexpected argument exits nonzero;
- diff check, tests, check, and audit pass.

**Step 4: Commit**

```bash
git add README.md CHANGELOG.md docs/current-state.md docs/product/roadmap.md docs/architecture/overview.md docs/research/pi-capability-matrix.md docs/plans/2026-08-22-sandbox-adapter-and-boundary-reporting-design.md docs/release/checklist.md skills/bashguard/SKILL.md
git commit -m "docs: document boundary reporting slice"
```

### Task 5: Final review and delivery gate

**Files:**
- Review all changed files

**Step 1: Review scope and evidence semantics**

Confirm from `git diff origin/main...HEAD` that:

- no sandbox is executed or configured;
- `NoSandboxAdapter` never claims absence;
- `evidence` is `unknown` for the no-detection result;
- the report conditions full-user-permission exposure on the lack of an outer boundary;
- no historical-session or debrief claim was added;
- no unrelated Phase 1 or Phase 3 behavior changed.

**Step 2: Run the complete fresh verification gate**

Run:

```bash
npm test
npm run check
npm audit
git diff --check origin/main...HEAD
```

Expected: all tests pass, TypeScript reports no errors, audit reports zero vulnerabilities, and diff check reports no whitespace errors.

**Step 3: Perform manual smoke**

Run:

```bash
./bin/bashguard boundary
./bin/bashguard boundary | grep -F "any outer container or VM"
./bin/bashguard boundary | grep -F "Without an outer boundary"
```

Expected: command succeeds and both evidence-limitation lines are present.

**Step 4: Request review before integration**

Review the implementation against the approved Slice 1 design and this plan. Fix every important finding and rerun the complete verification gate before opening a pull request.
