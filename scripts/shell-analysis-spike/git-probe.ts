import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

import type { GitTargetCandidate, GitTargetEvidenceLevel } from "./git-target.ts";

export type GitProbeUnknownReason = "timeout" | "missing-git" | "missing-path" | "nonrepo" | "inconsistent" | "malformed" | "permission";

export interface GitProcessRun {
  readonly stage: "metadata" | "top-level";
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly durationMs: number;
  readonly aborted: boolean;
  readonly abortReason?: string;
  readonly spawnError?: {
    readonly code?: string;
    readonly message: string;
  };
}

export interface GitProbeResult {
  readonly evidenceLevel: Extract<GitTargetEvidenceLevel, "verified" | "unknown">;
  readonly unknownReason?: GitProbeUnknownReason;
  readonly target: GitTargetCandidate;
  readonly canonical: {
    readonly cwd: string;
    readonly absoluteGitDir?: string;
    readonly gitCommonDir?: string;
    readonly topLevel?: string;
  };
  readonly observed: {
    readonly isBare?: boolean;
    readonly isInsideWorkTree?: boolean;
  };
  readonly runs: readonly GitProcessRun[];
  readonly notes: readonly string[];
  readonly durationMs: number;
}

export interface GitProbeOptions {
  readonly gitBinary?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
  readonly env?: NodeJS.ProcessEnv;
}

interface PathCheckOk {
  readonly status: "ok";
  readonly canonical: string;
}

interface PathCheckFailure {
  readonly status: "missing" | "permission";
  readonly code?: string;
  readonly message: string;
}

function normalizeMacTmpAlias(value: string): string {
  if (process.platform !== "darwin") return value;
  return value.replace(/^\/private(?=\/)/, "");
}

async function canonicalizeExistingPath(candidatePath: string): Promise<PathCheckOk | PathCheckFailure> {
  try {
    const canonical = await realpath(candidatePath);
    return { status: "ok", canonical: normalizeMacTmpAlias(canonical) };
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "EACCES" || code === "EPERM") {
      return { status: "permission", code, message: error instanceof Error ? error.message : String(error) };
    }
    return { status: "missing", code, message: error instanceof Error ? error.message : String(error) };
  }
}

async function canonicalizeForComparison(candidatePath: string, cwd: string): Promise<PathCheckOk | PathCheckFailure> {
  const absolute = path.isAbsolute(candidatePath) ? candidatePath : path.resolve(cwd, candidatePath);
  return canonicalizeExistingPath(absolute);
}

function parseBoolean(text: string): boolean | undefined {
  if (text === "true") return true;
  if (text === "false") return false;
  return undefined;
}

function appendBoundedText(current: string, chunk: Buffer, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  const currentBytes = Buffer.byteLength(current);
  if (currentBytes >= maxBytes) return { text: current, truncated: true };
  const remaining = maxBytes - currentBytes;
  const slice = chunk.subarray(0, remaining).toString("utf8");
  return { text: current + slice, truncated: chunk.length > remaining };
}

function classifyProcessFailure(run: GitProcessRun, cwdCheck?: PathCheckOk | PathCheckFailure): GitProbeUnknownReason {
  if (run.aborted) return "timeout";
  const combined = `${run.stderr}\n${run.spawnError?.message ?? ""}`.toLowerCase();
  if (run.spawnError?.code === "ENOENT") {
    if (cwdCheck?.status !== "ok") return cwdCheck?.status === "permission" ? "permission" : "nonrepo";
    return "missing-git";
  }
  if (run.spawnError?.code === "EACCES" || run.spawnError?.code === "EPERM") return "permission";
  if (combined.includes("permission denied") || combined.includes("not permitted")) return "permission";
  if (combined.includes("not a git repository") || combined.includes("cannot chdir to")) return "nonrepo";
  return "malformed";
}

function makeSpawnArgs(prefix: readonly string[], stageArgs: readonly string[]): readonly string[] {
  return [...prefix, "rev-parse", ...stageArgs];
}

