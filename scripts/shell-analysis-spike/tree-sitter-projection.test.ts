import assert from "node:assert/strict";
import test from "node:test";

import Parser from "tree-sitter";
import Bash from "tree-sitter-bash";

import { projectTreeSitterParse } from "./tree-sitter-projection.ts";

const parser = new Parser();
parser.setLanguage(Bash);

const context = {
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

test("tree-sitter projection keeps executable, literal, wrapper, and redirect spans separate", () => {
  const command = "FOO=bar env BAZ=qux cmd arg >out 2>>err";
  const tree = parser.parse(command);
  const projection = projectTreeSitterParse(command, tree, context);

  assert.equal(projection.status, "structured");
  assert.deepEqual(projection.assignments.map((entry) => entry.text), ["FOO=bar", "BAZ=qux"]);
  assert.deepEqual(projection.wrappers.map((entry) => entry.text), ["env"]);
  assert.deepEqual(projection.redirects.map((entry) => entry.operator), [">", "2>>"]);
  assert.deepEqual(
    projection.segments.filter((entry) => entry.role === "executable").map((entry) => entry.text),
    ["cmd", "arg"],
  );
  assert.ok(projection.segments.some((entry) => entry.text === "cmd"));
  assert.ok(projection.segments.some((entry) => entry.text === "arg"));
  assert.ok(projection.segments.some((entry) => entry.role === "redirect" && entry.text === ">out"));
  assert.equal(projection.parseIssues.length, 0);
});

test("tree-sitter projection keeps quoted, comment, and heredoc payloads inert", () => {
  const command = "printf '%s\\n' 'git reset --hard' # trailing comment\ncat <<'EOF'\ngit clean -fdn\nEOF";
  const tree = parser.parse(command);
  const projection = projectTreeSitterParse(command, tree, context);

  assert.deepEqual(
    projection.segments.filter((entry) => entry.role === "executable").map((entry) => entry.text),
    ["printf", "cat"],
  );
  assert.ok(projection.segments.some((entry) => entry.role === "inert" && entry.text.includes("git reset --hard")));
  assert.ok(projection.segments.some((entry) => entry.role === "inert" && entry.text.startsWith("# trailing comment")));
  assert.ok(projection.segments.some((entry) => entry.role === "inert" && entry.text.startsWith("git clean -fdn")));
  assert.equal(projection.unresolved.length, 0);
  assert.equal(projection.status, "structured");
  assert.equal(
    projection.segments.filter((entry) => entry.role === "executable" && entry.text.includes("git reset --hard")).length,
    0,
  );
  assert.equal(
    projection.segments.filter((entry) => entry.role === "executable" && entry.text.includes("git clean -fdn")).length,
    0,
  );
});

test("tree-sitter projection makes parse errors and recovery explicit", () => {
  const malformed = parser.parse('echo "unterminated');
  const recovery = parser.parse('echo $( )');

  const malformedProjection = projectTreeSitterParse('echo "unterminated', malformed, context);
  const recoveryProjection = projectTreeSitterParse('echo $( )', recovery, context);

  assert.equal(malformedProjection.status, "degraded");
  assert.ok(malformedProjection.parseIssues.some((entry) => entry.kind === "error"));
  assert.ok(malformedProjection.parseIssues.some((entry) => entry.kind === "recovery"));
  assert.ok(malformedProjection.unresolved.some((entry) => entry.kind === "parse-error"));

  assert.equal(recoveryProjection.status, "degraded");
  assert.ok(recoveryProjection.parseIssues.some((entry) => entry.kind === "recovery"));
  assert.ok(recoveryProjection.unresolved.some((entry) => entry.kind === "command-substitution"));
});

test("tree-sitter projection bounds input and reports unsupported analysis visibly", () => {
  const longCommand = `printf '%s\\n' '${"x".repeat(9000)}'`;
  const projection = projectTreeSitterParse(longCommand, parser.parse(longCommand), context, { maxSourceLength: 1024 });

  assert.equal(projection.status, "unsupported");
  assert.ok(projection.diagnostics.some((entry) => entry.code === "input-too-large"));
});
