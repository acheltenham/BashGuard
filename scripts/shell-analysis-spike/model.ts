export const ANALYSIS_STATUSES = ["structured", "degraded", "unsupported", "failed"] as const;
export const EVIDENCE_LEVELS = ["observed", "reported", "inferred", "unknown"] as const;
export const SEGMENT_KINDS = [
  "command",
  "word",
  "operator",
  "assignment",
  "wrapper",
  "redirect",
  "heredoc",
  "subshell",
  "group",
  "quoted",
  "escaped",
  "substitution",
  "comment",
  "dynamic-sink",
  "unknown",
] as const;
export const SEGMENT_ROLES = [
  "executable",
  "literal",
  "operator",
  "wrapper",
  "assignment",
  "redirect",
  "group",
  "subshell",
  "inert",
  "dynamic",
  "unknown",
] as const;
export const SEGMENT_RELATIONS = [
  "contains",
  "precedes",
  "follows",
  "wraps",
  "redirects-to",
  "targets",
  "guards",
  "expands-into",
  "branches-to",
] as const;
export const CORPUS_SUBSETS = ["supported", "degraded", "unsupported"] as const;
export const PROTECTED_CHECK_OUTCOMES = ["matched", "not-matched", "unknown"] as const;
export const DIAGNOSTIC_SEVERITIES = ["info", "warning", "error"] as const;
export const CORPUS_ID_PATTERN = /^sa-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];
export type SegmentKind = (typeof SEGMENT_KINDS)[number];
export type SegmentRole = (typeof SEGMENT_ROLES)[number];
export type SegmentRelation = (typeof SEGMENT_RELATIONS)[number];
export type CorpusSubset = (typeof CORPUS_SUBSETS)[number];
export type ProtectedCheckOutcome = (typeof PROTECTED_CHECK_OUTCOMES)[number];
export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number];

export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

export interface SegmentRelationLink {
  readonly relation: SegmentRelation;
  readonly targetId: string;
}

export interface CommandSegment {
  readonly id: string;
  readonly kind: SegmentKind;
  readonly role: SegmentRole;
  readonly text: string;
  readonly span: SourceSpan;
  readonly relations: readonly SegmentRelationLink[];
}

export interface WrapperObservation {
  readonly id: string;
  readonly kind: "assignment" | "env" | "prefix" | "shell" | "subshell";
  readonly text: string;
  readonly span: SourceSpan;
  readonly relations: readonly SegmentRelationLink[];
}

export interface RedirectionObservation {
  readonly id: string;
  readonly operator: "<" | "<<" | ">" | ">>" | "2>" | "2>>" | "&>";
  readonly text: string;
  readonly span: SourceSpan;
  readonly targetText?: string;
  readonly targetSpan?: SourceSpan;
  readonly bodySpan?: SourceSpan;
  readonly relations: readonly SegmentRelationLink[];
}

export interface UnresolvedConstruct {
  readonly id: string;
  readonly kind:
    | "alias"
    | "command-substitution"
    | "eval"
    | "function"
    | "parameter-expansion"
    | "parse-error"
    | "pipeline-runtime"
    | "process-substitution"
    | "quoted-text"
    | "shell-expansion"
    | "unknown";
  readonly text: string;
  readonly span: SourceSpan;
  readonly note: string;
}

export interface Diagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly span?: SourceSpan;
}

export interface ProtectedCheckObservation {
  readonly checkId: "recursive-forced-deletion" | "git-reset-hard" | "git-clean-forced";
  readonly outcome: ProtectedCheckOutcome;
  readonly evidenceLevel: EvidenceLevel;
  readonly text: string;
}

export interface LiteralGitTargetOption {
  readonly option: "-C" | "--git-dir" | "--work-tree";
  readonly value: string;
}

export interface CommandAnalysisExpectation {
  readonly status: AnalysisStatus;
  readonly evidenceLevel: EvidenceLevel;
  readonly subset: CorpusSubset;
  readonly segments: readonly CommandSegment[];
  readonly wrappers: readonly WrapperObservation[];
  readonly redirections: readonly RedirectionObservation[];
  readonly unresolved: readonly UnresolvedConstruct[];
  readonly protectedChecks: readonly ProtectedCheckObservation[];
  readonly literalGitTargetOptions?: readonly LiteralGitTargetOption[];
  readonly diagnostics: readonly Diagnostic[];
  readonly runtimeUnknowns: readonly string[];
}

