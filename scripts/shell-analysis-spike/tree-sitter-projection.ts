import { matchesForcedGitClean, matchesGitResetHard, matchesRecursiveForcedDeletion, extractLiteralGitTargetOptions } from "../../src/command-risk.ts";

import { type CorpusFixture } from "./model.ts";
import { type ComparisonState } from "./evaluate.ts";
import {
  diagnostic,
  expectation,
  protectedCheck,
  relation,
  redirection,
  segment,
  span,
  type AnalysisStatus,
  type CommandSegment,
  type CorpusSubset,
  type Diagnostic,
  type EvidenceLevel,
  type LiteralGitTargetOption,
  type ProtectedCheckObservation,
  type RedirectionObservation,
  type SegmentRelationLink,
  type SegmentRole,
  type SourceSpan,
  type UnresolvedConstruct,
  type WrapperObservation,
  unresolved,
  wrapper,
} from "./model.ts";

export type TreeSitterMode = "native" | "wasm";

export interface TreeSitterAdapterIdentity {
  readonly parser: "tree-sitter" | "web-tree-sitter";
  readonly language: "bash";
  readonly mode: TreeSitterMode;
}

export interface TreeSitterAdapterVersion {
  readonly adapter: string;
  readonly parser: string;
  readonly language: string;
}

export interface TreeSitterAdapterCapabilities {
  readonly parseTree: true;
  readonly sourceSpans: true;
  readonly explicitErrors: true;
  readonly explicitMissing: true;
  readonly explicitRecovery: true;
  readonly inertDataProtection: true;
  readonly unresolvedDynamics: true;
  readonly boundedInput: true;
  readonly available: boolean;
}

export interface TreeSitterProjectionLimits {
  readonly maxSourceLength?: number;
  readonly maxNodes?: number;
  readonly maxDepth?: number;
}

export interface TreeSitterProjectionContext {
  readonly adapterId: string;
  readonly adapterLabel: string;
  readonly mode: TreeSitterMode;
  readonly identity: TreeSitterAdapterIdentity;
  readonly version: TreeSitterAdapterVersion;
  readonly availability: "available" | "unavailable";
  readonly availabilityReason?: string;
}

export interface TreeSitterParseIssue {
  readonly kind: "error" | "missing" | "recovery";
  readonly text: string;
  readonly span: SourceSpan;
  readonly note: string;
}

export interface TreeSitterAssignmentObservation {
  readonly id: string;
  readonly kind: "leading" | "environment" | "inline";
  readonly text: string;
  readonly span: SourceSpan;
  readonly relations: readonly SegmentRelationLink[];
}

export interface TreeSitterProjection {
  readonly adapterId: string;
  readonly adapterLabel: string;
  readonly mode: TreeSitterMode;
  readonly identity: TreeSitterAdapterIdentity;
  readonly version: TreeSitterAdapterVersion;
  readonly availability: "available" | "unavailable";
  readonly availabilityReason?: string;
  readonly status: AnalysisStatus;
  readonly sourceLength: number;
  readonly segments: readonly CommandSegment[];
  readonly wrappers: readonly WrapperObservation[];
  readonly assignments: readonly TreeSitterAssignmentObservation[];
  readonly redirects: readonly RedirectionObservation[];
  readonly redirections: readonly RedirectionObservation[];
  readonly unresolved: readonly UnresolvedConstruct[];
  readonly parseIssues: readonly TreeSitterParseIssue[];
  readonly diagnostics: readonly Diagnostic[];
  readonly protectedChecks: readonly ProtectedCheckObservation[];
  readonly literalGitTargetOptions: readonly LiteralGitTargetOption[];
  readonly facts: readonly string[];
}

export interface TreeSitterAnalysis {
  readonly adapterId: string;
  readonly adapterLabel: string;
  readonly mode: TreeSitterMode;
  readonly identity: TreeSitterAdapterIdentity;
  readonly version: TreeSitterAdapterVersion;
  readonly availability: "available" | "unavailable";
  readonly availabilityReason?: string;
  readonly command: string;
  readonly status: AnalysisStatus;
  readonly projection: TreeSitterProjection;
  readonly textualEvidence: readonly string[];
  readonly protectedChecks: readonly ProtectedCheckObservation[];
  readonly literalGitTargetOptions: readonly LiteralGitTargetOption[];
  readonly structuralFacts: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
  readonly limitations: readonly string[];
}

export interface TreeSitterAdapter {
  readonly id: string;
  readonly label: string;
  readonly mode: TreeSitterMode;
  readonly identity: TreeSitterAdapterIdentity;
  readonly version: TreeSitterAdapterVersion;
  readonly capabilities: TreeSitterAdapterCapabilities;
  readonly availability: "available" | "unavailable";
  readonly availabilityReason?: string;
  analyze(fixture: CorpusFixture, signal: AbortSignal): TreeSitterAnalysis | Promise<TreeSitterAnalysis>;
}

export interface TreeSitterFixtureEvaluation {
  readonly fixtureId: string;
  readonly title: string;
  readonly expected: {
    readonly status: AnalysisStatus;
    readonly evidenceLevel: EvidenceLevel;
    readonly subset: CorpusSubset;
    readonly protectedChecks: readonly { readonly checkId: string; readonly outcome: string }[];
    readonly literalGitTargetOptions: readonly LiteralGitTargetOption[];
  };
  readonly analysis: TreeSitterAnalysis;
  readonly comparison: {
    readonly status: ComparisonState;
    readonly protectedChecks: ComparisonState;
    readonly literalGitTargets: ComparisonState;
  };
  readonly outcome: "pass" | "mismatch" | "error" | "timeout";
  readonly notes: readonly string[];
  readonly durationMs: number;
}

