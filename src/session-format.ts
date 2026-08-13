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
      if (sessionIds.filter((id) => id.startsWith(prefix)).length === 1) return prefix;
    }
    return sessionId;
  });
}
