import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function validateRoot(root: string): string {
  if (!isAbsolute(root)) throw new Error("command resolution fixture root must be absolute");
  if (/\p{Cc}/u.test(root)) throw new Error("command resolution fixture root must not contain control characters");
  return resolve(root);
}

function canonicalPath(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync.native(resolved);
  } catch {
    const parent = dirname(resolved);
    if (parent === resolved) return resolved;
    return join(canonicalPath(parent), basename(resolved));
  }
}

export function assertPathWithinRoot(root: string, candidate: string): void {
  const resolvedRoot = canonicalPath(root);
  const resolvedCandidate = canonicalPath(candidate);
  const offset = relative(resolvedRoot, resolvedCandidate);
  if (offset === "" || (!offset.startsWith("..") && !isAbsolute(offset))) return;
  throw new Error(`path is outside temporary root: ${resolvedCandidate}`);
}

export function buildScenarioDefinitions(fixtureRoot: string): SpikeScenario[] {
  const root = validateRoot(fixtureRoot);
  const fixture = join(root, "runtime-fixture.mjs");
  const envFile = join(root, "spike-env.sh");
  const nested = join(root, "nested");
  const deleteTarget = join(root, "delete-target");
  for (const path of [fixture, envFile, nested, deleteTarget]) assertPathWithinRoot(root, path);

  const runtime = (token: string, label: string, ...args: string[]) =>
    ["node", shellQuote(fixture), shellQuote(token), shellQuote(label), ...args.map(shellQuote)].join(" ");
  const scenario = (
    name: string,
    command: string,
    options: Partial<Pick<SpikeScenario, "kind" | "expectedRuntimeRecords" | "expectedMutation" | "expectedSpawnWrap">> = {},
  ): SpikeScenario => ({
    name,
    kind: options.kind ?? "baseline",
    token: `${name}-token`,
    command,
    cwd: root,
    expectedRuntimeRecords: options.expectedRuntimeRecords ?? 1,
    expectedMutation: options.expectedMutation ?? false,
    expectedSpawnWrap: options.expectedSpawnWrap ?? false,
  });

  return [
    scenario("simple", runtime("simple-token", "simple", "alpha", "beta gamma")),
    scenario("pipeline", `printf 'pipeline-data\\n' | ${runtime("pipeline-token", "pipeline")}`),
    scenario("chain", `${runtime("chain-token", "chain-first")} && ${runtime("chain-token", "chain-second")}`, { expectedRuntimeRecords: 2 }),
    scenario("prefix-env", `env BASHGUARD_SPIKE_PREFIX=prefix-value ${runtime("prefix-env-token", "prefix-env")}`),
    scenario("environment-load", `. ${shellQuote(envFile)} && ${runtime("environment-load-token", "environment-load")}`),
    scenario("relative-path", `./runtime-fixture.mjs ${shellQuote("relative-path-token")} ${shellQuote("relative-path")}`),
    scenario("directory-change", `cd ${shellQuote(nested)} && node ../runtime-fixture.mjs ${shellQuote("directory-change-token")} ${shellQuote("directory-change")}`),
    scenario("harmless-rm", `rm -rf ${shellQuote(deleteTarget)} && ${runtime("harmless-rm-token", "harmless-rm")}`),
    scenario("bashguard-before-mutator", runtime("bashguard-before-mutator-token", "bashguard-before-mutator"), { kind: "ordering", expectedMutation: true }),
    scenario("mutator-before-bashguard", runtime("mutator-before-bashguard-token", "mutator-before-bashguard"), { kind: "ordering", expectedMutation: true }),
    scenario("replacement-spawn-hook", runtime("replacement-spawn-hook-token", "replacement-spawn-hook"), { kind: "replacement", expectedSpawnWrap: true }),
  ];
}
