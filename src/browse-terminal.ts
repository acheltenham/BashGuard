import { StringDecoder } from "node:string_decoder";

export const BROWSER_ENTER_SEQUENCE = "\u001b[?1049h\u001b[?25l";
export const BROWSER_RESTORE_SEQUENCE = "\u001b[?25h\u001b[?1049l";
const FRAME_PREFIX = "\u001b[H\u001b[2J";

export type BrowserTerminalKey =
  | { name: "up" | "down" | "left" | "right" | "page-up" | "page-down" | "home" | "end" | "enter" | "tab" | "escape" | "backspace" | "interrupt" }
  | { name: "character"; value: string };

export type BrowserTerminalInput = NodeJS.ReadableStream & {
  isTTY?: boolean;
  setRawMode?(enabled: boolean): void;
  resume(): void;
  pause(): void;
  on(event: "data", listener: (chunk: Buffer | string) => void): this;
  off(event: "data", listener: (chunk: Buffer | string) => void): this;
};

export type BrowserTerminalOutput = NodeJS.WritableStream & {
  isTTY?: boolean;
  columns?: number;
  rows?: number;
  on(event: "resize", listener: () => void): this;
  off(event: "resize", listener: () => void): this;
};

export type BrowserTerminalSignalSource = {
  on(event: "SIGTERM" | "SIGHUP", listener: () => void): unknown;
  off(event: "SIGTERM" | "SIGHUP", listener: () => void): unknown;
};

export type BrowserTerminalResult = "quit" | "interrupt" | "terminate" | "hangup" | "epipe";

export type BrowserTerminalOptions = {
  input: BrowserTerminalInput;
  output: BrowserTerminalOutput;
  signalSource?: BrowserTerminalSignalSource;
  frame(dimensions: { columns: number; rows: number }): string[];
  onKey(key: BrowserTerminalKey): Promise<"quit" | "interrupt" | void> | "quit" | "interrupt" | void;
};

const escapeKeys = new Map<string, BrowserTerminalKey>([
  ["\u001b[A", { name: "up" }],
  ["\u001b[B", { name: "down" }],
  ["\u001b[C", { name: "right" }],
  ["\u001b[D", { name: "left" }],
  ["\u001b[5~", { name: "page-up" }],
  ["\u001b[6~", { name: "page-down" }],
  ["\u001b[H", { name: "home" }],
  ["\u001b[F", { name: "end" }],
  ["\u001bOH", { name: "home" }],
  ["\u001bOF", { name: "end" }],
]);

function characterKey(character: string): BrowserTerminalKey | undefined {
  if (character === "\u001b") return { name: "escape" };
  if (character === "\u0003") return { name: "interrupt" };
  if (character === "\r" || character === "\n") return { name: "enter" };
  if (character === "\t") return { name: "tab" };
  if (character === "\u007f" || character === "\b") return { name: "backspace" };
  if (character >= " ") return { name: "character", value: character };
  return undefined;
}

export type BrowserKeyDecoder = {
  push(chunk: Buffer | string): BrowserTerminalKey[];
  flush(): BrowserTerminalKey[];
  readonly hasPending: boolean;
};

export function createBrowserKeyDecoder(): BrowserKeyDecoder {
  const utf8 = new StringDecoder("utf8");
  let pending = "";

  const parse = (flush: boolean): BrowserTerminalKey[] => {
    const keys: BrowserTerminalKey[] = [];
    while (pending.length > 0) {
      const escape = [...escapeKeys.entries()].find(([sequence]) => pending.startsWith(sequence));
      if (escape) {
        keys.push(escape[1]);
        pending = pending.slice(escape[0].length);
        continue;
      }
      if (!flush && pending.startsWith("\u001b") && [...escapeKeys.keys()].some((sequence) => sequence.startsWith(pending))) break;
      const [character] = [...pending];
      if (!character) break;
      const key = characterKey(character);
      if (key) keys.push(key);
      pending = pending.slice(character.length);
    }
    return keys;
  };

  return {
    push(chunk) {
      pending += typeof chunk === "string" ? chunk : utf8.write(chunk);
      return parse(false);
    },
    flush() {
      pending += utf8.end();
      return parse(true);
    },
    get hasPending() {
      return pending.length > 0;
    },
  };
}

