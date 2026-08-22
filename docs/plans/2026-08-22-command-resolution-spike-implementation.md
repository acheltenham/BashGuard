# Command Resolution Spike Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Build and run a disposable, reproducible probe harness that proves which command representation BashGuard can observe at each Pi hook and execution layer.

**Architecture:** Pure TypeScript modules define scenarios, parse temporary JSONL, and correlate probe records with BashGuard events. Tiny Pi probe extensions append stage evidence, while a runner creates disposable fixtures and starts isolated OpenAI-backed Pi sessions in deliberate extension orders. No production BashGuard event, CLI, extension, or storage behavior changes.

**Tech Stack:** TypeScript, Node.js built-ins and test runner, Pi 0.84.0 extension APIs, BashGuard JSONL, OpenAI Codex provider through the installed Pi CLI.

---

### Task 1: Define scenarios and validate temporary-root confinement

**Files:**
- Create: `scripts/command-resolution-spike/model.ts`
- Create: `scripts/command-resolution-spike/model.test.ts`

**Step 1: Write failing tests**

Test that `buildScenarioDefinitions(fixtureRoot)` returns these baseline scenarios with exact command strings and unique tokens:

- `simple`
- `pipeline`
- `chain`
- `prefix-env`
- `environment-load`
- `relative-path`
- `directory-change`
- `harmless-rm`

Also test ordering scenarios:

- `bashguard-before-mutator`
- `mutator-before-bashguard`
- `replacement-spawn-hook`

Assert every writable/deletable path resolves beneath `fixtureRoot`, every command contains its scenario token, and a fixture root containing a newline or NUL is rejected.

**Step 2: Run RED**

```bash
node --experimental-strip-types --test scripts/command-resolution-spike/model.test.ts
```

Expected: module-not-found failure.

**Step 3: Implement minimal scenario model**

Export:

```typescript
export type ScenarioKind = "baseline" | "ordering" | "replacement";
export type SpikeScenario = {
  name: string;
  kind: ScenarioKind;
  token: string;
  command: string;
  cwd: string;
  expectedRuntimeRecords: number;
  expectedMutation: boolean;
  expectedSpawnWrap: boolean;
};
export function buildScenarioDefinitions(fixtureRoot: string): SpikeScenario[];
export function assertPathWithinRoot(root: string, candidate: string): void;
```

Use absolute, shell-quoted fixture paths and controlled files created later by the runner. The harmless removal command may delete only `<fixtureRoot>/delete-target` and must execute the runtime recorder afterward.

**Step 4: Run GREEN**

```bash
node --experimental-strip-types --test scripts/command-resolution-spike/model.test.ts
```

Expected: all scenario tests pass.

**Step 5: Commit**

```bash
git add scripts/command-resolution-spike/model.ts scripts/command-resolution-spike/model.test.ts
git commit -m "test: define command resolution scenarios"
```

### Task 2: Parse probe and BashGuard evidence tolerantly

**Files:**
- Create: `scripts/command-resolution-spike/evidence.ts`
- Create: `scripts/command-resolution-spike/evidence.test.ts`

**Step 1: Write failing parser tests**

Test:

- valid probe JSONL records preserve append order;
- malformed complete lines are reported as diagnostics;
- an incomplete final line is ignored and reported;
- only allowlisted probe stages are accepted;
- BashGuard `tool.requested`, `tool.completed`, `session.started`, and `session.shutdown` records are extracted without reordering;
- ambient environment keys outside the approved sentinel set are rejected from runtime records.

**Step 2: Run RED**

```bash
node --experimental-strip-types --test scripts/command-resolution-spike/evidence.test.ts
```

Expected: module-not-found failure.

**Step 3: Implement minimal parsers**

Export:

```typescript
export type ProbeStage = "early_tool_call" | "late_tool_call" | "spawn_hook_input" | "spawn_hook_output" | "runtime_fixture";
export type ProbeRecord = {
  runId: string;
  scenario: string;
  stage: ProbeStage;
  toolCallId?: string;
  command?: string;
  cwd?: string;
  extensionOrder: string[];
  timestamp: string;
  token?: string;
  argv?: string[];
  stdin?: string;
  sentinels?: Partial<Record<"BASHGUARD_SPIKE_MUTATED" | "BASHGUARD_SPIKE_SPAWN" | "BASHGUARD_SPIKE_PREFIX" | "BASHGUARD_SPIKE_LOADED", string>>;
};
export function parseProbeJsonl(text: string): { records: ProbeRecord[]; diagnostics: string[] };
export function parseBashGuardJsonl(text: string): { events: BashGuardSpikeEvent[]; diagnostics: string[] };
```

Keep the parser local to the spike; do not import or alter production JSONL semantics.

**Step 4: Run GREEN**

```bash
node --experimental-strip-types --test scripts/command-resolution-spike/evidence.test.ts
```

**Step 5: Commit**

```bash
git add scripts/command-resolution-spike/evidence.ts scripts/command-resolution-spike/evidence.test.ts
git commit -m "test: parse command resolution evidence"
```

### Task 3: Correlate stages without inventing missing evidence

