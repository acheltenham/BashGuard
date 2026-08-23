export const DESTRUCTIVE_FILESYSTEM_REMOVAL = "destructive filesystem removal";
export const RECURSIVE_FORCED_DELETION_CHECK = "recursive-forced-deletion";

export function classifyCommandRisk(command: string): string[] {
  const normalized = command.toLowerCase();
  const risks: string[] = [];

  if (/\brm\s+[^\n;|&]*-(?:[^\s]*r[^\s]*f|[^\s]*f[^\s]*r)\b/.test(normalized)) {
    risks.push(DESTRUCTIVE_FILESYSTEM_REMOVAL);
  }
  if (/\bgit\s+(reset\s+--hard|clean\s+-[^\n;|&]*f|push\s+[^\n;|&]*--force|rebase\b)/.test(normalized)) {
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