function runGitCommand(
  stage: GitProcessRun["stage"],
  gitBinary: string,
  args: readonly string[],
  input: {
    readonly cwd: string;
    readonly timeoutMs: number;
    readonly maxOutputBytes: number;
    readonly env: NodeJS.ProcessEnv;
    readonly signal?: AbortSignal;
  },
): Promise<GitProcessRun> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const child = spawn(gitBinary, [...args], {
      cwd: input.cwd,
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let aborted = false;
    let abortReason: string | undefined;
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onExternalAbort);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("error", onError);
      child.off("close", onClose);
    };

    const finish = (result: GitProcessRun): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const terminate = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 100);
      killTimer.unref?.();
    };

    const onExternalAbort = (): void => {
      aborted = true;
      abortReason = String(input.signal?.reason ?? "aborted");
      terminate();
    };

    const timer = setTimeout(() => {
      aborted = true;
      abortReason = `timed out after ${input.timeoutMs}ms`;
      terminate();
    }, input.timeoutMs);
    timer.unref?.();

    if (input.signal) {
      if (input.signal.aborted) onExternalAbort();
      else input.signal.addEventListener("abort", onExternalAbort, { once: true });
    }

    const onStdout = (chunk: Buffer): void => {
      const appended = appendBoundedText(stdout, chunk, input.maxOutputBytes);
      stdout = appended.text;
      stdoutTruncated ||= appended.truncated;
    };
    const onStderr = (chunk: Buffer): void => {
      const appended = appendBoundedText(stderr, chunk, input.maxOutputBytes);
      stderr = appended.text;
      stderrTruncated ||= appended.truncated;
    };
    const onError = (error: NodeJS.ErrnoException): void => {
      finish({
        stage,
        args,
        cwd: input.cwd,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        durationMs: Math.round(performance.now() - startedAt),
        aborted,
        abortReason,
        spawnError: { code: error.code, message: error.message },
      });
    };
    const onClose = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      finish({
        stage,
        args,
        cwd: input.cwd,
        exitCode,
        signal,
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        durationMs: Math.round(performance.now() - startedAt),
        aborted,
        abortReason,
      });
    };

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

interface ParsedMetadata {
  readonly isBare: boolean;
  readonly isInsideWorkTree: boolean;
  readonly absoluteGitDir: string;
  readonly gitCommonDir: string;
}

function parseMetadata(stdout: string): ParsedMetadata | undefined {
  const lines = stdout.replaceAll("\r", "").split("\n").filter((line) => line.length > 0);
  if (lines.length !== 4) return undefined;
  const isBare = parseBoolean(lines[0]!);
  const isInsideWorkTree = parseBoolean(lines[1]!);
  if (isBare === undefined || isInsideWorkTree === undefined) return undefined;
  return {
    isBare,
    isInsideWorkTree,
    absoluteGitDir: lines[2]!,
    gitCommonDir: lines[3]!,
  };
}

function isRepoUnknown(run: GitProcessRun): boolean {
  const text = `${run.stderr}\n${run.stdout}`.toLowerCase();
  return text.includes("not a git repository") || text.includes("fatal: not a git repository");
}

