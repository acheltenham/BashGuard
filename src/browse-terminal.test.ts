import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createBrowserKeyDecoder, decodeBrowserKeys, runBrowserTerminal, type BrowserTerminalKey } from "./browse-terminal.ts";

class FakeInput extends EventEmitter {
  isTTY = true;
  raw: boolean[] = [];
  resumed = 0;
  paused = 0;
  setRawMode(value: boolean): void { this.raw.push(value); }
  resume(): void { this.resumed += 1; }
  pause(): void { this.paused += 1; }
}

class FakeOutput extends EventEmitter {
  isTTY = true;
  columns = 80;
  rows = 12;
  writes: string[] = [];
  write(chunk: string, callback?: (error?: Error | null) => void): boolean {
    this.writes.push(chunk);
    queueMicrotask(() => callback?.());
    return true;
  }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("key decoder recognizes navigation, control, and printable input", () => {
  assert.deepEqual(decodeBrowserKeys("\u001b[A\u001b[B\u001b[5~\u001b[6~\r\t\u001b\u0003?q/x"), [
    { name: "up" }, { name: "down" }, { name: "page-up" }, { name: "page-down" },
    { name: "enter" }, { name: "tab" }, { name: "escape" }, { name: "interrupt" },
    { name: "character", value: "?" }, { name: "character", value: "q" },
    { name: "character", value: "/" }, { name: "character", value: "x" },
  ]);
});

test("key decoder preserves split escape sequences and UTF-8 code points across chunks", () => {
  const decoder = createBrowserKeyDecoder();
  assert.deepEqual(decoder.push(Buffer.from("\u001b[")), []);
  assert.deepEqual(decoder.push(Buffer.from("A")), [{ name: "up" }]);
  const emoji = Buffer.from("👩🏽‍💻");
  assert.deepEqual(decoder.push(emoji.subarray(0, 2)), []);
  assert.deepEqual(decoder.push(emoji.subarray(2)), [..."👩🏽‍💻"].map((value) => ({ name: "character", value })));
  assert.deepEqual(decoder.push(Buffer.from("\u001b")), []);
  assert.deepEqual(decoder.flush(), [{ name: "escape" }]);
});

test("terminal enters alternate screen, redraws whole frames, and restores on quit", async () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  const keys: BrowserTerminalKey[] = [];
  let version = 1;
  const running = runBrowserTerminal({
    input,
    output,
    frame: () => [`frame ${version}`, "status"],
    onKey: async (key) => {
      keys.push(key);
      version += 1;
      return key.name === "character" && key.value === "q" ? "quit" : undefined;
    },
  });
  await tick();
  input.emit("data", Buffer.from("\u001b[Aq"));
  const result = await running;

  assert.equal(result, "quit");
  assert.deepEqual(keys, [{ name: "up" }, { name: "character", value: "q" }]);
  assert.deepEqual(input.raw, [true, false]);
  assert.equal(input.listenerCount("data"), 0);
  assert.equal(output.listenerCount("resize"), 0);
  const transcript = output.writes.join("");
  assert.ok(transcript.indexOf("\u001b[?1049h") < transcript.indexOf("\u001b[?25l"));
  assert.match(transcript, /\u001b\[H\u001b\[2Jframe 1\r\nstatus/);
  assert.match(transcript, /frame 2/);
  assert.ok(transcript.indexOf("\u001b[?25h") < transcript.indexOf("\u001b[?1049l"));
});

test("resize redraws are coalesced and use the latest dimensions", async () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  const dimensions: string[] = [];
  const running = runBrowserTerminal({
    input,
    output,
    frame: ({ columns, rows }) => { dimensions.push(`${columns}x${rows}`); return [`${columns}x${rows}`]; },
    onKey: async (key) => key.name === "character" && key.value === "q" ? "quit" : undefined,
  });
  await tick();
  output.columns = 79; output.rows = 10; output.emit("resize");
  output.columns = 60; output.rows = 9; output.emit("resize");
  await tick();
  input.emit("data", Buffer.from("q"));
  await running;
  assert.equal(dimensions[0], "80x12");
  assert.equal(dimensions.at(-1), "60x9");
  assert.ok(dimensions.filter((value) => value === "60x9").length >= 1);
});

test("interrupt and thrown handlers restore raw mode and terminal ownership", async () => {
  for (const scenario of ["interrupt", "throw"] as const) {
    const input = new FakeInput();
    const output = new FakeOutput();
    const running = runBrowserTerminal({
      input,
      output,
      frame: () => ["frame"],
      onKey: async (key) => {
        if (scenario === "throw") throw new Error("handler failed");
        return key.name === "interrupt" ? "interrupt" : undefined;
      },
    });
    await tick();
    input.emit("data", Buffer.from(scenario === "throw" ? "x" : "\u0003"));
    if (scenario === "throw") await assert.rejects(running, /handler failed/);
    else assert.equal(await running, "interrupt");
    assert.deepEqual(input.raw, [true, false]);
    assert.match(output.writes.join(""), /\u001b\[\?25h\u001b\[\?1049l/);
  }
});

test("SIGTERM and SIGHUP restore terminal modes and remove scoped signal listeners", async () => {
  for (const [signal, expected] of [["SIGTERM", "terminate"], ["SIGHUP", "hangup"]] as const) {
    const input = new FakeInput();
    const output = new FakeOutput();
    const signals = new EventEmitter();
    const running = runBrowserTerminal({
      input,
      output,
      signalSource: signals,
      frame: () => ["frame"],
      onKey: async (key) => key.name === "character" && key.value === "q" ? "quit" : undefined,
    });
    await tick();
    if (signals.listenerCount(signal) === 0) {
      input.emit("data", Buffer.from("q"));
      await running;
    }
    assert.equal(signals.listenerCount(signal), 1);
    signals.emit(signal);
    assert.equal(await running, expected);
    assert.equal(signals.listenerCount("SIGTERM"), 0);
    assert.equal(signals.listenerCount("SIGHUP"), 0);
    assert.deepEqual(input.raw, [true, false]);
    assert.match(output.writes.join(""), /\u001b\[\?25h\u001b\[\?1049l/);
  }
});

test("EPIPE during a frame exits quietly after best-effort restoration", async () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  let writes = 0;
  output.write = (chunk: string, callback?: (error?: Error | null) => void): boolean => {
    output.writes.push(chunk);
    writes += 1;
    const error = writes === 2 ? Object.assign(new Error("broken pipe"), { code: "EPIPE" }) : undefined;
    queueMicrotask(() => callback?.(error));
    return true;
  };
  assert.equal(await runBrowserTerminal({ input, output, frame: () => ["frame"], onKey: async () => undefined }), "epipe");
  assert.deepEqual(input.raw, [true, false]);
  assert.equal(input.listenerCount("data"), 0);
});
