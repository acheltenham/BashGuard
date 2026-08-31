import path from "node:path";

import type { TreeSitterProjection } from "./tree-sitter-projection.ts";

export type GitTargetEvidenceLevel = "literal" | "candidate" | "verified" | "unknown";
export type GitTargetUnknownReason = "malformed" | "missing-value" | "dynamic" | "conflicting";

export interface GitTargetOptionEvidence {
  readonly option: "-C" | "--git-dir" | "--work-tree";
  readonly value: string;
  readonly rawValue: string;
  readonly quoted: boolean;
}

export interface GitTargetLiteralEvidence {
  readonly evidenceLevel: "literal";
  readonly command: string;
  readonly initialCwd: string;
  readonly quotedWords: readonly string[];
  readonly literalGitTargetOptions: readonly GitTargetOptionEvidence[];
  readonly notes: readonly string[];
}

export interface GitTargetCandidate {
  readonly evidenceLevel: "candidate";
  readonly command: string;
  readonly initialCwd: string;
  readonly resolvedCwd: string;
  readonly resolvedGitDir?: string;
  readonly resolvedWorkTree?: string;
  readonly quotedWords: readonly string[];
  readonly literalGitTargetOptions: readonly GitTargetOptionEvidence[];
  readonly notes: readonly string[];
}

export interface GitTargetUnknown {
  readonly evidenceLevel: "unknown";
  readonly command: string;
  readonly initialCwd: string;
  readonly reason: GitTargetUnknownReason;
  readonly quotedWords: readonly string[];
  readonly literalGitTargetOptions: readonly GitTargetOptionEvidence[];
  readonly notes: readonly string[];
}

export type GitTargetInterpretation = GitTargetLiteralEvidence | GitTargetCandidate | GitTargetUnknown;

type GitTokenKind = "word" | "operator" | "comment";

interface GitToken {
  readonly kind: GitTokenKind;
  readonly raw: string;
  readonly text: string;
  readonly quoted: boolean;
  readonly span: { readonly start: number; readonly end: number };
}

const GIT_TARGET_OPTIONS = new Set(["-C", "--git-dir", "--work-tree"]);
const KNOWN_GIT_SUBCOMMANDS = new Set([
  "add",
  "annotate",
  "apply",
  "archive",
  "bisect",
  "branch",
  "bundle",
  "cherry",
  "cherry-pick",
  "clean",
  "clone",
  "commit",
  "diff",
  "fetch",
  "grep",
  "init",
  "log",
  "merge",
  "mv",
  "pull",
  "push",
  "rebase",
  "reset",
  "rev-parse",
  "rm",
  "show",
  "status",
  "stash",
  "switch",
  "tag",
  "worktree",
]);

function normalizeShellWord(raw: string): string {
  const trimmed = raw.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1).replaceAll(/\\(.)/g, "$1");
  }
  return trimmed.replaceAll(/\\(.)/g, "$1");
}

