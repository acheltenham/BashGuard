import assert from "node:assert/strict";
import { access, mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { buildNpmPackInvocation, buildPiInstallInvocation, buildPiLoadInvocation, formatPackageSmokeJson, formatPackageSmokeMarkdown, projectPackageManifest, projectPackageSmokeReport, runPackageSmoke, type PackageSmokeReport } from "./package-smoke.ts";

const report: PackageSmokeReport = {
  generatedAt: "2026-08-28T12:00:00.000Z",
  isolatedRoots: {
    configDir: "/Users/alice/bashguard-smoke/pi-agent",
    projectDir: "/home/bob/bashguard-smoke/project",
    packageRoot: "/private/tmp/bashguard-smoke/package",
  },
  bashguardPackage: {
    pack: {
      tarball: "bashguard-0.4.0.tgz",
      unpackedSizeBytes: 2_048_000,
      succeeded: true,
    },
    install: {
      status: "observed",
      evidence: "observed",
      command: "npm install --omit=dev",
      exitCode: 0,
      timedOut: false,
      stdout: "installed package",
      stderr: "",
      notes: ["extracted package install succeeded"],
    },
    piProcess: {
      status: "unproven",
      evidence: "unproven",
      command: "pi --mode json --offline --no-extensions --no-skills --no-context-files --no-tools -e <package-root> -p smoke",
      exitCode: null,
      timedOut: true,
      stdout: "",
      stderr: "request timed out",
      notes: ["offline Pi session timed out; runtime auth behavior unproven"],
    },
    startupEvidence: {
      status: "observed",
      evidence: "observed",
      command: "scan BASHGUARD_DATA_DIR for session.json/events.jsonl",
      exitCode: null,
      timedOut: false,
      stdout: "session artifact observed in isolated BASHGUARD_DATA_DIR",
      stderr: "",
      notes: ["recorder extension startup artifact observed"],
    },
    registrationConfig: {
      status: "observed",
      evidence: "observed",
      command: "pi install -l <package-root>",
      exitCode: 0,
      timedOut: false,
      stdout: "registered package",
      stderr: "",
      notes: ["isolated cwd, PI_CODING_AGENT_DIR, and BASHGUARD_DATA_DIR were set for pi install", "registration/config evidence observed in isolated config root", "process success alone does not prove registration", "isolated roots were requested and sentinel files were observed; absence of all external reads is unproven"],
    },
    authBehavior: {
      status: "unproven",
      evidence: "unproven",
      command: "pi --mode json --offline --no-extensions --no-skills --no-context-files --no-tools -e <package-root> -p smoke",
      exitCode: null,
      timedOut: true,
      stdout: "",
      stderr: "request timed out",
      notes: ["offline Pi session timed out; runtime auth behavior unproven", "static production-import and runtime-dependency isolation are assessed separately"],
    },
  },
  candidatePackages: [
    {
      packageName: "tree-sitter-native-candidate",
      runtimeDependencies: ["tree-sitter", "tree-sitter-bash"],
      unpackedSizeBytes: 9_001_000,
      hasInstallScript: true,
      nativeCompilation: true,
      importInit: {
        status: "loaded",
        evidence: "observed",
        command: "npm install --omit=dev && node --input-type=module -e import-init",
        exitCode: 0,
        stdout: "loaded native parser",
        stderr: "",
      },
      notes: ["compiled in isolated temp root"],
    },
  ],
  commands: [
    {
      command: "npm pack",
      cwd: "/Users/alice/bashguard-smoke/package",
      exitCode: 0,
      durationMs: 55.5,
      stdout: "bashguard-0.4.0.tgz",
      stderr: "",
    },
  ],
  notes: ["local observation only", "timestamp/load/durations are local observations, not guarantees", "isolated roots were requested and sentinel files were observed; absence of all external reads is unproven"],
};

test("package smoke report projection stays sanitized and preserves blocked evidence", () => {
  const projected = projectPackageSmokeReport(report);
  const markdown = formatPackageSmokeMarkdown(projected);
  const json = formatPackageSmokeJson(projected);

  assert.match(markdown, /tree-sitter-native-candidate/);
  assert.match(markdown, /Package install: observed · observed/);
  assert.match(markdown, /Pi process: unproven · unproven · timed out/);
  assert.match(markdown, /Recorder startup evidence: observed · observed/);
  assert.match(markdown, /Registration\/config evidence: observed · observed/);
  assert.match(markdown, /Authorization behavior: unproven · unproven · timed out/);
  assert.equal(markdown.includes("/private/tmp"), false);
  assert.equal(json.includes("/private/tmp"), false);
  assert.equal(markdown.includes("/Users/"), false);
  assert.equal(json.includes("/Users/"), false);
  assert.equal(markdown.includes("/home/"), false);
  assert.equal(json.includes("/home/"), false);
});

test("package manifest projection rejects checkout-linked dependency specs", () => {
  const projected = projectPackageManifest({
    name: "candidate",
    dependencies: {
      direct: "1.2.3",
      linked: "file:/Users/alice/project/node_modules/dep",
      absolute: "/Users/alice/project/node_modules/dep",
      workspace: "workspace:*",
      link: "link:../dep",
    },
  });

  assert.equal(projected.name, "candidate");
  assert.equal(projected.dependencies.direct, "1.2.3");
  assert.match(projected.dependencyIssues.join("\n"), /linked: unsupported dependency spec/);
  assert.match(projected.dependencyIssues.join("\n"), /absolute: absolute path dependency spec/);
  assert.match(projected.dependencyIssues.join("\n"), /workspace: unsupported dependency spec/);
  assert.match(projected.dependencyIssues.join("\n"), /link: unsupported dependency spec/);
});

test("package smoke report ordering is deterministic", () => {
  const reversed = projectPackageSmokeReport({ ...report, candidatePackages: [...report.candidatePackages].reverse() });
  assert.equal(formatPackageSmokeMarkdown(projectPackageSmokeReport(report)), formatPackageSmokeMarkdown(reversed));
  assert.equal(formatPackageSmokeJson(projectPackageSmokeReport(report)), formatPackageSmokeJson(reversed));
});

test("package smoke command builders use isolated pack destinations and project-local install", () => {
  assert.deepEqual(buildNpmPackInvocation("/tmp/repo", "/tmp/repo/pack"), {
    command: "npm",
    args: ["pack", "--pack-destination", "/tmp/repo/pack"],
    cwd: "/tmp/repo",
  });
  assert.deepEqual(buildPiInstallInvocation("/tmp/project", "/tmp/project/package"), {
    command: "pi",
    args: ["install", "-l", "/tmp/project/package"],
    cwd: "/tmp/project",
  });
  assert.deepEqual(buildPiLoadInvocation("/tmp/project", "/tmp/project/package"), {
    command: "pi",
    args: ["--mode", "json", "--offline", "--no-extensions", "--no-skills", "--no-context-files", "--no-tools", "-e", "/tmp/project/package", "-p", "smoke"],
    cwd: "/tmp/project",
  });
});

test("package smoke cleans up isolated roots when a command fails", async () => {
  const parent = await mkdtemp(join(tmpdir(), "bashguard-package-smoke-cleanup-"));
  const created: string[] = [];
  const commandLog: Array<{ readonly command: string; readonly args: readonly string[]; readonly cwd: string }> = [];
  const createTemporaryRoot = async (prefix: string): Promise<string> => {
    const root = join(parent, prefix);
    await mkdir(root, { recursive: true });
    created.push(root);
    return root;
  };
  await assert.rejects(
    runPackageSmoke({
      createTemporaryRoot,
      commandRunner: async (command, args, options) => {
        commandLog.push({ command, args, cwd: options?.cwd ?? "" });
        throw new Error("simulated failure");
      },
    }),
  /simulated failure/);
  assert.match(commandLog[0]?.args.join(" ") ?? "", /--pack-destination/);
  for (const root of created) {
    await assert.rejects(access(root));
  }
});
