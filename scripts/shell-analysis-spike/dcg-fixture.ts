export const DCG_FIXTURE_PROTOCOL_VERSION = 1 as const;

export type DcgProcessSurface = "robot-test" | "classify" | "explain";
export type DcgProtocolDecision = "allow" | "deny" | "warn" | "block" | "ask" | "indeterminate";
export type DcgStdoutShape = "json" | "empty" | "json-with-trace";
export type DcgStderrShape = "silent" | "human" | "diagnostic";
export type DcgRepositoryVerification = "not-claimed";

export interface DcgFixtureExpectation {
  readonly surface: DcgProcessSurface;
  readonly decision: DcgProtocolDecision;
  readonly exitCodes: readonly number[];
  readonly stdoutShape: DcgStdoutShape;
  readonly stderrShape: DcgStderrShape;
  readonly repositoryVerification: DcgRepositoryVerification;
  readonly notes: readonly string[];
}

export interface DcgFixture {
  readonly id: string;
  readonly title: string;
  readonly command: string;
  readonly expectation: DcgFixtureExpectation;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

function fixture(fixtureValue: DcgFixture): DcgFixture {
  return deepFreeze(fixtureValue);
}

const fixtures = [
  fixture({
    id: "dg-001-robot-allow-status",
    title: "Robot test keeps a safe status command quiet and allow-shaped",
    command: "git status",
    expectation: {
      surface: "robot-test",
      decision: "allow",
      exitCodes: [0],
      stdoutShape: "json",
      stderrShape: "silent",
      repositoryVerification: "not-claimed",
      notes: [
        "The adapter may record the decision, but it must not claim Git repository verification.",
      ],
    },
  }),
  fixture({
    id: "dg-002-robot-deny-reset-hard",
    title: "Robot test blocks destructive Git history rewriting",
    command: "git reset --hard",
    expectation: {
      surface: "robot-test",
      decision: "deny",
      exitCodes: [1],
      stdoutShape: "json",
      stderrShape: "human",
      repositoryVerification: "not-claimed",
      notes: [
        "Deny output should be machine-readable and keep the human explanation on stderr.",
      ],
    },
  }),
  fixture({
    id: "dg-003-classify-safe-status",
    title: "Classify reports a safe command without blocking it",
    command: "git status",
    expectation: {
      surface: "classify",
      decision: "allow",
      exitCodes: [0],
      stdoutShape: "json",
      stderrShape: "silent",
      repositoryVerification: "not-claimed",
      notes: [
        "Classification is advisory only; the adapter should not turn it into repository evidence.",
      ],
    },
  }),
  fixture({
    id: "dg-004-classify-force-push",
    title: "Classify surfaces destructive remote history rewriting",
    command: "git push --force origin main",
    expectation: {
      surface: "classify",
      decision: "block",
      exitCodes: [1],
      stdoutShape: "json",
      stderrShape: "diagnostic",
      repositoryVerification: "not-claimed",
      notes: [
        "The classification surface is distinct from the blocking surface and should stay explicit.",
      ],
    },
  }),
  fixture({
    id: "dg-005-explain-deep-inspection",
    title: "Explain exposes structured inspection for a destructive command",
    command: "git -C ./repo-a reset --hard HEAD~1",
    expectation: {
      surface: "explain",
      decision: "deny",
      exitCodes: [0],
      stdoutShape: "json-with-trace",
      stderrShape: "human",
      repositoryVerification: "not-claimed",
      notes: [
        "Deep inspection may expose trace or matched-span details, but not verified repository identity.",
      ],
    },
  }),
  fixture({
    id: "dg-006-segmented-chain",
    title: "Compound shell text stays one reviewed command string",
    command: "printf 'ok\\n' && git status; echo done",
    expectation: {
      surface: "robot-test",
      decision: "allow",
      exitCodes: [0],
      stdoutShape: "json",
      stderrShape: "silent",
      repositoryVerification: "not-claimed",
      notes: [
        "Segmented shell text is still just command text to the adapter; it does not prove later runtime behavior.",
      ],
    },
  }),
  fixture({
    id: "dg-007-quoted-danger-data",
    title: "Quoted destructive-looking text remains data",
    command: "echo 'git reset --hard'",
    expectation: {
      surface: "robot-test",
      decision: "allow",
      exitCodes: [0],
      stdoutShape: "json",
      stderrShape: "silent",
      repositoryVerification: "not-claimed",
      notes: [
        "The adapter must not treat quoted inert text as repository verification or shell execution proof.",
      ],
    },
  }),
] as const;

export function dcgFixtureProtocol(): readonly DcgFixture[] {
  return fixtures;
}

function assertSafeId(id: string): void {
  if (!/^dg-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`unsafe dcg fixture id: ${id}`);
}

export function validateDcgFixtureProtocol(fixtureSet: readonly DcgFixture[] = fixtures): readonly DcgFixture[] {
  const ids = new Set<string>();
  for (const entry of fixtureSet) {
    assertSafeId(entry.id);
    if (!ids.add(entry.id)) throw new Error(`duplicate dcg fixture id: ${entry.id}`);
    if (entry.title.trim().length === 0) throw new Error(`empty title for ${entry.id}`);
    if (entry.command.trim().length === 0) throw new Error(`empty command for ${entry.id}`);
    if (entry.command.includes("/Users/") || entry.command.includes("/private/tmp/") || entry.command.includes("/home/")) {
      throw new Error(`fixture ${entry.id} contains a host-specific path`);
    }
    const expectation = entry.expectation;
    if (!expectation.notes.length) throw new Error(`fixture ${entry.id} needs at least one note`);
    if (expectation.repositoryVerification !== "not-claimed") {
      throw new Error(`fixture ${entry.id} must not claim repository verification`);
    }
    if (!expectation.exitCodes.length) throw new Error(`fixture ${entry.id} must declare exit codes`);
    for (const code of expectation.exitCodes) {
      if (!Number.isInteger(code) || code < 0 || code > 255) {
        throw new Error(`fixture ${entry.id} has an invalid exit code: ${code}`);
      }
    }
    if (!(["robot-test", "classify", "explain"] as const).includes(expectation.surface)) {
      throw new Error(`fixture ${entry.id} has an invalid surface`);
    }
    if (!(["allow", "deny", "warn", "block", "ask", "indeterminate"] as const).includes(expectation.decision)) {
      throw new Error(`fixture ${entry.id} has an invalid decision`);
    }
    if (!(["json", "empty", "json-with-trace"] as const).includes(expectation.stdoutShape)) {
      throw new Error(`fixture ${entry.id} has an invalid stdout shape`);
    }
    if (!(["silent", "human", "diagnostic"] as const).includes(expectation.stderrShape)) {
      throw new Error(`fixture ${entry.id} has an invalid stderr shape`);
    }
    for (const note of expectation.notes) {
      if (note.trim().length === 0) throw new Error(`fixture ${entry.id} contains an empty note`);
    }
  }
  return deepFreeze([...fixtureSet]);
}