export interface TreeSitterCorpusEvaluation {
  readonly adapterId: string;
  readonly adapterLabel: string;
  readonly mode: TreeSitterMode;
  readonly identity: TreeSitterAdapterIdentity;
  readonly version: TreeSitterAdapterVersion;
  readonly capabilities: TreeSitterAdapterCapabilities;
  readonly fixtures: readonly TreeSitterFixtureEvaluation[];
  readonly summary: {
    readonly pass: number;
    readonly mismatch: number;
    readonly error: number;
    readonly timeout: number;
  };
}

export interface TreeLikeNode {
  readonly type: string;
  readonly isNamed: boolean;
  readonly isMissing: boolean;
  readonly hasError: boolean;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly childCount: number;
  child(index: number): TreeLikeNode | null;
}

export interface TreeLikeParseTree {
  readonly rootNode: TreeLikeNode;
}

function getChildren(node: TreeLikeNode): readonly TreeLikeNode[] {
  const children: TreeLikeNode[] = [];
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child) children.push(child);
  }
  return children;
}

function textOf(command: string, node: TreeLikeNode): string {
  return command.slice(node.startIndex, node.endIndex);
}

function segmentKey(role: SegmentRole, spanValue: SourceSpan, text: string): string {
  return `${role}:${spanValue.start}:${spanValue.end}:${text}`;
}

function sortBySpan<T extends { readonly span: SourceSpan }>(entries: readonly T[]): readonly T[] {
  return [...entries].sort((left, right) => left.span.start - right.span.start || left.span.end - right.span.end);
}