**Files:**
- Create: `scripts/command-resolution-spike/analyze.ts`
- Create: `scripts/command-resolution-spike/analyze.test.ts`

**Step 1: Write failing analyzer tests**

Build synthetic records for each ordering:

1. BashGuard before mutator: early and BashGuard command are original; late command is mutated.
2. Mutator before BashGuard: early command is original; BashGuard and late commands are mutated.
3. Replacement tool: early, BashGuard, and late commands match; spawn-hook output differs and runtime sees `BASHGUARD_SPIKE_SPAWN=1`.
4. Shell runtime scenario: runtime argv/cwd/sentinels are present but no extra pre-execution command text is invented.

Also test failures for model-command mismatch, missing shutdown, missing required stage, duplicate stage for one `toolCallId`, ambiguous BashGuard request, wrong scenario token, unexpected sentinel, and files outside the root.

**Step 2: Run RED**

```bash
node --experimental-strip-types --test scripts/command-resolution-spike/analyze.test.ts
```

**Step 3: Implement minimal analyzer**

Export:

```typescript
export type ScenarioAnalysis = {
  scenario: string;
  status: "passed" | "invalid" | "failed";
  toolCallId?: string;
  requested?: string;
  bashguardRecorded?: string;
  postHook?: string;
  spawnHookInput?: string;
  spawnHookOutput?: string;
  runtime: ProbeRecord[];
  findings: string[];
  diagnostics: string[];
};
export function analyzeScenario(input: AnalyzeScenarioInput): ScenarioAnalysis;
export function formatSanitizedMatrix(results: ScenarioAnalysis[]): string;
```

Every projected value must come directly from a record. The matrix uses `missing` rather than inference.

**Step 4: Run GREEN**

```bash
node --experimental-strip-types --test scripts/command-resolution-spike/analyze.test.ts
```

**Step 5: Commit**

```bash
git add scripts/command-resolution-spike/analyze.ts scripts/command-resolution-spike/analyze.test.ts
git commit -m "feat: correlate command resolution evidence"
```

### Task 4: Implement probe writers, extensions, and runtime fixture

**Files:**
- Create: `scripts/command-resolution-spike/probe-io.ts`
- Create: `scripts/command-resolution-spike/probe-io.test.ts`
- Create: `scripts/command-resolution-spike/extensions/early-observer.ts`
- Create: `scripts/command-resolution-spike/extensions/late-observer.ts`
- Create: `scripts/command-resolution-spike/extensions/mutator.ts`
- Create: `scripts/command-resolution-spike/extensions/replacement-bash.ts`
- Create: `scripts/command-resolution-spike/fixtures/runtime-fixture.mjs`

**Step 1: Write failing probe-I/O tests**

Test that the writer:

- requires probe path, run ID, scenario, and extension order from environment;
- appends one compact JSON object per line;
- rejects non-allowlisted sentinel names;
- creates no path outside the configured temporary root.

**Step 2: Run RED**

```bash
node --experimental-strip-types --test scripts/command-resolution-spike/probe-io.test.ts
```

**Step 3: Implement the writer and extensions**

- `early-observer.ts`: append `early_tool_call` for `bash` only.
- `late-observer.ts`: append `late_tool_call` for `bash` only.
- `mutator.ts`: prepend `export BASHGUARD_SPIKE_MUTATED=1; ` to `event.input.command` for `bash` only.
- `replacement-bash.ts`: override `bash` with `createBashTool()` and a `spawnHook` that records input, prepends `export BASHGUARD_SPIKE_SPAWN=1; `, records output, and preserves cwd/env.
- `runtime-fixture.mjs`: read bounded stdin, then append `runtime_fixture` with argv, cwd, token, and only the four approved sentinels.

All writes are append-only JSONL beneath the temporary root. No module starts background work.

**Step 4: Run GREEN and type-check through tests**

```bash
node --experimental-strip-types --test scripts/command-resolution-spike/probe-io.test.ts
npm run check
```

**Step 5: Commit**

```bash
git add scripts/command-resolution-spike
git commit -m "feat: add command resolution probe extensions"
```

### Task 5: Build the isolated Pi runner

**Files:**
- Create: `scripts/command-resolution-spike/run.ts`
- Create: `scripts/command-resolution-spike/run.test.ts`
- Modify: `package.json`

**Step 1: Write failing runner tests**

Inject a fake subprocess runner and assert:

- each attempt uses a fresh BashGuard data directory and probe JSONL path;
- `pi` receives `--no-extensions`, `--no-skills`, `--approve`, `--provider openai-codex`, `--model gpt-5.4-mini`, `--thinking off`, and `--tools bash`;
- extension arguments appear in the required order for each ordering scenario;
- BashGuard is loaded exactly once;
- the prompt quotes the exact expected command and forbids alternatives;
- timeout/nonzero/mismatch attempts fail visibly and retain artifact paths;
- retries are bounded;
- generated paths remain inside the run root.

**Step 2: Run RED**

```bash
node --experimental-strip-types --test scripts/command-resolution-spike/run.test.ts
```

**Step 3: Implement the runner**

Export testable orchestration functions and add a CLI entrypoint supporting:

