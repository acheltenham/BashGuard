import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { Language, Parser } from "web-tree-sitter";

import { type CorpusFixture } from "../model.ts";
import { projectTreeSitterParse, type TreeSitterAdapter, type TreeSitterAnalysis, type TreeSitterProjectionContext } from "../tree-sitter-projection.ts";

const require = createRequire(import.meta.url);

function packageVersion(packageName: string): string {
  let directory = dirname(require.resolve(packageName));
  while (true) {
    const packageJsonPath = join(directory, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { readonly version?: string };
      if (packageJson.version) return packageJson.version;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`unable to determine ${packageName} version`);
}

function createEmptyTree(): { readonly rootNode: { readonly type: string; readonly isNamed: boolean; readonly isMissing: boolean; readonly hasError: boolean; readonly startIndex: number; readonly endIndex: number; readonly childCount: number; child(index: number): null; } } {
  return {
    rootNode: {
      type: "program",
      isNamed: true,
      isMissing: false,
      hasError: false,
      startIndex: 0,
      endIndex: 0,
      childCount: 0,
      child: () => null,
    },
  };
}

function createTreeSitterAnalysis(adapter: TreeSitterAdapter, fixture: CorpusFixture, projectionContext: TreeSitterProjectionContext, tree: Parameters<typeof projectTreeSitterParse>[1]): TreeSitterAnalysis {
  const projection = projectTreeSitterParse(fixture.command, tree, projectionContext);
  return {
    adapterId: adapter.id,
    adapterLabel: adapter.label,
    mode: adapter.mode,
    identity: adapter.identity,
    version: adapter.version,
    availability: adapter.availability,
    availabilityReason: adapter.availabilityReason,
    command: fixture.command,
    status: projection.status,
    projection,
    textualEvidence: projection.facts,
    protectedChecks: projection.protectedChecks,
    literalGitTargetOptions: projection.literalGitTargetOptions,
    structuralFacts: projection.facts,
    diagnostics: projection.diagnostics,
    limitations: [
      `web-tree-sitter parser v${adapter.version.parser}`,
      projection.status === "degraded" ? "parse issues and unresolved constructs are explicit" : "parse issues remain explicit when present",
    ],
  };
}

async function loadWasmResources(): Promise<{ readonly language: Awaited<ReturnType<typeof Language.load>>; readonly reason?: string }> {
  await Parser.init();
  const wasmPath = require.resolve("tree-sitter-bash/tree-sitter-bash.wasm");
  const language = await Language.load(wasmPath);
  return { language };
}

export async function createTreeSitterWasmAdapter(): Promise<TreeSitterAdapter> {
  const baseIdentity = {
    parser: "web-tree-sitter" as const,
    language: "bash" as const,
    mode: "wasm" as const,
  };
  const baseVersion = {
    adapter: packageVersion("web-tree-sitter"),
    parser: packageVersion("web-tree-sitter"),
    language: packageVersion("tree-sitter-bash"),
  };

  try {
    const { language } = await loadWasmResources();
    const parser = new Parser();
    parser.setLanguage(language);
    return {
      id: "tree-sitter-wasm",
      label: "Tree-sitter WASM",
      mode: "wasm",
      identity: baseIdentity,
      version: baseVersion,
      capabilities: {
        parseTree: true,
        sourceSpans: true,
        explicitErrors: true,
        explicitMissing: true,
        explicitRecovery: true,
        inertDataProtection: true,
        unresolvedDynamics: true,
        boundedInput: true,
        available: true,
      },
      availability: "available",
      analyze: (fixture, signal) => {
        if (signal.aborted) {
          const projectionContext: TreeSitterProjectionContext = {
            adapterId: "tree-sitter-wasm",
            adapterLabel: "Tree-sitter WASM",
            mode: "wasm",
            identity: baseIdentity,
            version: baseVersion,
            availability: "unavailable",
            availabilityReason: "analysis aborted before parsing",
          };
          return createTreeSitterAnalysis(
            {
              id: "tree-sitter-wasm",
              label: "Tree-sitter WASM",
              mode: "wasm",
              identity: baseIdentity,
              version: baseVersion,
              capabilities: {
                parseTree: true,
                sourceSpans: true,
                explicitErrors: true,
                explicitMissing: true,
                explicitRecovery: true,
                inertDataProtection: true,
                unresolvedDynamics: true,
                boundedInput: true,
                available: false,
              },
              availability: "unavailable",
              availabilityReason: "analysis aborted before parsing",
              analyze: () => {
                throw new Error("not reachable");
              },
            },
            fixture,
            projectionContext,
            createEmptyTree(),
          );
        }
        const tree = parser.parse(fixture.command);
        if (!tree) {
          const projectionContext: TreeSitterProjectionContext = {
            adapterId: "tree-sitter-wasm",
            adapterLabel: "Tree-sitter WASM",
            mode: "wasm",
            identity: baseIdentity,
            version: baseVersion,
            availability: "unavailable",
            availabilityReason: "web-tree-sitter parse returned no tree",
          };
          return createTreeSitterAnalysis(
            {
              id: "tree-sitter-wasm",
              label: "Tree-sitter WASM",
              mode: "wasm",
              identity: baseIdentity,
              version: baseVersion,
              capabilities: {
                parseTree: true,
                sourceSpans: true,
                explicitErrors: true,
                explicitMissing: true,
                explicitRecovery: true,
                inertDataProtection: true,
                unresolvedDynamics: true,
                boundedInput: true,
                available: false,
              },
              availability: "unavailable",
              availabilityReason: "web-tree-sitter parse returned no tree",
              analyze: () => {
                throw new Error("not reachable");
              },
            },
            fixture,
            projectionContext,
            createEmptyTree(),
          );
        }
        const projectionContext: TreeSitterProjectionContext = {
          adapterId: "tree-sitter-wasm",
          adapterLabel: "Tree-sitter WASM",
          mode: "wasm",
          identity: baseIdentity,
          version: baseVersion,
          availability: "available",
        };
        return createTreeSitterAnalysis(
          {
            id: "tree-sitter-wasm",
            label: "Tree-sitter WASM",
            mode: "wasm",
            identity: baseIdentity,
            version: baseVersion,
            capabilities: {
              parseTree: true,
              sourceSpans: true,
              explicitErrors: true,
              explicitMissing: true,
              explicitRecovery: true,
              inertDataProtection: true,
              unresolvedDynamics: true,
              boundedInput: true,
              available: true,
            },
            availability: "available",
            analyze: () => {
              throw new Error("not reachable");
            },
          },
          fixture,
          projectionContext,
          tree,
        );
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      id: "tree-sitter-wasm",
      label: "Tree-sitter WASM",
      mode: "wasm",
      identity: baseIdentity,
      version: baseVersion,
      capabilities: {
        parseTree: true,
        sourceSpans: true,
        explicitErrors: true,
        explicitMissing: true,
        explicitRecovery: true,
        inertDataProtection: true,
        unresolvedDynamics: true,
        boundedInput: true,
        available: false,
      },
      availability: "unavailable",
      availabilityReason: reason,
      analyze: (fixture) => {
        const projectionContext: TreeSitterProjectionContext = {
          adapterId: "tree-sitter-wasm",
          adapterLabel: "Tree-sitter WASM",
          mode: "wasm",
          identity: baseIdentity,
          version: baseVersion,
          availability: "unavailable",
          availabilityReason: reason,
        };
        return createTreeSitterAnalysis(
          {
            id: "tree-sitter-wasm",
            label: "Tree-sitter WASM",
            mode: "wasm",
            identity: baseIdentity,
            version: baseVersion,
            capabilities: {
              parseTree: true,
              sourceSpans: true,
              explicitErrors: true,
              explicitMissing: true,
              explicitRecovery: true,
              inertDataProtection: true,
              unresolvedDynamics: true,
              boundedInput: true,
              available: false,
            },
            availability: "unavailable",
            availabilityReason: reason,
            analyze: () => {
              throw new Error("not reachable");
            },
          },
          fixture,
          projectionContext,
          createEmptyTree(),
        );
      },
    };
  }
}
