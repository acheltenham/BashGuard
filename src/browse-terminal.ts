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

export type BrowserTerminalOptions = {
  input: BrowserTerminalInput;
  output: BrowserTerminalOutput;
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

export function decodeBrowserKeys(value: string): BrowserTerminalKey[] {
  const keys: BrowserTerminalKey[] = [];
  for (let index = 0; index < value.length;) {
    const escape = [...escapeKeys.entries()].find(([sequence]) => value.startsWith(sequence, index));
    if (escape) {
      keys.push(escape[1]);
      index += escape[0].length;
      continue;
    }
    const character = value[index]!;
    if (character === "\u001b") keys.push({ name: "escape" });
    else if (character === "\u0003") keys.push({ name: "interrupt" });
    else if (character === "\r" || character === "\n") keys.push({ name: "enter" });
    else if (character === "\t") keys.push({ name: "tab" });
    else if (character === "\u007f" || character === "\b") keys.push({ name: "backspace" });
    else if (character >= " ") keys.push({ name: "character", value: character });
    index += 1;
  }
  return keys;
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

export async function runBrowserTerminal(options: BrowserTerminalOptions): Promise<"quit" | "interrupt" | "epipe"> {
  const { input, output } = options;
  let rawEnabled = false;
  let stopped = false;
  let resolveExit!: (result: "quit" | "interrupt") => void;
  let rejectExit!: (error: unknown) => void;
  const exit = new Promise<"quit" | "interrupt">((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });
  let work = Promise.resolve();
  let resizeQueued = false;

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
  const onData = (chunk: Buffer | string) => {
    const keys = decodeBrowserKeys(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
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
  const onResize = () => {
    if (resizeQueued || stopped) return;
    resizeQueued = true;
    enqueue(async () => {
      resizeQueued = false;
      if (!stopped) await redraw();
    });
  };

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
    if (rawEnabled) input.setRawMode?.(false);
    input.pause();
    try {
      await writeTerminal(output, BROWSER_RESTORE_SEQUENCE);
    } catch {
      // Terminal ownership restoration is best effort after a failed stream write.
    }
  }
}
