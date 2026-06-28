import { appendFile } from "node:fs/promises";
import { spawn } from "node:child_process";

export function runShellCommand(
  command: string,
  cwd: string,
  logPath: string,
  options: { timeoutSeconds?: number; noOutputTimeoutSeconds?: number } = {},
): Promise<{ exitCode: number; timedOut: boolean; noOutputTimedOut: boolean }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let lastOutputAt = Date.now();
    let timedOut = false;
    let noOutputTimedOut = false;
    const pendingWrites: Promise<void>[] = [];
    const child = spawn(command, {
      cwd,
      env: shellEnvironment(cwd),
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const commandTimeoutMs = timeoutMs(options.timeoutSeconds);
    const timeout =
      commandTimeoutMs !== null
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, commandTimeoutMs)
        : null;
    const outputTimeoutMs = timeoutMs(options.noOutputTimeoutSeconds);
    const noOutput =
      outputTimeoutMs !== null
        ? setInterval(() => {
            if (Date.now() - lastOutputAt > outputTimeoutMs) {
              timedOut = true;
              noOutputTimedOut = true;
              child.kill("SIGTERM");
            }
          }, noOutputIntervalMs(options.noOutputTimeoutSeconds))
        : null;
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (noOutput) clearInterval(noOutput);
    };
    const logChunk = (chunk: Buffer): void => {
      pendingWrites.push(appendFile(logPath, chunk));
    };
    child.stdout.on("data", (chunk: Buffer) => {
      lastOutputAt = Date.now();
      process.stdout.write(chunk);
      logChunk(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      lastOutputAt = Date.now();
      process.stderr.write(chunk);
      logChunk(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      Promise.all(pendingWrites).then(
        () => resolve({ exitCode: exitCodeFromChild(code, signal), timedOut, noOutputTimedOut }),
        reject,
      );
    });
  });
}

export async function runPolicyHook(
  root: string,
  command: string,
  placeholders: Record<string, string>,
): Promise<void> {
  const rendered = renderPolicyHookCommand(command, placeholders);
  const result = await captureShellCommand(rendered, root);
  if (result.code !== 0) {
    throw new Error(
      `Policy hook failed (${result.code}): ${rendered}\n${result.stderr || result.stdout}`,
    );
  }
}

export function shellEnvironment(cwd: string): NodeJS.ProcessEnv {
  return { ...process.env, QD_ROOT: cwd };
}

export function timeoutMs(seconds: number | undefined): number | null {
  return seconds && seconds > 0 ? seconds * 1000 : null;
}

export function noOutputIntervalMs(seconds: number | undefined): number {
  return Math.min((seconds ?? 1) * 1000, 30_000);
}

export function exitCodeFromChild(code: number | null, signal: NodeJS.Signals | null): number {
  return signal ? 124 : (code ?? 1);
}

export function renderPolicyHookCommand(
  command: string,
  placeholders: Record<string, string>,
): string {
  return Object.entries(placeholders).reduce(
    (current, [key, value]) => current.replaceAll(`{${key}}`, shellQuote(value)),
    command,
  );
}

export function captureShellCommand(
  command: string,
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("exit", (code: number | null) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}

export function captureCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("exit", (code: number | null) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