export async function probeGitTarget(
  target: GitTargetCandidate,
  options: GitProbeOptions = {},
): Promise<GitProbeResult> {
  const startedAt = performance.now();
  const gitBinary = options.gitBinary ?? "git";
  const timeoutMs = options.timeoutMs ?? 500;
  const maxOutputBytes = options.maxOutputBytes ?? 16_384;
  const env = {
    ...process.env,
    ...options.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
  const notes: string[] = [];
  const runs: GitProcessRun[] = [];

  const cwdCheck = await canonicalizeExistingPath(target.resolvedCwd);
  if (cwdCheck.status !== "ok") {
    return {
      evidenceLevel: "unknown",
      unknownReason: cwdCheck.status === "permission" ? "permission" : "missing-path",
      target,
      canonical: { cwd: normalizeMacTmpAlias(path.resolve(target.resolvedCwd)) },
      observed: {},
      runs,
      notes: [`cwd ${target.resolvedCwd} is ${cwdCheck.status}`],
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  const gitDirCheck = target.resolvedGitDir ? await canonicalizeForComparison(target.resolvedGitDir, target.resolvedCwd) : undefined;
  if (gitDirCheck && gitDirCheck.status !== "ok") {
    return {
      evidenceLevel: "unknown",
      unknownReason: gitDirCheck.status === "permission" ? "permission" : "missing-path",
      target,
      canonical: { cwd: cwdCheck.canonical },
      observed: {},
      runs,
      notes: [`git dir ${target.resolvedGitDir} is ${gitDirCheck.status}`],
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  const workTreeCheck = target.resolvedWorkTree ? await canonicalizeForComparison(target.resolvedWorkTree, target.resolvedCwd) : undefined;
  if (workTreeCheck && workTreeCheck.status !== "ok") {
    return {
      evidenceLevel: "unknown",
      unknownReason: workTreeCheck.status === "permission" ? "permission" : "missing-path",
      target,
      canonical: { cwd: cwdCheck.canonical },
      observed: {},
      runs,
      notes: [`work tree ${target.resolvedWorkTree} is ${workTreeCheck.status}`],
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  const canonicalGitDir = gitDirCheck?.status === "ok" ? gitDirCheck.canonical : undefined;
  const canonicalWorkTree = workTreeCheck?.status === "ok" ? workTreeCheck.canonical : undefined;

  const prefix: string[] = [];
  if (canonicalGitDir) prefix.push(`--git-dir=${canonicalGitDir}`);
  if (canonicalWorkTree) prefix.push(`--work-tree=${canonicalWorkTree}`);

  const metadataRun = await runGitCommand(
    "metadata",
    gitBinary,
    makeSpawnArgs(prefix, ["--is-bare-repository", "--is-inside-work-tree", "--absolute-git-dir", "--git-common-dir"]),
    { cwd: cwdCheck.canonical, timeoutMs, maxOutputBytes, env, signal: options.signal },
  );
  runs.push(metadataRun);

  if (metadataRun.spawnError) {
    return {
      evidenceLevel: "unknown",
      unknownReason: classifyProcessFailure(metadataRun, cwdCheck),
      target,
      canonical: { cwd: cwdCheck.canonical },
      observed: {},
      runs,
      notes: [metadataRun.spawnError.message],
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  if (metadataRun.aborted) {
    return {
      evidenceLevel: "unknown",
      unknownReason: "timeout",
      target,
      canonical: { cwd: cwdCheck.canonical },
      observed: {},
      runs,
      notes: [metadataRun.abortReason ?? "metadata probe aborted"],
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  if (metadataRun.exitCode !== 0) {
    return {
      evidenceLevel: "unknown",
      unknownReason: isRepoUnknown(metadataRun) ? "nonrepo" : classifyProcessFailure(metadataRun, cwdCheck),
      target,
      canonical: { cwd: cwdCheck.canonical },
      observed: {},
      runs,
      notes: [metadataRun.stderr || `metadata probe exited ${metadataRun.exitCode}`],
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  const metadata = parseMetadata(metadataRun.stdout);
  if (!metadata) {
    return {
      evidenceLevel: "unknown",
      unknownReason: "malformed",
      target,
      canonical: { cwd: cwdCheck.canonical },
      observed: {},
      runs,
      notes: ["metadata output did not match the expected rev-parse shape"],
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  const absoluteGitDirCheck = await canonicalizeExistingPath(path.isAbsolute(metadata.absoluteGitDir) ? metadata.absoluteGitDir : path.resolve(cwdCheck.canonical, metadata.absoluteGitDir));
  if (absoluteGitDirCheck.status !== "ok") {
    return {
      evidenceLevel: "unknown",
      unknownReason: absoluteGitDirCheck.status === "permission" ? "permission" : "inconsistent",
      target,
      canonical: { cwd: cwdCheck.canonical },
      observed: { isBare: metadata.isBare, isInsideWorkTree: metadata.isInsideWorkTree },
      runs,
      notes: [`absolute git dir ${metadata.absoluteGitDir} could not be canonicalized`],
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  const commonDirCheck = await canonicalizeExistingPath(path.isAbsolute(metadata.gitCommonDir) ? metadata.gitCommonDir : path.resolve(cwdCheck.canonical, metadata.gitCommonDir));
  if (commonDirCheck.status !== "ok") {
    return {
      evidenceLevel: "unknown",
      unknownReason: commonDirCheck.status === "permission" ? "permission" : "inconsistent",
      target,
      canonical: { cwd: cwdCheck.canonical },
      observed: { isBare: metadata.isBare, isInsideWorkTree: metadata.isInsideWorkTree },
      runs,
      notes: [`git common dir ${metadata.gitCommonDir} could not be canonicalized`],
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  const canonicalAbsoluteGitDir = absoluteGitDirCheck.canonical;
  const canonicalCommonDir = commonDirCheck.canonical;

  if (target.resolvedGitDir && canonicalAbsoluteGitDir !== canonicalGitDir) {
    return {
      evidenceLevel: "unknown",
      unknownReason: "inconsistent",
      target,
      canonical: { cwd: cwdCheck.canonical, absoluteGitDir: canonicalAbsoluteGitDir, gitCommonDir: canonicalCommonDir },
      observed: { isBare: metadata.isBare, isInsideWorkTree: metadata.isInsideWorkTree },
      runs,
      notes: ["canonical git dir disagrees with the candidate"],
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  let topLevelCheck: PathCheckOk | PathCheckFailure | undefined;
  const shouldProbeTopLevel = Boolean(target.resolvedWorkTree || (!target.resolvedGitDir && !target.resolvedWorkTree));
  if (shouldProbeTopLevel) {
    const topLevelRun = await runGitCommand(
      "top-level",
      gitBinary,
      makeSpawnArgs(prefix, ["--show-toplevel"]),
      { cwd: cwdCheck.canonical, timeoutMs, maxOutputBytes, env, signal: options.signal },
    );
    runs.push(topLevelRun);

    if (topLevelRun.spawnError) {
      return {
        evidenceLevel: "unknown",
        unknownReason: classifyProcessFailure(topLevelRun, cwdCheck),
        target,
        canonical: { cwd: cwdCheck.canonical, absoluteGitDir: absoluteGitDirCheck.canonical, gitCommonDir: commonDirCheck.canonical },
        observed: { isBare: metadata.isBare, isInsideWorkTree: metadata.isInsideWorkTree },
        runs,
        notes: [topLevelRun.spawnError.message],
        durationMs: Math.round(performance.now() - startedAt),
      };
    }

    if (topLevelRun.aborted) {
      return {
        evidenceLevel: "unknown",
        unknownReason: "timeout",
        target,
        canonical: { cwd: cwdCheck.canonical, absoluteGitDir: absoluteGitDirCheck.canonical, gitCommonDir: commonDirCheck.canonical },
        observed: { isBare: metadata.isBare, isInsideWorkTree: metadata.isInsideWorkTree },
        runs,
        notes: [topLevelRun.abortReason ?? "top-level probe aborted"],
        durationMs: Math.round(performance.now() - startedAt),
      };
    }

    if (topLevelRun.exitCode !== 0) {
      return {
        evidenceLevel: "unknown",
        unknownReason: isRepoUnknown(topLevelRun) ? "nonrepo" : classifyProcessFailure(topLevelRun, cwdCheck),
        target,
        canonical: { cwd: cwdCheck.canonical, absoluteGitDir: absoluteGitDirCheck.canonical, gitCommonDir: commonDirCheck.canonical },
        observed: { isBare: metadata.isBare, isInsideWorkTree: metadata.isInsideWorkTree },
        runs,
        notes: [topLevelRun.stderr || `top-level probe exited ${topLevelRun.exitCode}`],
        durationMs: Math.round(performance.now() - startedAt),
      };
    }

    const topLevel = topLevelRun.stdout.replaceAll("\r", "").trim();
    topLevelCheck = await canonicalizeExistingPath(path.isAbsolute(topLevel) ? topLevel : path.resolve(cwdCheck.canonical, topLevel));
    if (topLevelCheck.status !== "ok") {
      return {
        evidenceLevel: "unknown",
        unknownReason: topLevelCheck.status === "permission" ? "permission" : "inconsistent",
        target,
        canonical: { cwd: cwdCheck.canonical, absoluteGitDir: absoluteGitDirCheck.canonical, gitCommonDir: commonDirCheck.canonical },
        observed: { isBare: metadata.isBare, isInsideWorkTree: metadata.isInsideWorkTree },
        runs,
        notes: ["top-level output could not be canonicalized"],
        durationMs: Math.round(performance.now() - startedAt),
      };
    }

    if (target.resolvedWorkTree && topLevelCheck.canonical !== workTreeCheck!.canonical) {
      return {
        evidenceLevel: "unknown",
        unknownReason: "inconsistent",
        target,
        canonical: { cwd: cwdCheck.canonical, absoluteGitDir: absoluteGitDirCheck.canonical, gitCommonDir: commonDirCheck.canonical, topLevel: topLevelCheck.canonical },
        observed: { isBare: metadata.isBare, isInsideWorkTree: metadata.isInsideWorkTree },
        runs,
        notes: ["canonical top-level disagrees with the candidate work tree"],
        durationMs: Math.round(performance.now() - startedAt),
      };
    }
  }

  const canonicalTopLevel = topLevelCheck?.status === "ok" ? topLevelCheck.canonical : undefined;

  if (!target.resolvedGitDir && !target.resolvedWorkTree && !metadata.isBare && !metadata.isInsideWorkTree) {
    return {
      evidenceLevel: "unknown",
      unknownReason: "nonrepo",
      target,
      canonical: { cwd: cwdCheck.canonical, absoluteGitDir: absoluteGitDirCheck.canonical, gitCommonDir: commonDirCheck.canonical, topLevel: canonicalTopLevel },
      observed: { isBare: metadata.isBare, isInsideWorkTree: metadata.isInsideWorkTree },
      runs,
      notes: ["git metadata says this cwd is not in a repository"],
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  if (target.resolvedWorkTree && !metadata.isInsideWorkTree) {
    return {
      evidenceLevel: "unknown",
      unknownReason: "inconsistent",
      target,
      canonical: { cwd: cwdCheck.canonical, absoluteGitDir: absoluteGitDirCheck.canonical, gitCommonDir: commonDirCheck.canonical, topLevel: canonicalTopLevel },
      observed: { isBare: metadata.isBare, isInsideWorkTree: metadata.isInsideWorkTree },
      runs,
      notes: ["work tree candidate did not report inside-work-tree evidence"],
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  return {
    evidenceLevel: "verified",
    target,
    canonical: {
      cwd: cwdCheck.canonical,
      absoluteGitDir: absoluteGitDirCheck.canonical,
      gitCommonDir: commonDirCheck.canonical,
      topLevel: canonicalTopLevel,
    },
    observed: { isBare: metadata.isBare, isInsideWorkTree: metadata.isInsideWorkTree },
    runs,
    notes: uniqueNotes([
      ...notes,
      target.resolvedGitDir ? "canonical git-dir agrees with the candidate" : "cwd canonicalization agrees with the candidate",
      target.resolvedWorkTree && topLevelCheck ? "canonical top-level agrees with the candidate work tree" : "",
    ]),
    durationMs: Math.round(performance.now() - startedAt),
  };
}

function uniqueNotes(notes: readonly string[]): readonly string[] {
  return [...new Set(notes.filter((note) => note.trim().length > 0))];
}