function looksLikeDynamicWord(raw: string): boolean {
  return /\$\(|\$\{|`|<\(|\$[A-Za-z_{]/.test(raw);
}

function isAssignmentToken(text: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(text);
}

function isOperatorAt(command: string, index: number): string | undefined {
  const pair = command.slice(index, index + 2);
  if (pair === "&&" || pair === "||" || pair === "|&") return pair;
  const single = command[index];
  if (single === "&" || single === "|" || single === ";" || single === "\n") return single;
  return undefined;
}

function scanGitTokens(command: string): readonly GitToken[] {
  const tokens: GitToken[] = [];
  for (let index = 0; index < command.length;) {
    const start = index;
    const char = command[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "#") {
      tokens.push({ kind: "comment", raw: command.slice(index), text: command.slice(index), quoted: false, span: { start: index, end: command.length } });
      break;
    }
    const operator = isOperatorAt(command, index);
    if (operator) {
      tokens.push({ kind: "operator", raw: operator, text: operator, quoted: false, span: { start: index, end: index + operator.length } });
      index += operator.length;
      continue;
    }
    let raw = "";
    let quoted = false;
    while (index < command.length) {
      const current = command[index]!;
      if (/\s/.test(current) || current === "#" || isOperatorAt(command, index)) break;
      if (current === '"' || current === "'") {
        quoted = true;
        const quote = current;
        raw += current;
        index += 1;
        while (index < command.length) {
          const inner = command[index]!;
          raw += inner;
          index += 1;
          if (quote === '"' && inner === "\\" && index < command.length) {
            raw += command[index]!;
            index += 1;
            continue;
          }
          if (inner === quote) break;
        }
        continue;
      }
      if (current === "\\" && index + 1 < command.length) {
        raw += current;
        raw += command[index + 1]!;
        index += 2;
        continue;
      }
      raw += current;
      index += 1;
    }
    tokens.push({ kind: "word", raw, text: normalizeShellWord(raw), quoted, span: { start, end: index } });
  }
  return tokens;
}

function isKnownSubcommandLike(text: string): boolean {
  return KNOWN_GIT_SUBCOMMANDS.has(text);
}

function looksLikeMissingValue(text: string): boolean {
  return text.startsWith("-") || isKnownSubcommandLike(text);
}

function collectQuotedWords(projection?: Pick<TreeSitterProjection, "segments">): readonly string[] {
  if (!projection) return [];
  const words = new Set<string>();
  for (const segment of projection.segments) {
    if (segment.kind === "quoted") words.add(segment.text);
  }
  return [...words];
}

function uniqueNotes(notes: readonly string[]): readonly string[] {
  return [...new Set(notes.filter((note) => note.trim().length > 0))];
}

function parseGitTargetOptions(command: string):
  | {
      readonly literalGitTargetOptions: readonly GitTargetOptionEvidence[];
      readonly notes: readonly string[];
      readonly reason?: undefined;
    }
  | {
      readonly literalGitTargetOptions: readonly GitTargetOptionEvidence[];
      readonly notes: readonly string[];
      readonly reason: GitTargetUnknownReason;
    } {
  const tokens = scanGitTokens(command);
  const gitIndex = tokens.findIndex((token) => token.kind === "word" && !isAssignmentToken(token.text) && token.text === "git");
  if (gitIndex < 0) {
    return {
      literalGitTargetOptions: [],
      notes: ["first executable token is not git"],
      reason: "malformed",
    };
  }

  const options: GitTargetOptionEvidence[] = [];
  const notes: string[] = [];
  const seen = new Map<Exclude<GitTargetOptionEvidence["option"], "-C">, string>();

  for (let index = gitIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== "word") break;
    if (isAssignmentToken(token.text)) continue;
    if (token.text === "-C" || token.text === "--git-dir" || token.text === "--work-tree") {
      const next = tokens[index + 1];
      if (!next || next.kind !== "word") {
        return { literalGitTargetOptions: options, notes: [...notes, `missing value for ${token.text}`], reason: "missing-value" };
      }
      if (looksLikeDynamicWord(next.raw)) {
        return { literalGitTargetOptions: options, notes: [...notes, `dynamic value for ${token.text}`], reason: "dynamic" };
      }
      if (looksLikeMissingValue(next.text) && !next.quoted && !/[./~\\]/.test(next.text)) {
        return { literalGitTargetOptions: options, notes: [...notes, `missing value for ${token.text}`], reason: "missing-value" };
      }
      const option = token.text as GitTargetOptionEvidence["option"];
      const value = normalizeShellWord(next.raw);
      if (option !== "-C") {
        const prior = seen.get(option);
        if (prior !== undefined && prior !== value) {
          return { literalGitTargetOptions: options, notes: [...notes, `conflicting ${option} values`], reason: "conflicting" };
        }
        seen.set(option, value);
      }
      options.push({ option, value, rawValue: next.raw, quoted: next.quoted });
      index += 1;
      continue;
    }
    if (token.text.startsWith("-C=") || token.text.startsWith("--git-dir=") || token.text.startsWith("--work-tree=")) {
      const equalsIndex = token.text.indexOf("=");
      const option = token.text.slice(0, equalsIndex) as GitTargetOptionEvidence["option"];
      const rawValue = token.raw.slice(equalsIndex + 1);
      if (!rawValue) {
        return { literalGitTargetOptions: options, notes: [...notes, `missing value for ${option}`], reason: "missing-value" };
      }
      if (looksLikeDynamicWord(rawValue)) {
        return { literalGitTargetOptions: options, notes: [...notes, `dynamic value for ${option}`], reason: "dynamic" };
      }
      const value = normalizeShellWord(rawValue);
      if (option !== "-C") {
        const prior = seen.get(option as Exclude<GitTargetOptionEvidence["option"], "-C">);
        if (prior !== undefined && prior !== value) {
          return { literalGitTargetOptions: options, notes: [...notes, `conflicting ${option} values`], reason: "conflicting" };
        }
        seen.set(option as Exclude<GitTargetOptionEvidence["option"], "-C">, value);
      }
      options.push({ option, value, rawValue, quoted: /^['"`]/.test(rawValue) });
      continue;
    }
    break;
  }

  return { literalGitTargetOptions: options, notes };
}

export function projectGitTargetLiteralEvidence(
  command: string,
  initialCwd: string,
  projection?: Pick<TreeSitterProjection, "segments">,
): GitTargetLiteralEvidence | GitTargetUnknown {
  const parsed = parseGitTargetOptions(command);
  const quotedWords = uniqueNotes([
    ...collectQuotedWords(projection),
    ...parsed.literalGitTargetOptions.filter((entry) => entry.quoted).map((entry) => entry.rawValue),
  ]);

  if ("reason" in parsed) {
    const reason = parsed.reason ?? "malformed";
    return {
      evidenceLevel: "unknown",
      command,
      initialCwd,
      reason,
      quotedWords,
      literalGitTargetOptions: parsed.literalGitTargetOptions,
      notes: uniqueNotes(parsed.notes),
    };
  }

  return {
    evidenceLevel: "literal",
    command,
    initialCwd,
    quotedWords,
    literalGitTargetOptions: parsed.literalGitTargetOptions,
    notes: uniqueNotes(parsed.notes),
  };
}

export function resolveGitTargetCandidate(
  interpretation: GitTargetLiteralEvidence,
): GitTargetCandidate {
  let resolvedCwd = interpretation.initialCwd;
  let resolvedGitDir: string | undefined;
  let resolvedWorkTree: string | undefined;
  const notes = [...interpretation.notes];

  for (const option of interpretation.literalGitTargetOptions) {
    if (option.option === "-C") {
      resolvedCwd = path.resolve(resolvedCwd, option.value);
      notes.push(`resolved -C to ${resolvedCwd}`);
      continue;
    }
    if (option.option === "--git-dir") {
      resolvedGitDir = path.resolve(resolvedCwd, option.value);
      notes.push(`resolved --git-dir to ${resolvedGitDir}`);
      continue;
    }
    if (option.option === "--work-tree") {
      resolvedWorkTree = path.resolve(resolvedCwd, option.value);
      notes.push(`resolved --work-tree to ${resolvedWorkTree}`);
    }
  }

  return {
    evidenceLevel: "candidate",
    command: interpretation.command,
    initialCwd: interpretation.initialCwd,
    resolvedCwd,
    resolvedGitDir,
    resolvedWorkTree,
    quotedWords: interpretation.quotedWords,
    literalGitTargetOptions: interpretation.literalGitTargetOptions,
    notes: uniqueNotes(notes),
  };
}
