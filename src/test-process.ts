import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type PortablePtyResult = {
  raw: string;
  transcript: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

export function portablePtyUnavailableReason(): string | undefined {
  if (process.platform === "win32") return "real PTY tests are unsupported on Windows";
  if (process.platform !== "darwin" && process.platform !== "linux") return `real PTY tests have no script adapter for ${process.platform}`;
  const script = spawnSync("/bin/sh", ["-c", "command -v script"], { encoding: "utf8" });
  if (script.status !== 0 || !script.stdout.trim()) return "system script utility is unavailable";
  if (process.platform === "darwin") {
    const expect = spawnSync("/bin/sh", ["-c", "command -v expect"], { encoding: "utf8" });
    if (expect.status !== 0 || !expect.stdout.trim()) return "system expect utility is unavailable on macOS";
  }
  return undefined;
}

/** Run a bounded shell scenario inside a real system PTY without a native addon. */
export async function runPortablePty(input: {
  scenario: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  send?: { afterMs: number; text: string }[];
}): Promise<PortablePtyResult> {
  const unavailable = portablePtyUnavailableReason();
  if (unavailable) throw new Error(unavailable);

  const directory = await mkdtemp(join(tmpdir(), "bashguard-pty-"));
  const scenario = join(directory, "scenario.sh");
  const transcriptPath = join(directory, "transcript.raw");
  await writeFile(scenario, `#!/bin/sh\nset -eu\n${input.scenario}\n`, { mode: 0o700 });

  const scriptLookup = spawnSync("/bin/sh", ["-c", "command -v script"], { encoding: "utf8" });
  const script = scriptLookup.stdout.trim();
  let executable = script;
  let args = process.platform === "darwin"
    ? ["-q", transcriptPath, "/bin/sh", scenario]
    : ["-q", "-e", "-c", `/bin/sh ${shellQuote(scenario)}`, transcriptPath];

  if (process.platform === "darwin") {
    const spawnArguments = [script, ...args].map(tclBrace).join(" ");
    const scheduledSends = (input.send ?? []).map(({ afterMs, text }) => `after ${Math.max(0, Math.trunc(afterMs))} { send -- \"${tclSendText(text)}\" }`);
    const expectProgram = [
      `set timeout ${Math.max(1, Math.ceil((input.timeoutMs ?? 10_000) / 1_000))}`,
      "log_user 1",
      `spawn -noecho ${spawnArguments}`,
      ...scheduledSends,
      "expect { timeout { exit 124 } eof {} }",
      "set result [wait]",
      "exit [lindex $result 3]",
    ].join("\n");
    executable = "/usr/bin/expect";
    args = ["-c", expectProgram];
  }

  const child = spawn(executable, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...input.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const sends = process.platform === "darwin" ? [] : (input.send ?? []).map(({ afterMs, text }) => setTimeout(() => child.stdin.write(text), afterMs));
  const diagnostics = () => ({
    stdout: Buffer.concat(stdout).toString(),
    stderr: Buffer.concat(stderr).toString(),
  });

  try {
    const exitCode = await waitForExit(child, diagnostics, input.timeoutMs ?? 10_000);
    for (const timer of sends) clearTimeout(timer);
    child.stdin.end();
    const raw = Buffer.concat([...stdout, ...stderr]).toString();
    const transcript = await readFile(transcriptPath).then((value) => value.toString()).catch(() => "");
    return { raw, transcript, exitCode, signal: child.signalCode };
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\ntranscript:\n${await readFile(transcriptPath, "utf8").catch(() => "<unavailable>")}`);
  } finally {
    for (const timer of sends) clearTimeout(timer);
    await rm(directory, { recursive: true, force: true });
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function tclBrace(value: string): string {
  return `{${value.replaceAll("\\", "\\\\").replaceAll("}", "\\}")}}`;
}

function tclSendText(value: string): string {
  return [...value].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return `\\x${code.toString(16).padStart(2, "0")}`;
    return character.replace(/[\\"$[\]]/gu, "\\$&");
  }).join("");
}

export async function waitForExit(
  child: ChildProcess,
  diagnostics: () => { stdout: string; stderr: string },
  timeoutMs = 5_000,
): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;

  return new Promise<number | null>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null): void => {
      cleanup();
      resolve(code);
    };
    const timer = setTimeout(() => {
      cleanup();
      child.kill("SIGKILL");
      const { stdout, stderr } = diagnostics();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for child process ${child.pid ?? "unknown"}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);

    child.once("error", onError);
    child.once("exit", onExit);
  });
}
