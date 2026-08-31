import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import Parser from "tree-sitter";
import BashLanguage from "tree-sitter-bash";

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
      `tree-sitter native parser v${adapter.version.parser}`,
      projection.status === "degraded" ? "parse issues and unresolved constructs are explicit" : "parse issues remain explicit when present",
    ],
  };
}

export async function createTreeSitterNativeAdapter(): Promise<TreeSitterAdapter> {
  const parser = new Parser();
  parser.setLanguage(BashLanguage);
  const adapter: TreeSitterAdapter = {
    id: "tree-sitter-native",
    label: "Tree-sitter native",
    mode: "native",
    identity: {
      parser: "tree-sitter",
      language: "bash",
      mode: "native",
    },
    version: {
      adapter: packageVersion("tree-sitter"),
      parser: packageVersion("tree-sitter"),
      language: packageVersion("tree-sitter-bash"),
    },
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
          adapterId: "tree-sitter-native",
          adapterLabel: "Tree-sitter native",
          mode: "native",
          identity: {
            parser: "tree-sitter",
            language: "bash",
            mode: "native",
          },
          version: {
            adapter: "0.25.1",
            parser: packageVersion("tree-sitter"),
            language: packageVersion("tree-sitter-bash"),
          },
          availability: "unavailable",
          availabilityReason: "analysis aborted before parsing",
        };
        return createTreeSitterAnalysis(adapter, fixture, projectionContext, createEmptyTree());
      }
      const tree = parser.parse(fixture.command);
      if (!tree) {
        const projectionContext: TreeSitterProjectionContext = {
          adapterId: adapter.id,
          adapterLabel: adapter.label,
          mode: adapter.mode,
          identity: adapter.identity,
          version: adapter.version,
          availability: "unavailable",
          availabilityReason: "native parser returned no tree",
        };
        return createTreeSitterAnalysis(adapter, fixture, projectionContext, createEmptyTree());
      }
      const projectionContext: TreeSitterProjectionContext = {
        adapterId: adapter.id,
        adapterLabel: adapter.label,
        mode: adapter.mode,
        identity: adapter.identity,
        version: adapter.version,
        availability: adapter.availability,
      };
      return createTreeSitterAnalysis(adapter, fixture, projectionContext, tree);
    },
  };
  return adapter;
}
