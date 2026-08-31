import assert from "node:assert/strict";
import test from "node:test";

import { shellAnalysisCorpus } from "../corpus.ts";
import { runTreeSitterCorpus } from "../tree-sitter-projection.ts";
import { createTreeSitterNativeAdapter } from "./tree-sitter-native.ts";
import { createTreeSitterWasmAdapter } from "./tree-sitter-wasm.ts";

const corpus = shellAnalysisCorpus();

test("tree-sitter wasm adapter exposes identity and either starts or rejects visibly", async () => {
  const adapter = await createTreeSitterWasmAdapter();

  assert.equal(adapter.mode, "wasm");
  assert.equal(adapter.identity.parser, "web-tree-sitter");
  assert.equal(adapter.identity.language, "bash");
  assert.ok(adapter.version.adapter.length > 0);
  assert.ok(adapter.version.parser.length > 0);
  assert.ok(adapter.version.language.length > 0);

  if (adapter.availability === "unavailable") {
    assert.equal(adapter.capabilities.available, false);
    assert.ok((adapter.availabilityReason ?? "").length > 0);
    const fixture = corpus[0]!;
    const analysis = await adapter.analyze(fixture, new AbortController().signal);
    assert.equal(analysis.status, "unsupported");
    assert.ok(analysis.limitations.some((line) => line.includes("unavailable")));
    return;
  }

  assert.equal(adapter.capabilities.available, true);
  const fixture = corpus.find((entry) => entry.id === "sa-006-git-sequential-targeting") ?? corpus[0]!;
  const nativeAdapter = await createTreeSitterNativeAdapter();
  const nativeEvaluation = await runTreeSitterCorpus(nativeAdapter, [fixture], { timeoutMs: 250 });
  const wasmEvaluation = await runTreeSitterCorpus(adapter, [fixture], { timeoutMs: 250 });

  assert.equal(wasmEvaluation.summary.mismatch, nativeEvaluation.summary.mismatch);
  assert.deepEqual(
    wasmEvaluation.fixtures[0]?.analysis.projection.segments.map((entry) => ({ role: entry.role, text: entry.text, span: entry.span })),
    nativeEvaluation.fixtures[0]?.analysis.projection.segments.map((entry) => ({ role: entry.role, text: entry.text, span: entry.span })),
  );
});
