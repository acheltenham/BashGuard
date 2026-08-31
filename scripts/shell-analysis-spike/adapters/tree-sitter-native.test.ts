import assert from "node:assert/strict";
import test from "node:test";

import { shellAnalysisCorpus } from "../corpus.ts";
import { runTreeSitterCorpus } from "../tree-sitter-projection.ts";
import { createTreeSitterNativeAdapter } from "./tree-sitter-native.ts";

const corpus = shellAnalysisCorpus();

test("tree-sitter native adapter exposes identity, version, and capabilities", async () => {
  const adapter = await createTreeSitterNativeAdapter();

  assert.equal(adapter.mode, "native");
  assert.equal(adapter.identity.parser, "tree-sitter");
  assert.equal(adapter.identity.language, "bash");
  assert.equal(adapter.availability, "available");
  assert.equal(adapter.capabilities.parseTree, true);
  assert.equal(adapter.capabilities.boundedInput, true);
  assert.ok(adapter.version.adapter.length > 0);
  assert.ok(adapter.version.parser.length > 0);
  assert.ok(adapter.version.language.length > 0);
});

test("tree-sitter native adapter projects a bounded corpus through the same interface", async () => {
  const adapter = await createTreeSitterNativeAdapter();
  const evaluation = await runTreeSitterCorpus(adapter, corpus, { timeoutMs: 250 });

  assert.equal(evaluation.adapterId, "tree-sitter-native");
  assert.equal(evaluation.fixtures.length, corpus.length);
  assert.equal(
    evaluation.summary.pass + evaluation.summary.mismatch + evaluation.summary.error + evaluation.summary.timeout,
    corpus.length,
  );
  assert.ok(evaluation.summary.mismatch > 0);

  const quoted = evaluation.fixtures.find((fixture) => fixture.fixtureId === "sa-003-comments-printf");
  assert.ok(quoted);
  assert.ok(quoted?.analysis.projection.segments.some((entry) => entry.role === "inert"));
  assert.equal(quoted.comparison.protectedChecks, "matched");
});
