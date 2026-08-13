import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import type { SessionChoice, SessionSummary } from "./cli.ts";
import { promptForSessionChoice } from "./session-picker.ts";

function choice(
  selector: number,
  sessionId: string,
  options: Partial<SessionSummary> & { name?: string; repository?: string } = {},
): SessionChoice {
  const { name, repository, ...summary } = options;
  return {
    selector,
    session: {
      metadata: { sessionId, name, repository },
      directory: `/tmp/${sessionId}`,
      eventsFile: `/tmp/${sessionId}/events.jsonl`,
      modifiedAt: Date.parse("2026-08-03T12:00:00.000Z"),
      active: false,
      ...summary,
    },
  };
}

function streams(): { input: PassThrough; output: PassThrough; readOutput: () => string } {
  const input = new PassThrough();
  const output = new PassThrough();
  let rendered = "";
  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    rendered += chunk;
  });
  return { input, output, readOutput: () => rendered };
}

async function writeLines(input: PassThrough, lines: string[]): Promise<void> {
  for (const line of lines) {
    input.write(`${line}\n`);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

test("renders distinguishing context and the available stable selectors", async () => {
  const io = streams();
  const choices = [
    choice(1, "019fc93a-1111-2222-3333-abcdefaaaaaa", { name: "Milestone smoke", repository: "BashGuard", active: true }),
    choice(3, "019fc909-1111-2222-3333-abcdefbbbbbb", { name: "Evidence review", repository: "Evidence" }),
  ];

  const selected = promptForSessionChoice(choices, io);
  io.input.end("3\n");

  assert.equal((await selected).selector, 3);
  const output = io.readOutput();
  assert.match(output, /1\s+019fc93a\s+Milestone smoke\s+BashGuard\s+active\s+updated 2026-08-03T12:00:00\.000Z/);
  assert.match(output, /3\s+019fc909\s+Evidence review\s+Evidence\s+complete\s+updated 2026-08-03T12:00:00\.000Z/);
  assert.match(output, /Select a session \[1, 3\]: $/);
});

test("renders uniquely distinguishing session ID prefixes", async () => {
  const io = streams();
  const choices = [
    choice(1, "019fc93a-1111-2222-3333-abcdefaaaaaa"),
    choice(3, "019fc93a-2222-3333-4444-abcdefbbbbbb"),
  ];

  const selected = promptForSessionChoice(choices, io);
  io.input.end("3\n");

  assert.equal((await selected).selector, 3);
  assert.match(io.readOutput(), /1\s+019fc93a-1\s+-/);
  assert.match(io.readOutput(), /3\s+019fc93a-2\s+-/);
});

test("returns the choice whose selector is 2", async () => {
  const io = streams();
  const choices = [choice(1, "session-one"), choice(2, "session-two")];

  const selected = promptForSessionChoice(choices, io);
  io.input.end("2\n");

  assert.equal(await selected, choices[1]);
});

test("retries blank, nonnumeric, and unavailable selectors until a valid selector", async () => {
  const io = streams();
  const choices = [choice(1, "session-one"), choice(3, "session-three")];

  const selected = promptForSessionChoice(choices, io);
  await writeLines(io.input, ["", "nope", "2", "3"]);

  assert.equal((await selected).selector, 3);
  io.input.end();
  assert.equal(io.readOutput().match(/Enter one of: 1, 3\./g)?.length, 3);
  assert.equal(io.readOutput().match(/Select a session \[1, 3\]: /g)?.length, 4);
});

test("consumes buffered lines across retries without losing pasted input", async () => {
  const io = streams();
  const choices = [choice(1, "session-one"), choice(3, "session-three")];

  const selected = promptForSessionChoice(choices, io);
  io.input.end("\ninvalid\n3\n");

  assert.equal((await selected).selector, 3);
  assert.equal(io.readOutput().match(/Enter one of: 1, 3\./g)?.length, 2);
  assert.equal(io.readOutput().match(/Select a session \[1, 3\]: /g)?.length, 3);
});

test("retries a whitespace-padded selector until an exact selector is entered", async () => {
  const io = streams();
  const choices = [choice(1, "session-one"), choice(3, "session-three")];

  const selected = promptForSessionChoice(choices, io);
  await writeLines(io.input, [" 3 ", "1"]);

  assert.equal((await selected).selector, 1);
  io.input.end();
  assert.equal(io.readOutput().match(/Enter one of: 1, 3\./g)?.length, 1);
  assert.equal(io.readOutput().match(/Select a session \[1, 3\]: /g)?.length, 2);
});

test("rejects an empty choice snapshot", async () => {
  const io = streams();

  await assert.rejects(promptForSessionChoice([], io), new Error("Session choices cannot be empty."));
  assert.equal(io.readOutput(), "");
});

test("rejects duplicate stable selectors", async () => {
  const io = streams();
  const choices = [choice(1, "session-one"), choice(1, "session-two")];

  await assert.rejects(promptForSessionChoice(choices, io), new Error("Duplicate session selector: 1."));
  assert.equal(io.readOutput(), "");
});

test("blank input has no default", async () => {
  const io = streams();
  const selected = promptForSessionChoice([choice(1, "session-one")], io);

  io.input.end("\n");

  await assert.rejects(selected, new Error("Session selection cancelled."));
  assert.match(io.readOutput(), /Enter one of: 1\./);
});

test("rejects when input reaches EOF", async () => {
  const io = streams();
  const selected = promptForSessionChoice([choice(1, "session-one")], io);

  io.input.end();

  await assert.rejects(selected, new Error("Session selection cancelled."));
  assert.equal(io.output.destroyed, false);
});

test("rejects on a real readline Ctrl+C interruption", async () => {
  const io = streams();
  Object.assign(io.input, { isTTY: true, setRawMode: () => io.input });
  Object.assign(io.output, { isTTY: true, columns: 80 });
  const selected = promptForSessionChoice([choice(1, "session-one")], io);

  io.input.write("\u0003");

  await assert.rejects(selected, new Error("Session selection cancelled."));
});

test("renders and accepts only the supplied choice snapshot", async () => {
  const io = streams();
  const supplied = [choice(1, "visible-one"), choice(3, "visible-three")];

  const selected = promptForSessionChoice(supplied, io);
  await writeLines(io.input, ["2", "3"]);

  assert.equal((await selected).selector, 3);
  io.input.end();
  assert.doesNotMatch(io.readOutput(), /visible-two/);
  assert.match(io.readOutput(), /Enter one of: 1, 3\./);
});