```text
--root <temporary-root>
--scenario <name|all>
--model <openai-model>        default: gpt-5.4-mini
--max-attempts <n>            default: 2
--timeout-ms <n>              default: 120000
```

The runner:

1. creates controlled fixtures;
2. constructs extension order;
3. starts one print-mode Pi process per scenario attempt;
4. reads probe and BashGuard JSONL only after shutdown;
5. analyzes the scenario;
6. prints and writes a sanitized matrix;
7. exits nonzero if any scenario is not passed.

Add:

```json
"spike:command-resolution": "node --experimental-strip-types scripts/command-resolution-spike/run.ts"
```

**Step 4: Run GREEN**

```bash
node --experimental-strip-types --test scripts/command-resolution-spike/run.test.ts
npm test
npm run check
```

**Step 5: Commit**

```bash
git add scripts/command-resolution-spike/run.ts scripts/command-resolution-spike/run.test.ts package.json
git commit -m "feat: orchestrate command resolution spike"
```

### Task 6: Run the real OpenAI-backed matrix and investigate every anomaly

**Files:**
- Temporary only: `/tmp/bashguard-command-resolution-*`

**Step 1: Confirm OpenAI model availability**

```bash
pi --list-models | grep -E '^openai-codex[[:space:]]+gpt-5\.4-mini'
```

Expected: one available model row.

**Step 2: Run a single simple scenario**

```bash
npm run spike:command-resolution -- --root /tmp/bashguard-command-resolution-smoke --scenario simple
```

Inspect the temporary probe JSONL, BashGuard events, sanitized matrix, and session debrief. If any stage differs from expectation, stop and investigate before running the matrix.

**Step 3: Run the full matrix**

```bash
npm run spike:command-resolution -- --root /tmp/bashguard-command-resolution-full --scenario all
```

Expected: every scenario passes or produces an explicit diagnostic. Do not edit expectations to hide observed differences.

**Step 4: Independently inspect representative BashGuard evidence**

Use exact session IDs from the isolated data directories:

```bash
BASHGUARD_DATA_DIR=<scenario-data-dir> ./bin/bashguard inspect --session-id=<id> --activity shell --all
BASHGUARD_DATA_DIR=<scenario-data-dir> ./bin/bashguard inspect --session-id=<id> --event <tool-request-event>
BASHGUARD_DATA_DIR=<scenario-data-dir> ./bin/bashguard debrief --session-id=<id>
```

Confirm the sanitized matrix agrees with recorded events.

**Step 5: Commit only fixes to the harness**

If real evidence exposes a harness bug, reproduce it in a failing unit test before fixing. Never commit raw temporary evidence.

### Task 7: Publish sanitized findings and advance the roadmap

**Files:**
- Create: `docs/research/command-resolution-spike-results.md`
- Modify: `docs/research/pi-capability-matrix.md`
- Modify: `docs/product/roadmap.md`
- Modify: `docs/plans/2026-08-22-command-resolution-spike-design.md`
- Modify: `README.md` only if current limitation wording needs correction
- Modify: `CHANGELOG.md`
- Modify: `docs/current-state.md` only if current limitation wording needs correction

**Step 1: Write findings from the sanitized matrix**

Document:

- exact Pi and BashGuard versions/commits;
- platform and OpenAI model used;
- scenario matrix with each directly observed layer;
- extension-order finding;
- replacement-tool/spawnHook finding;
- shell-runtime findings;
- what BashGuard can safely preview before execution;
- what must remain unknown or runtime-dependent;
- product implications for Phase 3.

Do not quote raw provider responses, private paths, or ambient environment values.

**Step 2: Update tracking**

- Mark Spike 2 complete in the capability matrix and summarize the strongest proven claim.
- Mark the split-pane event browser as next/in progress in the roadmap queue.
- Mark the spike design complete and link the results.
- Add a Changelog `Changed` entry for the research result; do not claim user-facing command resolution shipped.
- Update issue #83 with the result and close it when merged.

**Step 3: Verify repository and artifact hygiene**

```bash
find . -type f \( -name 'events.jsonl' -o -name 'probe.jsonl' \) -not -path './node_modules/*' -print
```

Expected: no generated evidence files in the repository.

```bash
git diff --check
npm test
npm run check
npm audit
```

Expected: all pass.

**Step 4: Commit**

```bash
git add docs README.md CHANGELOG.md
git commit -m "docs: record command resolution spike findings"
```

### Task 8: Final review and delivery

**Step 1: Review scope**

```bash
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- src extensions
```

Expected: no production `src/` or `extensions/bashguard/` behavior changes; only spike scripts/tests and documentation.

**Step 2: Request independent review with OpenAI**

Use a spawned Pi review session with an available OpenAI model. Ask it to compare the implementation with both spike plans and categorize findings. Fix every Critical or Important issue test-first.

**Step 3: Run fresh final verification**

```bash
npm test
npm run check
npm audit
git diff --check origin/main...HEAD
```

**Step 4: Prepare a pull request**

Include the sanitized matrix, real Pi validation command, explicit non-goals, and the next roadmap item in the PR description.