export interface CorpusFixture {
  readonly id: string;
  readonly title: string;
  readonly family:
    | "background-and-or"
    | "pipe-both"
    | "comments-printf"
    | "heredoc-inert-data"
    | "escaped-quoted-paths"
    | "git-sequential-targeting"
    | "git-missing-conflicting-options"
    | "path-operation-collision"
    | "option-character-collision"
    | "alias-function"
    | "source-dot"
    | "bash-sh-c"
    | "python-node-c"
    | "xargs-variants"
    | "find-exec"
    | "process-substitution"
    | "parameter-expansion"
    | "eval"
    | "malformed-recovery"
    | "long-bounded"
    | "command-resolution-shape"
    | "protected-check";
  readonly command: string;
  readonly expected: CommandAnalysisExpectation;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

export function freezeCorpusFixture<T extends CorpusFixture>(fixture: T): T {
  return deepFreeze(fixture);
}

export function span(start: number, end: number): SourceSpan {
  if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error("span offsets must be integers");
  if (start < 0 || end < start) throw new Error("span offsets must be ordered and non-negative");
  return deepFreeze({ start, end });
}

export function relation(relation: SegmentRelation, targetId: string): SegmentRelationLink {
  return deepFreeze({ relation, targetId });
}

function inferRole(kind: SegmentKind): SegmentRole {
  switch (kind) {
    case "command":
      return "executable";
    case "word":
    case "escaped":
      return "literal";
    case "operator":
      return "operator";
    case "assignment":
      return "assignment";
    case "wrapper":
      return "wrapper";
    case "redirect":
      return "redirect";
    case "group":
      return "group";
    case "subshell":
      return "subshell";
    case "quoted":
    case "heredoc":
    case "comment":
      return "inert";
    case "substitution":
    case "dynamic-sink":
      return "dynamic";
    default:
      return "unknown";
  }
}

export function segment(
  id: string,
  kind: SegmentKind,
  text: string,
  spanValue: SourceSpan,
  relations: readonly SegmentRelationLink[] = [],
  role: SegmentRole = inferRole(kind),
): CommandSegment {
  return deepFreeze({ id, kind, role, text, span: spanValue, relations: [...relations] });
}

export function wrapper(
  id: string,
  kind: WrapperObservation["kind"],
  text: string,
  spanValue: SourceSpan,
  relations: readonly SegmentRelationLink[] = [],
): WrapperObservation {
  return deepFreeze({ id, kind, text, span: spanValue, relations: [...relations] });
}

export function redirection(
  id: string,
  operator: RedirectionObservation["operator"],
  text: string,
  spanValue: SourceSpan,
  targetText?: string,
  targetSpan?: SourceSpan,
  bodySpan?: SourceSpan,
  relations: readonly SegmentRelationLink[] = [],
): RedirectionObservation {
  return deepFreeze({ id, operator, text, span: spanValue, targetText, targetSpan, bodySpan, relations: [...relations] });
}

export function unresolved(
  id: string,
  kind: UnresolvedConstruct["kind"],
  text: string,
  spanValue: SourceSpan,
  note: string,
): UnresolvedConstruct {
  return deepFreeze({ id, kind, text, span: spanValue, note });
}

export function diagnostic(code: string, severity: DiagnosticSeverity, message: string, spanValue?: SourceSpan): Diagnostic {
  return deepFreeze({ code, severity, message, span: spanValue });
}

export function protectedCheck(
  checkId: ProtectedCheckObservation["checkId"],
  outcome: ProtectedCheckOutcome,
  evidenceLevel: EvidenceLevel,
  text: string,
): ProtectedCheckObservation {
  return deepFreeze({ checkId, outcome, evidenceLevel, text });
}

export function expectation(expectation: CommandAnalysisExpectation): CommandAnalysisExpectation {
  return deepFreeze({
    status: expectation.status,
    evidenceLevel: expectation.evidenceLevel,
    subset: expectation.subset,
    segments: [...expectation.segments],
    wrappers: [...expectation.wrappers],
    redirections: [...expectation.redirections],
    unresolved: [...expectation.unresolved],
    protectedChecks: [...expectation.protectedChecks],
    literalGitTargetOptions: [...(expectation.literalGitTargetOptions ?? [])],
    diagnostics: [...expectation.diagnostics],
    runtimeUnknowns: [...expectation.runtimeUnknowns],
  });
}

export function fixture(fixture: CorpusFixture): CorpusFixture {
  if (!CORPUS_ID_PATTERN.test(fixture.id)) throw new Error(`invalid corpus fixture id: ${fixture.id}`);
  return deepFreeze({
    id: fixture.id,
    title: fixture.title,
    family: fixture.family,
    command: fixture.command,
    expected: expectation(fixture.expected),
  });
}
