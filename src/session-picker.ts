import { basename } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import type { SessionChoice } from "./cli.ts";

export type SessionPromptStreams = {
  input: Readable;
  output: Writable;
};

function renderChoice(choice: SessionChoice): string {
  const { metadata } = choice.session;
  const sessionIdPrefix = metadata.sessionId.slice(0, 8);
  const name = metadata.name ?? metadata.title ?? metadata.sessionName ?? "-";
  const repository = metadata.repository ?? basename(metadata.cwd ?? "unknown");
  const state = choice.session.active ? "active" : "complete";
  const updated = Number.isFinite(choice.session.modifiedAt)
    ? new Date(choice.session.modifiedAt).toISOString()
    : "unknown";
  return `${choice.selector}  ${sessionIdPrefix}  ${name}  ${repository}  ${state}  updated ${updated}`;
}

function waitForInterruption(readline: ReturnType<typeof createInterface>): {
  promise: Promise<never>;
  cleanup: () => void;
} {
  const cancel = (reject: (reason: Error) => void) => () => {
    reject(new Error("Session selection cancelled."));
  };
  let onCancel: () => void = () => undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    onCancel = cancel(reject);
    readline.once("close", onCancel);
    readline.once("SIGINT", onCancel);
  });
  return {
    promise,
    cleanup: () => {
      readline.off("close", onCancel);
      readline.off("SIGINT", onCancel);
    },
  };
}

export async function promptForSessionChoice(
  choices: readonly SessionChoice[],
  { input, output }: SessionPromptStreams,
): Promise<SessionChoice> {
  const selectors = choices.map((choice) => String(choice.selector));
  const selectorList = selectors.join(", ");
  const choicesBySelector = new Map(choices.map((choice) => [String(choice.selector), choice]));

  output.write(`${choices.map(renderChoice).join("\n")}\n`);
  const readline = createInterface({ input, output });

  try {
    while (true) {
      const interruption = waitForInterruption(readline);
      let answer: string;
      try {
        answer = await Promise.race([
          readline.question(`Select a session [${selectorList}]: `),
          interruption.promise,
        ]);
      } finally {
        interruption.cleanup();
      }

      const selected = choicesBySelector.get(answer.trim());
      if (selected && /^\d+$/.test(answer.trim())) return selected;
      output.write(`Enter one of: ${selectorList}.\n`);
    }
  } finally {
    readline.close();
  }
}
