import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Parser from "tree-sitter";
import Bash from "tree-sitter-bash";

import { projectTreeSitterParse } from "./tree-sitter-projection.ts";
import { type GitTargetCandidate, projectGitTargetLiteralEvidence, resolveGitTargetCandidate } from "./git-target.ts";
import { probeGitTarget } from "./git-probe.ts";

const parser = new Parser();
parser.setLanguage(Bash);

const treeSitterContext = {
  adapterId: "tree-sitter-native",
  adapterLabel: "Tree-sitter native",
  mode: "native" as const,
  identity: {
    parser: "tree-sitter" as const,
    language: "bash" as const,
    mode: "native" as const,
  },
  version: {
    adapter: "test",
    parser: "test",
    language: "test",
  },
  availability: "available" as const,
};

const gitAvailable = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

function project(command: string) {
  return projectTreeSitterParse(command, parser.parse(command), treeSitterContext);
}

function runGit(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): void {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      GIT_AUTHOR_NAME: "BashGuard",
      GIT_AUTHOR_EMAIL: "bashguard@example.com",
      GIT_COMMITTER_NAME: "BashGuard",
      GIT_COMMITTER_EMAIL: "bashguard@example.com",
    },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr || result.error?.message || "unknown error"}`);
}

async function prepareGitFixtures() {
  const root = await tempRoot("bashguard-git-probe-");
  const repo = path.join(root, "repo");
  await mkdir(repo);
  runGit(root, ["init", "repo"]);
  await writeFile(path.join(repo, "file.txt"), "hello\n");
  runGit(repo, ["add", "file.txt"]);
  runGit(repo, ["commit", "-m", "initial"]);

  const nested = path.join(repo, "nested");
  await mkdir(nested);

  const worktree = path.join(root, "worktree");
  runGit(repo, ["worktree", "add", worktree]);

  const bare = path.join(root, "bare.git");
  runGit(root, ["init", "--bare", bare]);

  const symlinkPath = path.join(root, "repo-link");
  await symlink(repo, symlinkPath);

  const restricted = path.join(root, "restricted");
  await mkdir(restricted);
  runGit(root, ["init", "restricted"]);

  return { root, repo, nested, worktree, bare, symlinkPath, restricted };
}

async function makeFakeGit(root: string, name: string, script: string): Promise<string> {
  const file = path.join(root, name);
  await writeFile(file, script, { mode: 0o755 });
  return file;
}

function parseTarget(command: string, cwd: string): GitTargetCandidate {
  const projection = project(command);
  const literal = projectGitTargetLiteralEvidence(command, cwd, projection);
  if (literal.evidenceLevel === "unknown") throw new Error(`expected a literal target for ${command}`);
  return resolveGitTargetCandidate(literal);
}

test("probe verifies normal, nested, linked worktree, bare, and symlink fixtures", async (t) => {
  if (!gitAvailable) {
    t.skip("git is unavailable");
    return;
  }

  const fixtures = await prepareGitFixtures();
  try {
    const cases = [
      { command: "git status", cwd: fixtures.repo, expectedKind: "normal" },
      { command: "git -C ./nested status", cwd: fixtures.repo, expectedKind: "nested" },
      { command: "git status", cwd: fixtures.worktree, expectedKind: "linked-worktree" },
      { command: "git --git-dir=./bare.git rev-parse --is-bare-repository", cwd: fixtures.root, expectedKind: "bare" },
      { command: "git status", cwd: fixtures.symlinkPath, expectedKind: "symlink" },
    ] as const;

    for (const entry of cases) {
      const target = parseTarget(entry.command, entry.cwd);
      const probe = await probeGitTarget(target, { timeoutMs: 1000 });
      assert.equal(probe.evidenceLevel, "verified", entry.expectedKind);
      assert.equal(probe.canonical.cwd.length > 0, true, entry.expectedKind);
      if (entry.expectedKind === "nested") {
        assert.equal(probe.canonical.topLevel, fixtures.repo);
      }
      if (entry.expectedKind === "linked-worktree") {
        assert.equal(probe.canonical.topLevel, fixtures.worktree);
      }
      if (entry.expectedKind === "bare") {
        assert.equal(probe.observed.isBare, true);
      }
      if (entry.expectedKind === "symlink") {
        assert.equal(probe.canonical.cwd, path.resolve(fixtures.repo));
      }
    }
  } finally {
    await rm(fixtures.root, { recursive: true, force: true });
  }
});

test("probe reports nonrepo, missing git, permission, malformed, inconsistent, and timeout states distinctly", async (t) => {
  if (!gitAvailable) {
    t.skip("git is unavailable");
    return;
  }

  const fixtures = await prepareGitFixtures();
  try {
    const nonrepo = await probeGitTarget(parseTarget("git status", fixtures.root), { timeoutMs: 1000 });
    assert.equal(nonrepo.evidenceLevel, "unknown");
    assert.equal(nonrepo.unknownReason, "nonrepo");

    const missingGit = await probeGitTarget(parseTarget("git status", fixtures.repo), {
      gitBinary: path.join(fixtures.root, "missing-git-binary"),
      timeoutMs: 1000,
    });
    assert.equal(missingGit.evidenceLevel, "unknown");
    assert.equal(missingGit.unknownReason, "missing-git");

    const restrictedTarget = parseTarget("git status", fixtures.restricted);
    await chmod(fixtures.restricted, 0o000);
    try {
      const permission = await probeGitTarget(restrictedTarget, { timeoutMs: 1000 });
      assert.equal(permission.evidenceLevel, "unknown");
      assert.equal(permission.unknownReason, "permission");
    } finally {
      await chmod(fixtures.restricted, 0o755);
    }

    const malformedScript = await makeFakeGit(fixtures.root, "fake-git-malformed.mjs", `#!/usr/bin/env node
