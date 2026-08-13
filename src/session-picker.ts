import { createInterface } from "node:readline/promises";

import type { SessionChoice } from "./cli.ts";
import { sessionChoiceDisplay } from "./session-format.ts";

export type SessionPromptStreams = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
};

function renderChoice(choice: SessionChoice): string {
  const row = sessionChoiceDisplay(choice);
  return `${row.selector}  ${row.sessionIdPrefix}  ${row.name}  ${row.repository}  ${row.state}  updated ${row.updated}`;
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

  output.write(`${choices.map(renderChoice).join("\n")}\n`);
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
