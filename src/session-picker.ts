import { basename } from "node:path";
import { createInterface } from "node:readline/promises";

import type { SessionChoice } from "./cli.ts";
import { uniqueSessionIdPrefixes } from "./session-format.ts";

export type SessionPromptStreams = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
};

function renderChoice(choice: SessionChoice, sessionIdPrefix: string): string {
  const { metadata } = choice.session;
  const name = metadata.name ?? metadata.title ?? metadata.sessionName ?? "-";
  const repository = metadata.repository ?? basename(metadata.cwd ?? "unknown");
  const state = choice.session.active ? "active" : "complete";
  const updated = Number.isFinite(choice.session.modifiedAt)
    ? new Date(choice.session.modifiedAt).toISOString()
    : "unknown";
  return `${choice.selector}  ${sessionIdPrefix}  ${name}  ${repository}  ${state}  updated ${updated}`;
}

function validateChoices(choices: readonly SessionChoice[]): void {
  if (choices.length === 0) throw new Error("Session choices cannot be empty.");

  const selectors = new Set<string>();
  for (const choice of choices) {
    const selector = String(choice.selector);
    if (selectors.has(selector)) throw new Error(`Duplicate session selector: ${selector}.`);
    selectors.add(selector);
  }
}

export async function promptForSessionChoice(
  choices: readonly SessionChoice[],
  { input, output }: SessionPromptStreams,
): Promise<SessionChoice> {
  validateChoices(choices);
  const selectors = choices.map((choice) => String(choice.selector));
  const selectorList = selectors.join(", ");
  const choicesBySelector = new Map(choices.map((choice) => [String(choice.selector), choice]));
  const prefixes = uniqueSessionIdPrefixes(choices.map((choice) => choice.session.metadata.sessionId));

  output.write(`${choices.map((choice, index) => renderChoice(choice, prefixes[index]!)).join("\n")}\n`);
  const readline = createInterface({ input, output });
  let interrupted = false;
  const onInterrupt = (): void => {
    interrupted = true;
    readline.close();
  };
  readline.on("SIGINT", onInterrupt);

  try {
    const lines = readline[Symbol.asyncIterator]();
    while (true) {
      output.write(`Select a session [${selectorList}]: `);
      const { value: answer, done } = await lines.next();
      if (interrupted || done) throw new Error("Session selection cancelled.");

      const selected = choicesBySelector.get(answer);
      if (selected && /^\d+$/.test(answer)) return selected;
      output.write(`Enter one of: ${selectorList}.\n`);
    }
  } finally {
    readline.off("SIGINT", onInterrupt);
    readline.close();
  }
}