export function decodeBrowserKeys(value: string): BrowserTerminalKey[] {
  const decoder = createBrowserKeyDecoder();
  return [...decoder.push(value), ...decoder.flush()];
}

function writeTerminal(output: BrowserTerminalOutput, text: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error | null) => {
      if (settled) return;
      settled = true;
      error ? reject(error) : resolve();
    };
    try {
      output.write(text, finish);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

export async function runBrowserTerminal(options: BrowserTerminalOptions): Promise<BrowserTerminalResult> {
  const { input, output } = options;
  const signalSource = options.signalSource ?? process;
  let rawEnabled = false;
  let stopped = false;
  let resolveExit!: (result: Exclude<BrowserTerminalResult, "epipe">) => void;
  let rejectExit!: (error: unknown) => void;
  const exit = new Promise<Exclude<BrowserTerminalResult, "epipe">>((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });
  let work = Promise.resolve();
  let resizeQueued = false;
  const keyDecoder = createBrowserKeyDecoder();
  let keyFlushTimer: NodeJS.Timeout | undefined;

  const dimensions = () => ({
    columns: Number.isFinite(output.columns) && (output.columns ?? 0) > 0 ? Math.floor(output.columns!) : 80,
    rows: Number.isFinite(output.rows) && (output.rows ?? 0) > 0 ? Math.floor(output.rows!) : 24,
  });
  const redraw = async () => {
    const lines = options.frame(dimensions());
    await writeTerminal(output, `${FRAME_PREFIX}${lines.join("\r\n")}`);
  };
  const fail = (error: unknown) => {
    if (stopped) return;
    stopped = true;
    rejectExit(error);
  };
  const enqueue = (operation: () => Promise<void>) => {
    work = work.then(operation).catch(fail);
  };
  const enqueueKeys = (keys: BrowserTerminalKey[]) => {
    for (const key of keys) {
      enqueue(async () => {
        if (stopped) return;
        const action = key.name === "interrupt" ? "interrupt" : await options.onKey(key);
        if (action === "quit" || action === "interrupt") {
          stopped = true;
          resolveExit(action);
          return;
        }
        await redraw();
      });
    }
  };
  const onData = (chunk: Buffer | string) => {
    if (keyFlushTimer) clearTimeout(keyFlushTimer);
    keyFlushTimer = undefined;
    enqueueKeys(keyDecoder.push(chunk));
    if (keyDecoder.hasPending) {
      keyFlushTimer = setTimeout(() => {
        keyFlushTimer = undefined;
        enqueueKeys(keyDecoder.flush());
      }, 25);
    }
  };
  const onResize = () => {
    if (resizeQueued || stopped) return;
    resizeQueued = true;
    enqueue(async () => {
      resizeQueued = false;
      if (!stopped) await redraw();
    });
  };
  const onTerminate = () => {
    if (stopped) return;
    stopped = true;
    resolveExit("terminate");
  };
  const onHangup = () => {
    if (stopped) return;
    stopped = true;
    resolveExit("hangup");
  };

  signalSource.on("SIGTERM", onTerminate);
  signalSource.on("SIGHUP", onHangup);
  try {
    await writeTerminal(output, BROWSER_ENTER_SEQUENCE);
    input.setRawMode?.(true);
    rawEnabled = true;
    input.resume();
    input.on("data", onData);
    output.on("resize", onResize);
    await redraw();
    return await exit;
  } catch (error) {
    if (errorCode(error) === "EPIPE") return "epipe";
    throw error;
  } finally {
    stopped = true;
    input.off("data", onData);
    output.off("resize", onResize);
    signalSource.off("SIGTERM", onTerminate);
    signalSource.off("SIGHUP", onHangup);
    if (keyFlushTimer) clearTimeout(keyFlushTimer);
    await work.catch(() => undefined);
    if (rawEnabled) input.setRawMode?.(false);
    input.pause();
    try {
      await writeTerminal(output, BROWSER_RESTORE_SEQUENCE);
    } catch {
      // Terminal ownership restoration is best effort after a failed stream write.
    }
  }
}
