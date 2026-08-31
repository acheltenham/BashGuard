import assert from "node:assert/strict";
import test from "node:test";

import { formatPackageSmokeJson, formatPackageSmokeMarkdown, projectPackageSmokeReport, type PackageSmokeReport } from "./package-smoke.ts";

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
      notes: ["dedicated cwd, PI_CODING_AGENT_DIR, and BASHGUARD_DATA_DIR were set", "registration/config evidence observed in isolated config root", "no writes to sentinel snapshot observed"],
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
  notes: ["local observation only", "timestamp/load/durations are local observations, not guarantees"],
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

test("package smoke report ordering is deterministic", () => {
  const reversed = projectPackageSmokeReport({ ...report, candidatePackages: [...report.candidatePackages].reverse() });
  assert.equal(formatPackageSmokeMarkdown(projectPackageSmokeReport(report)), formatPackageSmokeMarkdown(reversed));
  assert.equal(formatPackageSmokeJson(projectPackageSmokeReport(report)), formatPackageSmokeJson(reversed));
});