function normalizeText(value: string): string {
  return value
    .replaceAll(/\/private\/tmp\/[A-Za-z0-9._/-]+/g, "<tmp-path>")
    .replaceAll(/(?:\/tmp|\/var\/tmp)\/[A-Za-z0-9._/-]+/g, "<tmp-path>")
    .replaceAll(/\b[A-Za-z]:\\[^\s"']+/g, "<drive-path>")
    .replaceAll(/\b\d+(?:\.\d+)?\s*ms\b/gi, "<duration-ms>");
}

function buildProjectionFacts(
  segments: readonly CommandSegment[],
  wrappers: readonly WrapperObservation[],
  redirections: readonly RedirectionObservation[],
  unresolved: readonly UnresolvedConstruct[],
  parseIssues: readonly TreeSitterParseIssue[],
): readonly string[] {
  return [
    `segments=${segments.length}`,
    `executable=${segments.filter((entry) => entry.role === "executable").length}`,
    `literal=${segments.filter((entry) => entry.role === "literal").length}`,
    `wrappers=${wrappers.length}`,
    `redirects=${redirections.length}`,
    `unresolved=${unresolved.length}`,
    `parse-issues=${parseIssues.length}`,
  ];
}

function addRelation(relations: SegmentRelationLink[], relationType: SegmentRelationLink["relation"], targetId: string): void {
  const key = `${relationType}:${targetId}`;
  if (relations.some((entry) => `${entry.relation}:${entry.targetId}` === key)) return;
  relations.push(relation(relationType, targetId));
}

function inferRoleForNode(kind: string): SegmentRole {
  switch (kind) {
    case "command":
    case "command_name":
      return "executable";
    case "variable_assignment":
      return "assignment";
    case "file_redirect":
    case "heredoc_redirect":
      return "redirect";
    case "pipeline":
    case "list":
      return "operator";
    case "subshell":
      return "subshell";
    case "compound_statement":
      return "group";
    case "command_substitution":
    case "process_substitution":
    case "simple_expansion":
    case "arithmetic_expansion":
    case "expansion":
      return "dynamic";
    case "comment":
    case "string":
    case "raw_string":
    case "heredoc_body":
      return "inert";
    default:
      return "literal";
  }
}

function isAssignmentText(text: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(text);
}

function isGitTargetOption(text: string): boolean {
  return text === "-C" || text.startsWith("--git-dir") || text.startsWith("--work-tree");
}

function createEmptyProjection(context: TreeSitterProjectionContext, sourceLength: number): TreeSitterProjection {
  return {
    adapterId: context.adapterId,
    adapterLabel: context.adapterLabel,
    mode: context.mode,
    identity: context.identity,
    version: context.version,
    availability: context.availability,
    availabilityReason: context.availabilityReason,
    status: context.availability === "available" ? "structured" : "unsupported",
    sourceLength,
    segments: [],
    wrappers: [],
    assignments: [],
    redirects: [],
    redirections: [],
    unresolved: [],
    parseIssues: [],
    diagnostics: [],
    protectedChecks: [],
    literalGitTargetOptions: [],
    facts: [],
  };
}

function projectNode(
  command: string,
  node: TreeLikeNode,
  builder: ProjectionBuilder,
  context: VisitContext,
): void {
  if (builder.nodeCount >= builder.limits.maxNodes) {
    builder.limitsHit = `node limit ${builder.limits.maxNodes} reached`;
    return;
  }
  builder.nodeCount += 1;
  if (context.depth > builder.limits.maxDepth) {
    builder.limitsHit = `depth limit ${builder.limits.maxDepth} reached`;
    return;
  }

  if (node.isMissing) {
    builder.parseIssues.push({
      kind: "missing",
      text: textOf(command, node),
      span: span(node.startIndex, node.endIndex),
      note: `missing ${node.type}`,
    });
  }

  if (node.type === "ERROR") {
    builder.parseIssues.push({
      kind: "error",
      text: textOf(command, node),
      span: span(node.startIndex, node.endIndex),
      note: "parse error",
    });
    builder.unresolved.push(
      unresolved(
        `parse-error-${builder.unresolved.length + 1}`,
        "parse-error",
        textOf(command, node),
        span(node.startIndex, node.endIndex),
        "parse errors break reliable structural recovery",
      ),
    );
  } else if (node.hasError) {
    builder.parseIssues.push({
      kind: "recovery",
      text: textOf(command, node),
      span: span(node.startIndex, node.endIndex),
      note: `recovery subtree around ${node.type}`,
    });
  }

  if (builder.limitsHit) return;

  switch (node.type) {
    case "program":
      for (const child of getChildren(node)) projectNode(command, child, builder, { ...context, depth: context.depth + 1 });
      return;

    case "list":
    case "pipeline": {
      const children = getChildren(node);
      const namedChildren = children.filter((child) => child.isNamed);
      const commandChildren: TreeLikeNode[] = [];
      for (const child of children) {
        if (!child.isNamed) {
          const operatorText = textOf(command, child);
          if (operatorText === "&&" || operatorText === "||" || operatorText === "|" || operatorText === "|&" || operatorText === ";" || operatorText === "&" || operatorText === "\n") {
            addSegment(builder, command, child, "operator", "operator", context, undefined, operatorText);
            continue;
          }
        }
        commandChildren.push(child);
      }
      for (const child of commandChildren) projectNode(command, child, builder, { ...context, depth: context.depth + 1 });
      if (namedChildren.length > 1) {
        for (let index = 0; index < namedChildren.length - 1; index += 1) {
          const left = namedChildren[index]!;
          const right = namedChildren[index + 1]!;
          const leftSegment = builder.segmentsBySpan.get(`${left.startIndex}:${left.endIndex}`);
          const rightSegment = builder.segmentsBySpan.get(`${right.startIndex}:${right.endIndex}`);
          if (leftSegment && rightSegment) {
            addRelation(leftSegment.relations as SegmentRelationLink[], "precedes", rightSegment.id);
            addRelation(rightSegment.relations as SegmentRelationLink[], "follows", leftSegment.id);
          }
        }
      }
      return;
    }

    case "redirected_statement": {
      const children = getChildren(node);
      for (const child of children) {
        if (child.type === "file_redirect" || child.type === "heredoc_redirect") {
          projectNode(command, child, builder, { ...context, depth: context.depth + 1 });
          continue;
        }
        projectNode(command, child, builder, { ...context, depth: context.depth + 1 });
      }
      return;
    }

    case "command":
      projectCommand(command, node, builder, context);
      return;

    case "subshell": {
      const segmentEntry = addSegment(builder, command, node, "subshell", "subshell", context);
      const children = getChildren(node).filter((child) => child.isNamed);
      for (const child of children) {
        projectNode(command, child, builder, { ...context, depth: context.depth + 1 });
        const childSegment = builder.segmentsBySpan.get(`${child.startIndex}:${child.endIndex}`);
        if (childSegment) addRelation(segmentEntry.relations as SegmentRelationLink[], "contains", childSegment.id);
      }
      return;
    }

    case "compound_statement": {
      const segmentEntry = addSegment(builder, command, node, "group", "group", context);
      for (const child of getChildren(node).filter((child) => child.isNamed)) {
        projectNode(command, child, builder, { ...context, depth: context.depth + 1 });
        const childSegment = builder.segmentsBySpan.get(`${child.startIndex}:${child.endIndex}`);
        if (childSegment) addRelation(segmentEntry.relations as SegmentRelationLink[], "contains", childSegment.id);
      }
      return;
    }

    case "variable_assignment":
      addAssignment(builder, command, node, context, false);
      return;

    case "command_name":
      addCommandName(builder, command, node, context, undefined);
      for (const child of getChildren(node)) projectNode(command, child, builder, { ...context, depth: context.depth + 1 });
      return;

    case "file_redirect":
      addFileRedirect(builder, command, node, context);
      return;

    case "heredoc_redirect":
      addHeredocRedirect(builder, command, node, context);
      return;

    case "comment":
      addSegment(builder, command, node, "comment", "inert", context);
      return;

    case "string":
      addSegment(builder, command, node, "quoted", "inert", context);
      for (const child of getChildren(node)) {
        if (child.type === "command_substitution" || child.type === "process_substitution" || child.type === "simple_expansion" || child.type === "arithmetic_expansion" || child.type === "expansion") {
          projectNode(command, child, builder, { ...context, depth: context.depth + 1, insideQuoted: true });
        }
      }
      return;

    case "raw_string":
      addSegment(builder, command, node, "quoted", "inert", context);
      return;

    case "command_substitution":
      addSegment(builder, command, node, "substitution", "dynamic", context);
      builder.unresolved.push(
        unresolved(
          `command-substitution-${builder.unresolved.length + 1}`,
          "command-substitution",
          textOf(command, node),
          span(node.startIndex, node.endIndex),
          "command substitution is runtime shell evaluation",
        ),
      );
      for (const child of getChildren(node)) projectNode(command, child, builder, { ...context, depth: context.depth + 1, insideQuoted: true });
      return;

    case "process_substitution":
      addSegment(builder, command, node, "substitution", "dynamic", context);
      builder.unresolved.push(
        unresolved(
          `process-substitution-${builder.unresolved.length + 1}`,
          "process-substitution",
          textOf(command, node),
          span(node.startIndex, node.endIndex),
          "process substitution is shell runtime plumbing",
        ),
      );
      for (const child of getChildren(node)) projectNode(command, child, builder, { ...context, depth: context.depth + 1, insideQuoted: true });
      return;

    case "simple_expansion":
    case "arithmetic_expansion":
    case "expansion":
      addSegment(builder, command, node, "substitution", "dynamic", context);
      builder.unresolved.push(
        unresolved(
          `${node.type}-${builder.unresolved.length + 1}`,
          "parameter-expansion",
          textOf(command, node),
          span(node.startIndex, node.endIndex),
          "expansion depends on runtime shell state",
        ),
      );
      return;

    default:
      if (!node.isNamed) {
        addAnonymousNode(command, node, builder, context);
        return;
      }
      for (const child of getChildren(node)) projectNode(command, child, builder, { ...context, depth: context.depth + 1 });
  }
}

function addAnonymousNode(command: string, node: TreeLikeNode, builder: ProjectionBuilder, context: VisitContext): void {
  const text = textOf(command, node);
  if (text === "" || /^\s+$/.test(text)) return;
  if (text === "&&" || text === "||" || text === "|" || text === "|&" || text === ";" || text === "&" || text === "\n") {
    addSegment(builder, command, node, "operator", "operator", context, undefined, text);
    return;
  }
  addSegment(builder, command, node, "word", context.insideQuoted ? "inert" : "literal", context);
}

function addSegment(
  builder: ProjectionBuilder,
  command: string,
  node: TreeLikeNode,
  kind: Parameters<typeof segment>[1],
  role: SegmentRole,
  context: VisitContext,
  relations: readonly SegmentRelationLink[] = [],
  overrideText?: string,
): CommandSegment {
  const text = overrideText ?? textOf(command, node);
  const effectiveRole: SegmentRole = context.insideQuoted ? "inert" : role;
  const key = segmentKey(effectiveRole, span(node.startIndex, node.endIndex), text);
  const existing = builder.segmentsByKey.get(key);
  if (existing) return existing;
  const entry = {
    id: `segment-${builder.nextSegmentId += 1}`,
    kind,
    role: effectiveRole,
    text,
    span: span(node.startIndex, node.endIndex),
    relations: [...relations],
  } as CommandSegment;
  builder.segments.push(entry);
  builder.segmentsByKey.set(key, entry);
  builder.segmentsBySpan.set(`${node.startIndex}:${node.endIndex}`, entry);
  builder.facts.add(`${role}:${kind}:${text}`);
  return entry;
}

function addAssignment(builder: ProjectionBuilder, command: string, node: TreeLikeNode, context: VisitContext, implicit: boolean): void {
  const text = textOf(command, node);
  if (!implicit && !isAssignmentText(text)) {
    addSegment(builder, command, node, "word", "literal", context);
    return;
  }
  const segmentEntry = addSegment(builder, command, node, "assignment", "assignment", context);
  builder.assignments.push({
    id: segmentEntry.id,
    kind: implicit ? "environment" : "leading",
    text,
    span: segmentEntry.span,
    relations: segmentEntry.relations,
  });
}

function addCommandName(builder: ProjectionBuilder, command: string, node: TreeLikeNode, context: VisitContext, commandNameOverride: string | undefined): CommandSegment {
  const text = commandNameOverride ?? textOf(command, node);
  const role: SegmentRole = context.insideQuoted ? "inert" : classifyCommandName(text, context);
  const segmentEntry = addSegment(builder, command, node, "command", role, context, [], text);
  if (role === "wrapper") {
    builder.wrappers.push({
      id: segmentEntry.id,
      kind: classifyWrapperKind(text),
      text,
      span: segmentEntry.span,
      relations: segmentEntry.relations,
    });
  }
  return segmentEntry;
}

function classifyWrapperKind(text: string): WrapperObservation["kind"] {
  switch (text) {
    case "env":
      return "env";
    case "cd":
    case "source":
    case ".":
    case "bash":
    case "sh":
    case "python":
    case "node":
      return "shell";
    default:
      return "prefix";
  }
}

function classifyCommandName(text: string, context: VisitContext): SegmentRole {
  if (context.insideQuoted) return "inert";
  if (text === "eval") return "dynamic";
  if (text === "env" || text === "cd" || text === "source" || text === "." || text === "bash" || text === "sh" || text === "python" || text === "node" || text === "time" || text === "timeout" || text === "nice" || text === "nohup" || text === "stdbuf") return "wrapper";
  return "executable";
}

function addFileRedirect(builder: ProjectionBuilder, command: string, node: TreeLikeNode, context: VisitContext): void {
  const text = textOf(command, node);
  const segmentEntry = addSegment(builder, command, node, "redirect", "redirect", context);
  const children = getChildren(node);
  const fileDescriptor = children.find((child) => child.type === "file_descriptor");
  const redirectToken = children.find((child) => !child.isNamed && (child.type === ">" || child.type === ">>" || child.type === "<" || child.type === "<<" || child.type === "&>"));
  const destination = children.find((child) => child.isNamed && child.type !== "file_descriptor");
  const destinationText = destination ? textOf(command, destination) : undefined;
  const destinationSpan = destination ? span(destination.startIndex, destination.endIndex) : undefined;
  if (destination) {
    const literal = addSegment(builder, command, destination, "word", "literal", context);
    addRelation(segmentEntry.relations as SegmentRelationLink[], "targets", literal.id);
  }
  const operator = `${fileDescriptor ? textOf(command, fileDescriptor) : ""}${redirectToken ? textOf(command, redirectToken) : ""}` || (text.includes(">>") ? ">>" : text.includes("<<") ? "<<" : text.includes("&>") ? "&>" : ">");
  builder.redirections.push({
    id: segmentEntry.id,
    operator: operator as RedirectionObservation["operator"],
    text,
    span: segmentEntry.span,
    targetText: destinationText,
    targetSpan: destinationSpan,
    bodySpan: undefined,
    relations: segmentEntry.relations,
  });
}

function addHeredocRedirect(builder: ProjectionBuilder, command: string, node: TreeLikeNode, context: VisitContext): void {
  const segmentEntry = addSegment(builder, command, node, "redirect", "redirect", context);
  const children = getChildren(node);
  const body = children.find((child) => child.type === "heredoc_body");
  const start = children.find((child) => child.type === "heredoc_start");
  const end = children.find((child) => child.type === "heredoc_end");
  if (body) addSegment(builder, command, body, "quoted", "inert", context);
  builder.redirections.push({
    id: segmentEntry.id,
    operator: "<<",
    text: textOf(command, node),
    span: segmentEntry.span,
    targetText: start ? textOf(command, start) : undefined,
    targetSpan: start ? span(start.startIndex, start.endIndex) : undefined,
    bodySpan: body ? span(body.startIndex, body.endIndex) : undefined,
    relations: segmentEntry.relations,
  });
  if (end) addSegment(builder, command, end, "quoted", "inert", context);
}

function projectCommand(command: string, node: TreeLikeNode, builder: ProjectionBuilder, context: VisitContext): void {
  const children = getChildren(node);
  if (context.insideQuoted) {
    for (const child of children) {
      if (!child.isNamed) {
        addAnonymousNode(command, child, builder, context);
        continue;
      }
      if (child.type === "command_name") {
        addCommandName(builder, command, child, context, undefined);
        continue;
      }
      if (child.type === "variable_assignment") {
        addAssignment(builder, command, child, context, true);
        continue;
      }
      if (child.type === "word" || child.type === "raw_string" || child.type === "string") {
        addSegment(builder, command, child, child.type === "string" || child.type === "raw_string" ? "quoted" : "word", "inert", context);
        continue;
      }
      projectNode(command, child, builder, { ...context, depth: context.depth + 1, insideQuoted: true });
    }
    return;
  }
  const namedChildren = children.filter((child) => child.isNamed);
  const commandNameIndex = namedChildren.findIndex((child) => child.type === "command_name");
  const commandNameNode = commandNameIndex >= 0 ? namedChildren[commandNameIndex] : undefined;
  const commandNameText = commandNameNode ? textOf(command, commandNameNode) : undefined;
  const hasDynamicSink = commandNameText === "eval" || commandNameText === "xargs" || commandNameText === "find";

  let lastExecutable: CommandSegment | undefined;
  let sawCommandName = false;
  let sawDynamicScript = false;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    if (!child.isNamed) {
      addAnonymousNode(command, child, builder, context);
      continue;
    }

    if (child.type === "command_name") {
      const segmentEntry = addCommandName(builder, command, child, context, undefined);
      lastExecutable = segmentEntry;
      sawCommandName = true;
      for (const grandchild of getChildren(child)) {
        if (grandchild.isMissing) {
          builder.parseIssues.push({
            kind: "missing",
            text: textOf(command, grandchild),
            span: span(grandchild.startIndex, grandchild.endIndex),
            note: `missing ${grandchild.type}`,
          });
        }
      }
      continue;
    }

    const childText = textOf(command, child);

    if (!sawCommandName && child.type === "variable_assignment") {
      addAssignment(builder, command, child, context, false);
      continue;
    }

    if (child.type === "command_substitution" || child.type === "process_substitution" || child.type === "simple_expansion" || child.type === "arithmetic_expansion" || child.type === "expansion") {
      projectNode(command, child, builder, { ...context, depth: context.depth + 1, insideQuoted: true });
      continue;
    }

    if (commandNameText === "env" && sawCommandName) {
      if (isAssignmentText(childText)) {
        addAssignment(builder, command, child, context, true);
        continue;
      }
      if (lastExecutable) {
        const executable = addSegment(builder, command, child, "word", "executable", context);
        addRelation(lastExecutable.relations as SegmentRelationLink[], "wraps", executable.id);
        lastExecutable = executable;
        continue;
      }
    }

    if (commandNameText === "git" && isGitTargetOption(childText)) {
      const next = children[index + 1];
      if (childText === "-C" && next && next.isNamed && !isAssignmentText(textOf(command, next))) {
        const target = addSegment(builder, command, next, "word", "literal", context);
        const wrapperSpan = span(child.startIndex, next.endIndex);
        const wrapperEntry = wrapper(`wrapper-${builder.nextWrapperId += 1}`, "prefix", command.slice(wrapperSpan.start, wrapperSpan.end), wrapperSpan, []);
        builder.wrappers.push(wrapperEntry);
        builder.literalGitTargetOptions.push({ option: "-C", value: textOf(command, next) });
        addRelation(wrapperEntry.relations as SegmentRelationLink[], "targets", target.id);
        index += 1;
        continue;
      }
      const targetMatch = childText.match(/^(--git-dir|--work-tree)=(.+)$/);
      if (targetMatch) {
        const option = targetMatch[1] as "--git-dir" | "--work-tree";
        const value = targetMatch[2] ?? "";
        const wrapperEntry = wrapper(`wrapper-${builder.nextWrapperId += 1}`, "prefix", childText, span(child.startIndex, child.endIndex), []);
        builder.wrappers.push(wrapperEntry);
        builder.literalGitTargetOptions.push({ option, value });
        addSegment(builder, command, child, "word", "literal", context);
        continue;
      }
      if ((childText === "--git-dir" || childText === "--work-tree") && children[index + 1] && children[index + 1]!.isNamed) {
        const next = children[index + 1]!;
        const target = addSegment(builder, command, next, "word", "literal", context);
        const option = childText as "--git-dir" | "--work-tree";
        const wrapperSpan = span(child.startIndex, next.endIndex);
        const wrapperEntry = wrapper(`wrapper-${builder.nextWrapperId += 1}`, "prefix", command.slice(wrapperSpan.start, wrapperSpan.end), wrapperSpan, []);
        builder.wrappers.push(wrapperEntry);
        builder.literalGitTargetOptions.push({ option, value: textOf(command, next) });
        addRelation(wrapperEntry.relations as SegmentRelationLink[], "targets", target.id);
        index += 1;
        continue;
      }
    }

    if (commandNameText === "bash" || commandNameText === "sh" || commandNameText === "python" || commandNameText === "node") {
      if (childText === "-c") {
        const next = children[index + 1];
        const wrapperSpan = next ? span(child.startIndex, next.endIndex) : span(child.startIndex, child.endIndex);
        const wrapperEntry = wrapper(`wrapper-${builder.nextWrapperId += 1}`, "shell", command.slice(wrapperSpan.start, wrapperSpan.end), wrapperSpan, []);
        builder.wrappers.push(wrapperEntry);
        addSegment(builder, command, child, "word", "wrapper", context);
        if (next && next.isNamed) {
          const script = addSegment(builder, command, next, next.type === "raw_string" || next.type === "string" ? "quoted" : "substitution", "dynamic", context);
          builder.unresolved.push(
            unresolved(
              `runtime-shell-${builder.unresolved.length + 1}`,
              "shell-expansion",
              textOf(command, next),
              span(next.startIndex, next.endIndex),
              `${commandNameText} -c executes a runtime command string`,
            ),
          );
          addRelation(wrapperEntry.relations as SegmentRelationLink[], "targets", script.id);
        }
        sawDynamicScript = true;
        index += next ? 1 : 0;
        continue;
      }
    }

    if (commandNameText === "cd") {
      const literal = addSegment(builder, command, child, child.type === "string" || child.type === "raw_string" ? "quoted" : "word", child.type === "string" || child.type === "raw_string" ? "inert" : "literal", context);
      if (index === 1) {
        const wrapperEntry = wrapper(`wrapper-${builder.nextWrapperId += 1}`, "shell", command.slice(node.startIndex, child.endIndex), span(node.startIndex, child.endIndex), []);
        builder.wrappers.push(wrapperEntry);
        addRelation(wrapperEntry.relations as SegmentRelationLink[], "targets", literal.id);
      }
      continue;
    }

    if (commandNameText === "source" || commandNameText === ".") {
      const literal = addSegment(builder, command, child, child.type === "string" || child.type === "raw_string" ? "quoted" : "word", child.type === "string" || child.type === "raw_string" ? "inert" : "literal", context);
      const wrapperEntry = wrapper(`wrapper-${builder.nextWrapperId += 1}`, "shell", command.slice(node.startIndex, child.endIndex), span(node.startIndex, child.endIndex), []);
      builder.wrappers.push(wrapperEntry);
      addRelation(wrapperEntry.relations as SegmentRelationLink[], "targets", literal.id);
      builder.unresolved.push(
        unresolved(
          `source-${builder.unresolved.length + 1}`,
          "shell-expansion",
          command.slice(node.startIndex, child.endIndex),
          span(node.startIndex, child.endIndex),
          "source/dot execute file contents in the current shell",
        ),
      );
      continue;
    }

    if (commandNameText === "eval") {
      addSegment(builder, command, child, child.type === "string" || child.type === "raw_string" ? "quoted" : "substitution", "dynamic", context);
      builder.unresolved.push(
        unresolved(
          `eval-${builder.unresolved.length + 1}`,
          "eval",
          command.slice(node.startIndex, node.endIndex),
          span(node.startIndex, node.endIndex),
          "eval reinterprets the command text at runtime",
        ),
      );
      continue;
    }

    if (commandNameText === "find" && childText === "-exec") {
      addSegment(builder, command, child, "dynamic-sink", "dynamic", context);
      builder.unresolved.push(
        unresolved(
          `find-exec-${builder.unresolved.length + 1}`,
          "command-substitution",
          command.slice(child.startIndex, node.endIndex),
          span(child.startIndex, node.endIndex),
          "find -exec executes runtime command text",
        ),
      );
      break;
    }

    if (commandNameText === "xargs") {
      addSegment(builder, command, child, child.type === "string" || child.type === "raw_string" ? "quoted" : "word", "dynamic", context);
      builder.unresolved.push(
        unresolved(
          `xargs-${builder.unresolved.length + 1}`,
          "shell-expansion",
          command.slice(child.startIndex, node.endIndex),
          span(child.startIndex, node.endIndex),
          "xargs reinterprets the runtime input stream",
        ),
      );
      break;
    }

    if (isAssignmentText(childText)) {
      addAssignment(builder, command, child, context, true);
      continue;
    }

    const role = child.type === "string" || child.type === "raw_string" ? "inert" : context.insideQuoted ? "inert" : "literal";
    addSegment(builder, command, child, child.type === "string" || child.type === "raw_string" ? "quoted" : "word", role, context);
    if (lastExecutable) {
      const literal = builder.segmentsBySpan.get(`${child.startIndex}:${child.endIndex}`);
      if (literal) addRelation(lastExecutable.relations as SegmentRelationLink[], "contains", literal.id);
    }
  }
}

interface VisitContext {
  readonly depth: number;
  readonly insideQuoted?: boolean;
}

interface ProjectionBuilder {
  readonly context: TreeSitterProjectionContext;
  readonly limits: Required<TreeSitterProjectionLimits>;
  readonly sourceLength: number;
  readonly segments: CommandSegment[];
  readonly wrappers: WrapperObservation[];
  readonly assignments: TreeSitterAssignmentObservation[];
  readonly redirections: RedirectionObservation[];
  readonly unresolved: UnresolvedConstruct[];
  readonly parseIssues: TreeSitterParseIssue[];
  readonly diagnostics: Diagnostic[];
  readonly protectedChecks: ProtectedCheckObservation[];
  readonly literalGitTargetOptions: LiteralGitTargetOption[];
  readonly facts: Set<string>;
  readonly segmentsByKey: Map<string, CommandSegment>;
  readonly segmentsBySpan: Map<string, CommandSegment>;
  nodeCount: number;
  nextSegmentId: number;
  nextWrapperId: number;
  limitsHit?: string;
}

function createBuilder(context: TreeSitterProjectionContext, sourceLength: number, limits: TreeSitterProjectionLimits): ProjectionBuilder {
  return {
    context,
    limits: {
      maxSourceLength: limits.maxSourceLength ?? 8_192,
      maxNodes: limits.maxNodes ?? 4_096,
      maxDepth: limits.maxDepth ?? 128,
    },
    sourceLength,
    segments: [],
    wrappers: [],
    assignments: [],
    redirections: [],
    unresolved: [],
    parseIssues: [],
    diagnostics: [],
    protectedChecks: [],
    literalGitTargetOptions: [],
    facts: new Set<string>(),
    segmentsByKey: new Map<string, CommandSegment>(),
    segmentsBySpan: new Map<string, CommandSegment>(),
    nodeCount: 0,
    nextSegmentId: 0,
    nextWrapperId: 0,
  };
}

function addProtectedChecks(builder: ProjectionBuilder, searchText: string): void {
  builder.protectedChecks.push(
    protectedCheck(
      "recursive-forced-deletion",
      matchesRecursiveForcedDeletion(searchText) ? "matched" : "not-matched",
      "observed",
      "rm -rf text matched in executable projection",
    ),
    protectedCheck(
      "git-reset-hard",
      matchesGitResetHard(searchText) ? "matched" : "not-matched",
      "observed",
      "git reset --hard text matched in executable projection",
    ),
    protectedCheck(
      "git-clean-forced",
      matchesForcedGitClean(searchText) ? "matched" : "not-matched",
      "observed",
      "git clean -f text matched in executable projection",
    ),
  );
  builder.literalGitTargetOptions.push(...extractLiteralGitTargetOptions(searchText));
}

function collectSearchText(segments: readonly CommandSegment[]): string {
  return sortBySpan(
    segments.filter((entry) => entry.role !== "inert" && entry.role !== "dynamic"),
  )
    .map((entry) => entry.text)
    .join(" ");
}

function finalizeProjection(builder: ProjectionBuilder): TreeSitterProjection {
  const segments = sortBySpan(builder.segments);
  const wrappers = sortBySpan(builder.wrappers);
  const redirections = sortBySpan(builder.redirections);
  const unresolved = sortBySpan(builder.unresolved);
  const parseIssues = sortBySpan(builder.parseIssues);
  const searchText = collectSearchText(segments);
  if (builder.context.availability === "available") {
    addProtectedChecks(builder, searchText);
  }
  const hasLimitHit = Boolean(builder.limitsHit);
  const status: AnalysisStatus = builder.context.availability === "unavailable"
    ? "unsupported"
    : hasLimitHit
      ? "unsupported"
      : parseIssues.length > 0 || unresolved.length > 0
        ? "degraded"
        : "structured";
  if (builder.context.availability === "unavailable") {
    builder.diagnostics.push(
      diagnostic(
        "adapter-unavailable",
        "error",
        builder.context.availabilityReason ?? "tree-sitter adapter unavailable",
      ),
    );
  }
  if (hasLimitHit) {
    builder.diagnostics.push(diagnostic("input-too-large", "error", builder.limitsHit ?? "tree-sitter input limit reached"));
  }
  const finalDiagnostics = [...builder.diagnostics].sort((left, right) => (left.span?.start ?? -1) - (right.span?.start ?? -1) || (left.span?.end ?? -1) - (right.span?.end ?? -1));
  const facts = buildProjectionFacts(segments, wrappers, redirections, unresolved, parseIssues);
  return {
    adapterId: builder.context.adapterId,
    adapterLabel: builder.context.adapterLabel,
    mode: builder.context.mode,
    identity: builder.context.identity,
    version: builder.context.version,
    availability: builder.context.availability,
    availabilityReason: builder.context.availabilityReason,
    status,
    sourceLength: builder.sourceLength,
    segments,
    wrappers,
    assignments: sortBySpan(builder.assignments),
    redirects: redirections,
    redirections,
    unresolved,
    parseIssues,
    diagnostics: finalDiagnostics,
    protectedChecks: builder.protectedChecks,
    literalGitTargetOptions: builder.literalGitTargetOptions,
    facts,
  };
}

export function projectTreeSitterParse(
  command: string,
  tree: TreeLikeParseTree,
  context: TreeSitterProjectionContext,
  limits: TreeSitterProjectionLimits = {},
): TreeSitterProjection {
  const builder = createBuilder(context, command.length, limits);
  if (builder.sourceLength > builder.limits.maxSourceLength) {
    builder.limitsHit = `input too large: ${builder.sourceLength} > ${builder.limits.maxSourceLength}`;
    return finalizeProjection(builder);
  }
  try {
    projectNode(command, tree.rootNode, builder, { depth: 0 });
  } catch (error) {
    builder.diagnostics.push(
      diagnostic("projection-failed", "error", error instanceof Error ? error.message : String(error)),
    );
    builder.limitsHit = builder.limitsHit ?? "projection failed";
  }
  return finalizeProjection(builder);
}

function compareProtectedChecks(expected: readonly { readonly checkId: string; readonly outcome: string }[], actual: readonly ProtectedCheckObservation[]): ComparisonState {
  const actualById = new Map<string, ProtectedCheckObservation["outcome"]>(actual.map((check) => [check.checkId, check.outcome]));
  const documentedIds = new Set<string>(expected.map((check) => check.checkId));

  for (const check of expected) {
    const actualOutcome = actualById.get(check.checkId);
    if (check.outcome === "matched" && actualOutcome !== "matched") return "mismatched";
    if (check.outcome === "not-matched" && actualOutcome === "matched") return "mismatched";
    if (check.outcome === "unknown" && actualOutcome !== "unknown") return "mismatched";
  }
  if (actual.some((check) => check.outcome === "matched" && !documentedIds.has(check.checkId))) return "mismatched";
  return "matched";
}

function compareLiteralGitTargets(expected: readonly LiteralGitTargetOption[] | undefined, actual: readonly LiteralGitTargetOption[]): ComparisonState {
  const normalize = (values: readonly LiteralGitTargetOption[]) =>
    JSON.stringify(
      [...values]
        .map((entry) => ({ option: entry.option, value: entry.value }))
        .sort((left, right) => `${left.option}=${left.value}`.localeCompare(`${right.option}=${right.value}`)),
    );
  return normalize(expected ?? []) === normalize(actual) ? "matched" : "mismatched";
}

function compareStatus(expected: AnalysisStatus, actual: AnalysisStatus): ComparisonState {
  return expected === actual ? "matched" : "mismatched";
}

function evaluateTreeSitterAnalysis(adapter: TreeSitterAdapter, fixture: CorpusFixture, signal: AbortSignal): Promise<TreeSitterAnalysis> | TreeSitterAnalysis {
  return adapter.analyze(fixture, signal);
}

export async function runTreeSitterCorpus(
  adapter: TreeSitterAdapter,
  corpus: readonly CorpusFixture[],
  options: { readonly timeoutMs?: number } = {},
): Promise<TreeSitterCorpusEvaluation> {
  const fixtures: TreeSitterFixtureEvaluation[] = [];
  for (const fixture of corpus) {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 250;
    const timer = setTimeout(() => controller.abort(new Error(`tree-sitter evaluation timed out after ${timeoutMs}ms`)), timeoutMs);
    const started = performance.now();
    try {
      const analysis = await Promise.race([
        Promise.resolve(evaluateTreeSitterAnalysis(adapter, fixture, controller.signal)),
        new Promise<TreeSitterAnalysis>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason ?? new Error("tree-sitter evaluation timed out")), { once: true });
        }),
      ]);
      const comparison = {
        status: compareStatus(fixture.expected.status, analysis.status),
        protectedChecks: compareProtectedChecks(fixture.expected.protectedChecks, analysis.protectedChecks),
        literalGitTargets: compareLiteralGitTargets(fixture.expected.literalGitTargetOptions, analysis.literalGitTargetOptions),
      };
      const outcome = comparison.status === "matched" && comparison.protectedChecks === "matched" && comparison.literalGitTargets === "matched" ? "pass" : "mismatch";
      const notes = [comparison.status, comparison.protectedChecks, comparison.literalGitTargets].filter((value): value is "mismatched" => value === "mismatched").map((value) => normalizeText(value));
      fixtures.push({
        fixtureId: fixture.id,
        title: fixture.title,
        expected: {
          status: fixture.expected.status,
          evidenceLevel: fixture.expected.evidenceLevel,
          subset: fixture.expected.subset,
          protectedChecks: fixture.expected.protectedChecks.map((check) => ({ checkId: check.checkId, outcome: check.outcome })),
          literalGitTargetOptions: fixture.expected.literalGitTargetOptions ?? [],
        },
        analysis,
        comparison,
        outcome,
        notes,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fixtures.push({
        fixtureId: fixture.id,
        title: fixture.title,
        expected: {
          status: fixture.expected.status,
          evidenceLevel: fixture.expected.evidenceLevel,
          subset: fixture.expected.subset,
          protectedChecks: fixture.expected.protectedChecks.map((check) => ({ checkId: check.checkId, outcome: check.outcome })),
          literalGitTargetOptions: fixture.expected.literalGitTargetOptions ?? [],
        },
        analysis: adapter.availability === "available"
          ? {
              adapterId: adapter.id,
              adapterLabel: adapter.label,
              mode: adapter.mode,
              identity: adapter.identity,
              version: adapter.version,
              availability: adapter.availability,
              command: fixture.command,
              status: "failed",
              projection: createEmptyProjection({
                adapterId: adapter.id,
                adapterLabel: adapter.label,
                mode: adapter.mode,
                identity: adapter.identity,
                version: adapter.version,
                availability: adapter.availability,
                availabilityReason: adapter.availabilityReason,
              }, fixture.command.length),
              textualEvidence: [],
              protectedChecks: [],
              literalGitTargetOptions: [],
              structuralFacts: [],
              diagnostics: [diagnostic("analysis-error", "error", message)],
              limitations: [message],
            }
          : {
              adapterId: adapter.id,
              adapterLabel: adapter.label,
              mode: adapter.mode,
              identity: adapter.identity,
              version: adapter.version,
              availability: adapter.availability,
              availabilityReason: adapter.availabilityReason,
              command: fixture.command,
              status: "unsupported",
              projection: createEmptyProjection({
                adapterId: adapter.id,
                adapterLabel: adapter.label,
                mode: adapter.mode,
                identity: adapter.identity,
                version: adapter.version,
                availability: adapter.availability,
                availabilityReason: adapter.availabilityReason,
              }, fixture.command.length),
              textualEvidence: [],
              protectedChecks: [],
              literalGitTargetOptions: [],
              structuralFacts: [],
              diagnostics: [diagnostic("analysis-unavailable", "error", message)],
              limitations: [message],
            },
        comparison: { status: "mismatched", protectedChecks: "mismatched", literalGitTargets: "mismatched" },
        outcome: message.includes("timed out") ? "timeout" : "error",
        notes: [normalizeText(message)],
        durationMs: Math.round(performance.now() - started),
      });
    } finally {
      clearTimeout(timer);
    }
  }
  const summary = fixtures.reduce(
    (counts, fixtureResult) => {
      counts[fixtureResult.outcome] += 1;
      return counts;
    },
    { pass: 0, mismatch: 0, error: 0, timeout: 0 },
  );
  return {
    adapterId: adapter.id,
    adapterLabel: adapter.label,
    mode: adapter.mode,
    identity: adapter.identity,
    version: adapter.version,
    capabilities: adapter.capabilities,
    fixtures,
    summary,
  };
}

export function sanitizeTreeSitterProjection<T>(value: T): T {
  if (typeof value === "string") return normalizeText(value) as T;
  if (Array.isArray(value)) return value.map((entry) => sanitizeTreeSitterProjection(entry)) as T;
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) out[key] = sanitizeTreeSitterProjection(entry);
  return out as T;
}
