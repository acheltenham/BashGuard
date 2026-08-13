import type { ChildProcess } from "node:child_process";

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