process.stdout.write('maybe\\nnot enough lines\\n');
process.exit(0);
`);
    const malformed = await probeGitTarget(parseTarget("git status", fixtures.repo), {
      gitBinary: malformedScript,
      timeoutMs: 2000,
    });
    assert.equal(malformed.evidenceLevel, "unknown");
    assert.equal(malformed.unknownReason, "malformed");
    assert.equal(malformed.runs[0]?.stdoutTruncated || false, false);

    const inconsistentScript = await makeFakeGit(fixtures.root, "fake-git-inconsistent.mjs", `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
if (args.includes('--show-toplevel')) {
  process.stdout.write('/different/worktree\\n');
} else {
  process.stdout.write('false\\ntrue\\n/different/gitdir\\n/different/common\\n');
}
process.exit(0);
`);
    const inconsistentTarget = parseTarget("git --git-dir=.git --work-tree=./nested clean -fd", fixtures.repo);
    const inconsistent = await probeGitTarget(inconsistentTarget, {
      gitBinary: inconsistentScript,
      timeoutMs: 2000,
    });
    assert.equal(inconsistent.evidenceLevel, "unknown");
    assert.equal(inconsistent.unknownReason, "inconsistent");

    const noisyScript = await makeFakeGit(fixtures.root, "fake-git-noisy.mjs", `#!/usr/bin/env node
process.stdout.write('x'.repeat(4096));
process.stderr.write('y'.repeat(4096));
process.exit(0);
`);
    const noisy = await probeGitTarget(parseTarget("git status", fixtures.repo), {
      gitBinary: noisyScript,
      timeoutMs: 2000,
      maxOutputBytes: 1024,
    });
    assert.equal(noisy.evidenceLevel, "unknown");
    assert.equal(noisy.unknownReason, "malformed");
    assert.equal(noisy.runs[0]?.stdoutTruncated, true);
    assert.equal(noisy.runs[0]?.stderrTruncated, true);

    const hangingScript = await makeFakeGit(fixtures.root, "fake-git-hang.mjs", `#!/usr/bin/env node
setInterval(() => {}, 1000);
`);
    const controller = new AbortController();
    const hangingProbe = probeGitTarget(parseTarget("git status", fixtures.repo), {
      gitBinary: hangingScript,
      timeoutMs: 2000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error("external abort")), 25);
    const aborted = await hangingProbe;
    assert.equal(aborted.evidenceLevel, "unknown");
    assert.equal(aborted.unknownReason, "timeout");
  } finally {
    await rm(fixtures.root, { recursive: true, force: true });
  }
});

test("local probe samples are measurable without claiming a guarantee", async (t) => {
  if (!gitAvailable) {
    t.skip("git is unavailable");
    return;
  }

  const fixtures = await prepareGitFixtures();
  try {
    const target = parseTarget("git status", fixtures.repo);
    const samples: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const probe = await probeGitTarget(target, { timeoutMs: 1000 });
      assert.equal(probe.evidenceLevel, "verified");
      samples.push(probe.durationMs);
    }
    const sorted = [...samples].sort((left, right) => left - right);
    const p50 = sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0;
    const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0;
    assert.ok(Number.isFinite(p50));
    assert.ok(Number.isFinite(p95));
    console.log(JSON.stringify({ localProbeSamples: samples.length, p50Ms: p50, p95Ms: p95 }, null, 2));
  } finally {
    await rm(fixtures.root, { recursive: true, force: true });
  }
});
