import assert from "node:assert/strict";
import test from "node:test";

import { formatPackageSmokeJson, formatPackageSmokeMarkdown, projectPackageSmokeReport, type PackageSmokeReport } from "./package-smoke.ts";

const report: PackageSmokeReport = {
  generatedAt: "2026-08-28T12:00:00.000Z",
  isolatedRoots: {
    configDir: "/private/tmp/bashguard-smoke/pi-agent",
    projectDir: "/private/tmp/bashguard-smoke/project",
    packageRoot: "/private/tmp/bashguard-smoke/package",
  },
  bashguardPackage: {
    pack: {
      tarball: "bashguard-0.4.0.tgz",
      unpackedSizeBytes: 2_048_000,
    },
    extractedPackage: {
      status: "loaded",
      evidence: "observed",
      command: "pi --mode json -e <package-root> --no-extensions --no-skills --no-context-files --no-tools --offline --print smoke",
      exitCode: 1,
      stdout: "{\"type\":\"session.started\"}\n",
      stderr: "authentication unavailable",
      notes: ["session_start observed in JSON output", "model response was blocked"],
    },
    installRoot: {
      status: "blocked",
      evidence: "blocked",
      command: "pi install -l <package-root>",
      exitCode: 1,
      stdout: "",
      stderr: "configuration isolation not proven",
      notes: ["visible blocked evidence only"],
    },
    authBehavior: {
      status: "blocked",
      evidence: "blocked",
      command: "pi --mode json -e <package-root>",
      exitCode: 1,
      stdout: "",
      stderr: "no auth behavior change could be proven in this environment",
      notes: ["not faked as pass"],
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
      cwd: "/private/tmp/bashguard-smoke/package",
      exitCode: 0,
      durationMs: 55.5,
      stdout: "bashguard-0.4.0.tgz",
      stderr: "",
    },
  ],
  notes: ["local observation only"],
};

test("package smoke report projection stays sanitized and preserves blocked evidence", () => {
  const projected = projectPackageSmokeReport(report);
  const markdown = formatPackageSmokeMarkdown(projected);
  const json = formatPackageSmokeJson(projected);

  assert.match(markdown, /tree-sitter-native-candidate/);
  assert.match(markdown, /blocked evidence/);
  assert.match(markdown, /pi --mode json -e/);
  assert.match(markdown, /configuration isolation not proven/);
  assert.match(markdown, /no auth behavior change could be proven/);
  assert.equal(markdown.includes("/private/tmp"), false);
  assert.equal(json.includes("/private/tmp"), false);
  assert.equal(markdown.includes("/Users/"), false);
});

test("package smoke report ordering is deterministic", () => {
  const reversed = projectPackageSmokeReport({ ...report, candidatePackages: [...report.candidatePackages].reverse() });
  assert.equal(formatPackageSmokeMarkdown(projectPackageSmokeReport(report)), formatPackageSmokeMarkdown(reversed));
  assert.equal(formatPackageSmokeJson(projectPackageSmokeReport(report)), formatPackageSmokeJson(reversed));
});
