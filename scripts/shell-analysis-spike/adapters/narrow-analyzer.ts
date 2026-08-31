import {
  extractLiteralGitTargetOptions,
  matchesForcedGitClean,
  matchesGitResetHard,
  matchesRecursiveForcedDeletion,
} from "../../../src/command-risk.ts";

import {
  diagnostic,
  protectedCheck,
  segment,
  span,
  unresolved,
  wrapper,
  type CommandSegment,
  type CorpusFixture,
  type Diagnostic,
  type LiteralGitTargetOption,
  type ProtectedCheckObservation,
  type RedirectionObservation,
  type SegmentRelationLink,
  type SourceSpan,
  type UnresolvedConstruct,
  type WrapperObservation,
  redirection,
  relation,
} from "../model.ts";

export interface NarrowAnalyzerAnalysis {
  readonly adapterId: "narrow-analyzer";
  readonly adapterLabel: string;
  readonly command: string;
  readonly status: "structured" | "degraded" | "unsupported" | "failed";
  readonly textualEvidence: readonly string[];
  readonly protectedChecks: readonly ProtectedCheckObservation[];
  readonly literalGitTargetOptions: readonly LiteralGitTargetOption[];
  readonly limitations: readonly string[];
  readonly unsupportedConstructs: readonly UnresolvedConstruct[];
  readonly diagnostics: readonly Diagnostic[];
  readonly structuralFacts: readonly string[];
  readonly capabilities: {
    readonly structural: true;
    readonly checks: true;
    readonly literalGitTargets: true;
  };
}

type TokenKind = "word" | "quoted" | "escaped" | "operator" | "comment" | "substitution" | "redirection";

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly span: SourceSpan;
}

const OPERATOR_PATTERNS = ["&&", "||", "|&", "<<", ">>", "2>", "&>", ";", "&", "|", "(", ")"] as const;

function isWordChar(char: string): boolean {
  return /[A-Za-z0-9_./~=-]/.test(char);
}

