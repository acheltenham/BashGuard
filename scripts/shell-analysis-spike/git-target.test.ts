import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Parser from "tree-sitter";
import Bash from "tree-sitter-bash";

import { projectTreeSitterParse } from "./tree-sitter-projection.ts";
import { projectGitTargetLiteralEvidence, resolveGitTargetCandidate } from "./git-target.ts";

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

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

function project(command: string) {
  const tree = parser.parse(command);
  return projectTreeSitterParse(command, tree, treeSitterContext);
}

test("git target keeps the initial cwd literal and candidate resolution distinct", async () => {
  const cwd = await tempRoot("bashguard-git-target-identity-");
  const command = "git status";
  const projection = project(command);
  const literal = projectGitTargetLiteralEvidence(command, cwd, projection);

  if (literal.evidenceLevel !== "literal") throw new Error("expected literal evidence");
  assert.deepEqual(literal.literalGitTargetOptions, []);
  assert.ok(literal.quotedWords.length === 0);

  const candidate = resolveGitTargetCandidate(literal);
  assert.equal(candidate.evidenceLevel, "candidate");
  assert.equal(candidate.resolvedCwd, cwd);
  assert.equal(candidate.resolvedGitDir, undefined);
  assert.equal(candidate.resolvedWorkTree, undefined);
});

test("repeated -C resolves sequentially from the initial cwd", async () => {
  const cwd = await tempRoot("bashguard-git-target-sequential-");
  const command = "git -C ./repo-a -C ./repo-b status";
  const literal = projectGitTargetLiteralEvidence(command, cwd, project(command));
  if (literal.evidenceLevel !== "literal") throw new Error("expected literal evidence");
  const candidate = resolveGitTargetCandidate(literal);
  assert.deepEqual(
    literal.literalGitTargetOptions.map((entry) => ({ option: entry.option, value: entry.value })),
    [
      { option: "-C", value: "./repo-a" },
      { option: "-C", value: "./repo-b" },
    ],
  );
  assert.equal(candidate.resolvedCwd, path.resolve(cwd, "./repo-a", "./repo-b"));
});

test("quoted git-dir and work-tree values stay literal in the structural projection", async () => {
  const cwd = await tempRoot("bashguard-git-target-quoted-");
  const command = "git --git-dir='.git' --work-tree='./repo path' clean -fd";
  const projection = project(command);
  const literal = projectGitTargetLiteralEvidence(command, cwd, projection);
  if (literal.evidenceLevel !== "literal") throw new Error("expected literal evidence");
  const candidate = resolveGitTargetCandidate(literal);
  assert.ok(literal.quotedWords.some((word) => word.includes(".git")));
  assert.ok(literal.quotedWords.some((word) => word.includes("./repo path")));
  assert.deepEqual(
    literal.literalGitTargetOptions.map((entry) => ({ option: entry.option, value: entry.value, quoted: entry.quoted })),
    [
      { option: "--git-dir", value: ".git", quoted: true },
      { option: "--work-tree", value: "./repo path", quoted: true },
    ],
  );
  assert.equal(candidate.resolvedGitDir, path.resolve(cwd, ".git"));
  assert.equal(candidate.resolvedWorkTree, path.resolve(cwd, "./repo path"));
});

test("missing git target values are unknown", async () => {
  const cwd = await tempRoot("bashguard-git-target-missing-");
  const command = "git --git-dir status";
  const result = projectGitTargetLiteralEvidence(command, cwd, project(command));

  if (result.evidenceLevel !== "unknown") throw new Error("expected unknown evidence");
  assert.equal(result.reason, "missing-value");
  assert.ok(result.notes.some((note) => note.includes("missing value")));
});

test("dynamic git target values are unknown", async () => {
  const cwd = await tempRoot("bashguard-git-target-dynamic-");
  const command = "git -C \"$(pwd)\" status";
  const result = projectGitTargetLiteralEvidence(command, cwd, project(command));

  if (result.evidenceLevel !== "unknown") throw new Error("expected unknown evidence");
  assert.equal(result.reason, "dynamic");
  assert.ok(result.notes.some((note) => note.includes("dynamic")));
});

test("conflicting git target values are unknown", async () => {
  const cwd = await tempRoot("bashguard-git-target-conflicting-");
  const command = "git --git-dir=.git --git-dir=../other.git status";
  const result = projectGitTargetLiteralEvidence(command, cwd, project(command));

  if (result.evidenceLevel !== "unknown") throw new Error("expected unknown evidence");
  assert.equal(result.reason, "conflicting");
  assert.ok(result.notes.some((note) => note.includes("conflicting")));
});
