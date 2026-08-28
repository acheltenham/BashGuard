export const DESTRUCTIVE_FILESYSTEM_REMOVAL = "destructive filesystem removal";
export const RECURSIVE_FORCED_DELETION_CHECK = "recursive-forced-deletion";

export type LiteralGitTargetOption = {
  option: "-C" | "--git-dir" | "--work-tree";
  value: string;
};

const COMMAND_BOUNDARY = /[\n;&|]+/;
const GIT_OPTIONS_WITH_SEPARATE_VALUES = new Set(["-c", "-C", "--config-env", "--exec-path", "--git-dir", "--namespace", "--work-tree"]);

function normalizedShellToken(token: string): string {
  return token.replace(/^["'`]+|["'`]+$/g, "");
}

function gitOperationArguments(segment: string, operation: "reset" | "clean"): string[] | undefined {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  for (let gitIndex = 0; gitIndex < tokens.length; gitIndex += 1) {
    if (normalizedShellToken(tokens[gitIndex]!).toLowerCase() !== "git") continue;

    for (let index = gitIndex + 1; index < tokens.length; index += 1) {
      const token = normalizedShellToken(tokens[index]!);
      const normalized = token.toLowerCase();
      if (GIT_OPTIONS_WITH_SEPARATE_VALUES.has(token)) {
        index += 1;
        continue;
      }
      if (["--config-env=", "--exec-path=", "--git-dir=", "--namespace=", "--work-tree="].some((prefix) => normalized.startsWith(prefix))) continue;
      if (token.startsWith("-")) continue;
      if (normalized === operation) return tokens.slice(index + 1).map(normalizedShellToken);
      break;
    }
  }
  return undefined;
}

function isShortOptionWith(token: string, flag: string): boolean {
  return /^-[^-][a-z]*$/i.test(token) && token.slice(1).toLowerCase().includes(flag);
}

export function extractLiteralGitTargetOptions(command: string): LiteralGitTargetOption[] {
  const options: LiteralGitTargetOption[] = [];
  const pattern = /(-C|--git-dir|--work-tree)(?:=([^\s;&|]+)|\s+([^\s;&|]+))/g;

  for (const match of command.matchAll(pattern)) {
    const value = match[2] ?? match[3];
    if (value) options.push({ option: match[1] as LiteralGitTargetOption["option"], value });
  }

  return options;
}

export function matchesRecursiveForcedDeletion(command: string): boolean {
  const normalized = command.toLowerCase();
  return normalized.split(COMMAND_BOUNDARY).some((segment) => /\brm\s+[^\n;|&]*-(?:[^\s]*r[^\s]*f|[^\s]*f[^\s]*r)\b/.test(segment));
}

// Temporary conservative text matcher: this intentionally also matches echoed text
// such as echo 'git reset --hard'. Issue #90 tracks shell-aware parsing.
export function matchesGitResetHard(command: string): boolean {
  return command.split(COMMAND_BOUNDARY).some((segment) => {
    const args = gitOperationArguments(segment, "reset");
    return args?.some((token) => token.toLowerCase() === "--hard") ?? false;
  });
}

export function matchesForcedGitClean(command: string): boolean {
  return command.split(COMMAND_BOUNDARY).some((segment) => {
    const args = gitOperationArguments(segment, "clean");
    if (!args) return false;
    const hasForce = args.some((token) => token.toLowerCase() === "--force" || isShortOptionWith(token, "f"));
    const hasDryRun = args.some((token) => token.toLowerCase() === "--dry-run" || isShortOptionWith(token, "n"));
    return hasForce && !hasDryRun;
  });
}

export function classifyCommandRisk(command: string): string[] {
  const normalized = command.toLowerCase();
  const risks: string[] = [];

  if (matchesRecursiveForcedDeletion(normalized)) risks.push(DESTRUCTIVE_FILESYSTEM_REMOVAL);
  if (matchesGitResetHard(normalized) || matchesForcedGitClean(normalized) || /\bgit\s+(push\s+[^\n;|&]*--force|rebase\b)/.test(normalized)) {
    risks.push("history or working-tree rewrite");
  }
  if (/\b(curl|wget)\b[^\n]*\|\s*(sh|bash|zsh|fish|sudo\s+(sh|bash))\b/.test(normalized)) {
    risks.push("network download piped to shell");
  }
  if (/\b(token|api[_-]?key|password|passwd|secret)=\S+/i.test(command)) risks.push("secret-looking value in command text");

  return risks;
}

const RISK_EXPLANATIONS: Record<string, string> = {
  [DESTRUCTIVE_FILESYSTEM_REMOVAL]: "recursively deletes files without a trash/undo step",
  "history or working-tree rewrite": "can discard local changes or rewrite repository state",
  "network download piped to shell": "downloads code from the network and executes it in a shell",
  "secret-looking value in command text": "may expose sensitive values in logs, shell history, or recorded output",
};

export function explainCommandRisk(risk: string): string {
  return RISK_EXPLANATIONS[risk] ?? "review the recorded command before trusting the result";
}
