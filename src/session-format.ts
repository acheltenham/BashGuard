import { basename } from "node:path";

import type { SessionChoice } from "./cli.ts";

export type SessionChoiceDisplay = {
  selector: string;
  sessionIdPrefix: string;
  name: string;
  repository: string;
  state: string;
  updated: string;
};

/** Converts untrusted terminal text to one control-free, whitespace-normalized line. */
export function singleLineDisplay(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Serializes one argument for copyable Bash/Zsh command guidance. */
export function shellQuoteArgument(value: string): string {
  if (/^[A-Za-z0-9._:/@+=-]+$/u.test(value)) return value;

  let escaped = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (character === "\\") escaped += "\\\\";
    else if (character === "'") escaped += "\\'";
    else if (codePoint === 0x07) escaped += "\\a";
    else if (codePoint === 0x08) escaped += "\\b";
    else if (codePoint === 0x09) escaped += "\\t";
    else if (codePoint === 0x0a) escaped += "\\n";
    else if (codePoint === 0x0b) escaped += "\\v";
    else if (codePoint === 0x0c) escaped += "\\f";
    else if (codePoint === 0x0d) escaped += "\\r";
    else if (codePoint === 0x1b) escaped += "\\e";
    else if (codePoint <= 0x1f || codePoint === 0x7f) {
      escaped += `\\x${codePoint.toString(16).padStart(2, "0")}`;
    } else if ((codePoint >= 0x80 && codePoint <= 0x9f) || codePoint === 0x2028 || codePoint === 0x2029) {
      escaped += [...Buffer.from(character)].map((byte) => `\\x${byte.toString(16).padStart(2, "0")}`).join("");
    } else escaped += character;
  }
  return `$'${escaped}'`;
}

export function sessionChoiceDisplay(choice: SessionChoice): SessionChoiceDisplay {
  const { metadata } = choice.session;
  const timestamp = new Date(choice.session.modifiedAt);
  const updated = Number.isFinite(choice.session.modifiedAt) && Number.isFinite(timestamp.valueOf())
    ? timestamp.toISOString()
    : "unknown";

  return {
    selector: singleLineDisplay(String(choice.selector)),
    sessionIdPrefix: singleLineDisplay(choice.sessionIdPrefix),
    name: singleLineDisplay(metadata.name ?? metadata.title ?? metadata.sessionName ?? "-") || "-",
    repository: singleLineDisplay(metadata.repository ?? basename(metadata.cwd ?? "unknown")) || "unknown",
    state: singleLineDisplay(choice.session.active ? "active" : "complete"),
    updated: singleLineDisplay(updated),
  };
}

export function uniqueSessionIdPrefixes(sessionIds: readonly string[]): string[] {
  return sessionIds.map((sessionId) => {
    const minLength = Math.min(8, sessionId.length);
    for (let length = minLength; length <= sessionId.length; length++) {
      const prefix = sessionId.slice(0, length);
      if (sessionIds.filter((id) => id.startsWith(prefix)).length !== 1) continue;

      // Exact IDs resolve before indexes, but a numeric-looking proper prefix does not.
      const numericSelector = Number(prefix);
      const resolvesAsIndex = Number.isInteger(numericSelector)
        && numericSelector >= 1
        && numericSelector <= sessionIds.length;
      if (prefix === sessionId || !resolvesAsIndex) return prefix;
    }
    return sessionId;
  });
}