function scan(command: string): readonly Token[] {
  const tokens: Token[] = [];
  for (let index = 0; index < command.length;) {
    const char = command[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "#") {
      tokens.push({ kind: "comment", text: command.slice(index), span: span(index, command.length) });
      break;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let cursor = index + 1;
      while (cursor < command.length) {
        const current = command[cursor]!;
        if (current === "\\" && quote === '"') {
          cursor += 2;
          continue;
        }
        if (current === quote) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      tokens.push({ kind: "quoted", text: command.slice(index, cursor), span: span(index, cursor) });
      index = cursor;
      continue;
    }
    if (char === "$") {
      const end = Math.min(command.length, index + 2);
      tokens.push({ kind: "substitution", text: command.slice(index, end), span: span(index, end) });
      index = end;
      continue;
    }
    if (char === "\\") {
      const end = Math.min(command.length, index + 2);
      tokens.push({ kind: "escaped", text: command.slice(index, end), span: span(index, end) });
      index = end;
      continue;
    }
    const operator = OPERATOR_PATTERNS.find((pattern) => command.startsWith(pattern, index));
    if (operator) {
      tokens.push({ kind: operator === ";" || operator === "&" || operator === "|" || operator === "(" || operator === ")" ? "operator" : "redirection", text: operator, span: span(index, index + operator.length) });
      index += operator.length;
      continue;
    }
    let cursor = index + 1;
    while (cursor < command.length && !/\s/.test(command[cursor]!) && !OPERATOR_PATTERNS.some((pattern) => command.startsWith(pattern, cursor)) && command[cursor] !== "#") cursor += 1;
    tokens.push({ kind: "word", text: command.slice(index, cursor), span: span(index, cursor) });
    index = cursor;
  }
  return tokens;
}

function pushRelation(relations: SegmentRelationLink[], relationType: SegmentRelationLink["relation"], targetId: string): void {
  if (!relations.some((entry) => entry.relation === relationType && entry.targetId === targetId)) relations.push(relation(relationType, targetId));
}

function makeCommandSegment(command: string): CommandSegment {
  return segment("command", "command", command, span(0, command.length));
}

function unsupported(command: string, kind: UnresolvedConstruct["kind"], note: string, start = 0, end = command.length): UnresolvedConstruct {
  return unresolved(`unsupported-${kind}-${start}-${end}`, kind, command.slice(start, end), span(start, end), note);
}

export function analyzeWithNarrowAnalyzer(command: string): NarrowAnalyzerAnalysis {
  const tokens = scan(command);
  const segments: CommandSegment[] = [makeCommandSegment(command)];
  const wrappers: WrapperObservation[] = [];
  const redirections: RedirectionObservation[] = [];
  const unsupportedConstructs: UnresolvedConstruct[] = [];
  const diagnostics: Diagnostic[] = [];
  const structuralFacts: string[] = [];

  for (const token of tokens) {
    if (token.kind === "comment") {
      segments.push(segment(`comment-${token.span.start}`, "comment", token.text, token.span));
      continue;
    }
    if (token.kind === "quoted") {
      segments.push(segment(`quoted-${token.span.start}`, "quoted", token.text, token.span));
      if (token.text.includes("$(")) unsupportedConstructs.push(unsupported(command, "command-substitution", "command substitution inside quotes is unsupported", token.span.start, token.span.end));
      continue;
    }
    if (token.kind === "escaped") {
      segments.push(segment(`escaped-${token.span.start}`, "escaped", token.text, token.span));
      continue;
    }
    if (token.kind === "substitution") {
      unsupportedConstructs.push(unsupported(command, "command-substitution", "command substitution is unsupported", token.span.start, token.span.end));
      segments.push(segment(`substitution-${token.span.start}`, "substitution", token.text, token.span));
      continue;
    }
    if (token.kind === "redirection") {
      redirections.push(redirection(`redir-${token.span.start}`, token.text as RedirectionObservation["operator"], token.text, token.span));
      segments.push(segment(`redir-${token.span.start}`, "redirect", token.text, token.span));
      continue;
    }
    segments.push(segment(`word-${token.span.start}`, token.text.includes("=") && !token.text.startsWith("=") ? "assignment" : "word", token.text, token.span));
  }

  const firstWord = tokens.find((token) => token.kind === "word" || token.kind === "quoted");
  if (firstWord?.text === "env") wrappers.push(wrapper("wrapper-env", "env", firstWord.text, firstWord.span));
  if (firstWord?.text === "source" || firstWord?.text === ".") wrappers.push(wrapper("wrapper-source", "shell", firstWord.text, firstWord.span));
  if (command.includes("$(")) unsupportedConstructs.push(unsupported(command, "command-substitution", "nested command substitution is unsupported", command.indexOf("$("), command.indexOf("$(") + 2));
  if (command.includes("<(")) unsupportedConstructs.push(unsupported(command, "process-substitution", "process substitution is unsupported", command.indexOf("<("), command.indexOf("<(") + 2));
  if (command.includes("eval ")) unsupportedConstructs.push(unsupported(command, "eval", "eval is treated as unsupported dynamic execution", command.indexOf("eval"), command.indexOf("eval") + 4));
  if (command.includes("alias ")) unsupportedConstructs.push(unsupported(command, "alias", "alias expansion is unsupported", command.indexOf("alias"), command.indexOf("alias") + 5));
  if (command.includes("function") || command.includes("(){")) unsupportedConstructs.push(unsupported(command, "function", "function bodies are unsupported", command.indexOf("function"), command.length));
  if (command.includes("\n")) diagnostics.push(diagnostic("newline", "info", "multi-line input is scanned conservatively"));
  if (command.length > 160) diagnostics.push(diagnostic("bounded-input", "warning", "input length exceeds the narrow analyzer comfort zone"));

  const protectedChecks: ProtectedCheckObservation[] = [];
  if (matchesRecursiveForcedDeletion(command)) protectedChecks.push(protectedCheck("recursive-forced-deletion", "matched", "observed", "recursive deletion matched"));
  if (matchesGitResetHard(command)) protectedChecks.push(protectedCheck("git-reset-hard", "matched", "observed", "git reset --hard matched"));
  if (matchesForcedGitClean(command)) protectedChecks.push(protectedCheck("git-clean-forced", "matched", "observed", "git clean -f matched"));
  const literalGitTargetOptions = extractLiteralGitTargetOptions(command);

  const status = unsupportedConstructs.length > 0 ? "degraded" : "structured";
  const limitations = [
    "deliberately bounded scanner; not a full shell grammar",
    "unsupported constructs are recorded explicitly rather than guessed",
    "runtime expansion, aliases, and command substitution are not resolved",
  ];
  if (unsupportedConstructs.some((entry) => entry.kind === "command-substitution" || entry.kind === "process-substitution")) {
    limitations.push("substitutions remain unresolved and may hide executed text");
  }

  const structuralFactsOut = [
    ...segments.map((entry) => entry.id),
    ...wrappers.map((entry) => entry.id),
    ...redirections.map((entry) => entry.id),
    ...unsupportedConstructs.map((entry) => entry.id),
  ];

  return {
    adapterId: "narrow-analyzer",
    adapterLabel: "Narrow shell analyzer",
    command,
    status,
    textualEvidence: segments.map((entry) => entry.text),
    protectedChecks,
    literalGitTargetOptions,
    limitations,
    unsupportedConstructs,
    diagnostics,
    structuralFacts: structuralFactsOut,
    capabilities: {
      structural: true,
      checks: true,
      literalGitTargets: true,
    },
  };
}

export function analyzeCorpusWithNarrowAnalyzer(fixtures: readonly CorpusFixture[]): readonly NarrowAnalyzerAnalysis[] {
  return fixtures.map((fixture) => analyzeWithNarrowAnalyzer(fixture.command));
}
