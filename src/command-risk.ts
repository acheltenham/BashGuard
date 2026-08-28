export const DESTRUCTIVE_FILESYSTEM_REMOVAL = "destructive filesystem removal";
export const RECURSIVE_FORCED_DELETION_CHECK = "recursive-forced-deletion";

export type LiteralGitTargetOption = {
  option: "-C" | "--git-dir" | "--work-tree";
  value: string;
};

const COMMAND_BOUNDARY = /[\n;&|]+/;
const GIT_TARGET_OPTION_FRAGMENT = String.raw`(?:-C|--git-dir|--work-tree)(?:=[^\s;&|]+|\s+[^\s;&|]+)`;
const GIT_PREFIX_FRAGMENT = String.raw`\bgit(?:\s+${GIT_TARGET_OPTION_FRAGMENT})*`;
const SHELL_TOKEN_BOUNDARY = "(?:^|[\\s\"'`])";
const SHELL_TOKEN_END = "(?:$|[\\s\"'`])";

export function extractLiteralGitTargetOptions(command: string): LiteralGitTargetOption[] {
  const options: LiteralGitTargetOption[] = [];
  const pattern = /(-C|--git-dir|--work-tree)(?:=([^\s;&|]+)|\s+([^\s;&|]+))/g;

  for (const match of command.matchAll(pattern)) {
    const value = match[2] ?? match[3];
    if (value) {
      options.push({ option: match[1] as LiteralGitTargetOption["option"], value });
    }
  }

  return options;
}

export function matchesRecursiveForcedDeletion(command: string): boolean {
  const normalized = command.toLowerCase();
  return normalized.split(COMMAND_BOUNDARY).some((segment) =>
    /\brm\s+[^\n;|&]*-(?:[^\s]*r[^\s]*f|[^\s]*f[^\s]*r)\b/.test(segment),
  );
}

// Temporary conservative text matcher: this intentionally also matches echoed text
// such as echo 'git reset --hard'. Issue #90 tracks shell-aware parsing.
export function matchesGitResetHard(command: string): boolean {
  const normalized = command.toLowerCase();
  const pattern = new RegExp(
    `${GIT_PREFIX_FRAGMENT}\\s+reset\\b[\\s\\S]*?${SHELL_TOKEN_BOUNDARY}--hard${SHELL_TOKEN_END}`,
    "i",
  );

  return normalized.split(COMMAND_BOUNDARY).some((segment) => pattern.test(segment));
}

export function matchesForcedGitClean(command: string): boolean {
  const normalized = command.toLowerCase();
  const pattern = new RegExp(
    `${GIT_PREFIX_FRAGMENT}\\s+clean\\b[\\s\\S]*?${SHELL_TOKEN_BOUNDARY}(?:--force|-[^\\s-]*f[^\\s-]*)${SHELL_TOKEN_END}`,
    "i",
  );

  return normalized.split(COMMAND_BOUNDARY).some((segment) => pattern.test(segment));
}

export function classifyCommandRisk(command: string): string[] {
  const normalized = command.toLowerCase();
  const risks: string[] = [];

  if (matchesRecursiveForcedDeletion(normalized)) {
    risks.push(DESTRUCTIVE_FILESYSTEM_REMOVAL);
  }
  if (
    matchesGitResetHard(normalized) ||
    matchesForcedGitClean(normalized) ||
    /\bgit\s+(push\s+[^\n;|&]*--force|rebase\b)/.test(normalized)
  ) {
    risks.push("history or working-tree rewrite");
  }
  if (/\b(curl|wget)\b[^\n]*\|\s*(sh|bash|zsh|fish|sudo\s+(sh|bash))\b/.test(normalized)) {
    risks.push("network download piped to shell");
  }
  if (/\b(token|api[_-]?key|password|passwd|secret)=\S+/i.test(command)) {
    risks.push("secret-looking value in command text");
  }

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
