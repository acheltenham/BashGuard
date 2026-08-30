import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { shellAnalysisCorpus } from "./corpus.ts";
import { evaluateCorpus, sanitizeEvaluationProjection, type AnalysisAdapter } from "./evaluate.ts";
import { analyzeWithCurrentMatcher } from "./adapters/current-matcher.ts";

const corpus = shellAnalysisCorpus();

const baselineAdapter: AnalysisAdapter = {
  id: "current-matcher",
  label: "Current matcher baseline",
  capabilities: {
    structural: false,
    checks: true,
    literalGitTargets: true,
  },
  analyze: (fixture) => analyzeWithCurrentMatcher(fixture.command),
};

function collectRelativeSpecifiers(sourceText: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^;\n]*?\sfrom\s*)?["']([^"']+)["']/g,
    /\bexport\s+[^;\n]*?\sfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ] as const;
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sourceText)) !== null) {
      const specifier = match[1]!;
      if (specifier.startsWith(".") || specifier.startsWith("/")) specifiers.add(specifier);
    }
  }
  return [...specifiers];
}

async function listTypeScriptFiles(root: string): Promise<string[]> {
  await access(root);
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(".ts")) {
        files.push(fullPath);
      }
    }
  };
  await walk(root);
  return files;
}

test("generic evaluator records pass, mismatch, error, and timeout outcomes", async () => {
  const evaluation = await evaluateCorpus(baselineAdapter, corpus, { timeoutMs: 250 });
  assert.equal(evaluation.adapterId, "current-matcher");
  assert.equal(evaluation.fixtures[0]?.comparison.structural, "not-applicable");
  assert.ok(evaluation.summary.pass > 0);
  assert.ok(evaluation.summary.mismatch >= 0);
  assert.equal(evaluation.fixtures.length, corpus.length);

  const errorAdapter: AnalysisAdapter = {
    id: "error-adapter",
    label: "Error adapter",
    capabilities: {
      structural: false,
      checks: false,
      literalGitTargets: false,
    },
    analyze: () => {
      throw new Error("host path /private/tmp/abc should be sanitized");
    },
  };
  const errorResult = await evaluateCorpus(errorAdapter, [corpus[0]!], { timeoutMs: 250 });
  assert.equal(errorResult.fixtures[0]?.outcome, "error");
  assert.match(errorResult.fixtures[0]?.notes.join(" ") ?? "", /<tmp-path>/);

  const timeoutAdapter: AnalysisAdapter = {
    id: "timeout-adapter",
    label: "Timeout adapter",
    capabilities: {
      structural: false,
      checks: false,
      literalGitTargets: false,
    },
    analyze: () => new Promise(() => undefined),
  };
  const timeoutResult = await evaluateCorpus(timeoutAdapter, [corpus[0]!], { timeoutMs: 10 });
  assert.equal(timeoutResult.fixtures[0]?.outcome, "timeout");

  let cleanupCalls = 0;
  const abortCleanupAdapter: AnalysisAdapter = {
    id: "abort-cleanup-adapter",
    label: "Abort cleanup adapter",
    capabilities: {
      structural: false,
      checks: false,
      literalGitTargets: false,
    },
    analyze: (_fixture, signal) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          resolve({
            adapterId: "abort-cleanup-adapter",
            adapterLabel: "Abort cleanup adapter",
            command: corpus[0]!.command,
            status: "degraded",
            textualEvidence: ["timer elapsed without abort"],
            protectedChecks: [],
            literalGitTargetOptions: [],
            limitations: ["observes AbortSignal and clears pending work"],
          });
        }, 10_000);
        const finish = () => {
          cleanupCalls += 1;
          clearTimeout(timer);
          setTimeout(() => {
            resolve({
              adapterId: "abort-cleanup-adapter",
              adapterLabel: "Abort cleanup adapter",
              command: corpus[0]!.command,
              status: "degraded",
              textualEvidence: ["aborted and cleaned up"],
              protectedChecks: [],
              literalGitTargetOptions: [],
              limitations: ["observes AbortSignal and clears pending work"],
            });
          }, 0);
        };
        if (signal.aborted) {
          finish();
          return;
        }
        signal.addEventListener("abort", finish, { once: true });
      }),
  };
  const abortCleanupResult = await evaluateCorpus(abortCleanupAdapter, [corpus[0]!], { timeoutMs: 10 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(abortCleanupResult.fixtures[0]?.outcome, "timeout");
  assert.equal(cleanupCalls, 1);
});

test("evaluation projections sanitize host-specific paths and timing noise", () => {
  const projection = sanitizeEvaluationProjection({
    path: "/private/tmp/bashguard/spike/result.json",
    nested: ["/tmp/bashguard/spike/result.json", "12 ms"],
    message: "wrote /private/tmp/bashguard/spike/result.json in 12 ms",
  });
  const text = JSON.stringify(projection);
  assert.doesNotMatch(text, /\/private\/tmp\//);
  assert.doesNotMatch(text, /\/tmp\//);
  assert.doesNotMatch(text, /\b12 ms\b/);
  assert.match(text, /<tmp-path>/);
  assert.match(text, /<duration-ms>/);
});

test("production sources do not resolve imports into scripts/shell-analysis-spike", async () => {
  const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const sourceRoots = [join(repoRoot, "src"), join(repoRoot, "extensions")];
  const sourceFiles: string[] = [];
  for (const root of sourceRoots) sourceFiles.push(...(await listTypeScriptFiles(root)));
  assert.ok(sourceFiles.length > 0);

  const offendingImports: string[] = [];
  for (const filePath of sourceFiles) {
    const sourceText = await readFile(filePath, "utf8");
    for (const specifier of collectRelativeSpecifiers(sourceText)) {
      const resolved = resolve(dirname(filePath), specifier);
      const normalized = relative(repoRoot, resolved);
      if (normalized === "") continue;
      if (normalized.startsWith(`scripts${sep}shell-analysis-spike`)) {
        offendingImports.push(`${relative(repoRoot, filePath)} -> ${specifier} -> ${normalized}`);
      }
    }
  }
  assert.deepEqual(offendingImports, []);
});
