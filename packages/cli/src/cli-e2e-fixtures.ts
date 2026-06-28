import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect } from "vite-plus/test";
import { runCli } from "./index.js";

export let root = "";

export function installCliFixture(): void {
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "qdcli-e2e-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
}

export async function qd(...args: string[]): Promise<string> {
  const result = await qdRaw(args);
  if (result.exitCode) {
    throw new Error(
      `qd ${args.join(" ")} exited ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result.stdout;
}

export async function qdAt(targetRoot: string, ...args: string[]): Promise<string> {
  const result = await qdRaw(["--root", targetRoot, ...args]);
  if (result.exitCode) {
    throw new Error(
      `qd --root ${targetRoot} ${args.join(" ")} exited ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result.stdout;
}

export async function qdJson(...args: string[]): Promise<Record<string, any>> {
  const text = await qd(...args);
  return JSON.parse(text) as Record<string, any>;
}

export async function qdJsonAllowExit(
  ...args: string[]
): Promise<{ exitCode: number | undefined; json: Record<string, any>; stderr: string }> {
  const result = await qdRaw(args);
  return {
    exitCode: result.exitCode,
    json: JSON.parse(result.stdout) as Record<string, any>,
    stderr: result.stderr,
  };
}

export async function expectQdFailure(pattern: RegExp, ...args: string[]): Promise<void> {
  const result = await qdRaw(args);
  expect(result.exitCode).toBeTruthy();
  expect(`${result.stdout}\n${result.stderr}`).toMatch(pattern);
}

export async function configureStrictDoctorCommands(): Promise<void> {
  await qd("config", "set", "check_command", 'node -e "process.exit(0)"');
  await qd("config", "set", "ci_command", 'node -e "process.exit(0)"');
}

export async function qdRaw(
  args: string[],
): Promise<{ exitCode: number | undefined; stdout: string; stderr: string }> {
  const previousExitCode = process.exitCode;
  const output: string[] = [];
  const errors: string[] = [];
  const previousLog = console.log;
  const previousError = console.error;
  const rootedArgs = args.includes("--root") ? args : ["--root", root, ...args];
  process.exitCode = undefined;
  console.log = (...values: unknown[]) => {
    output.push(values.map(String).join(" "));
  };
  console.error = (...values: unknown[]) => {
    errors.push(values.map(String).join(" "));
  };
  try {
    await runCli(rootedArgs);
    return {
      exitCode: typeof process.exitCode === "number" ? process.exitCode : undefined,
      stdout: output.join("\n"),
      stderr: errors.join("\n"),
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: output.join("\n"),
      stderr: [errors.join("\n"), error instanceof Error ? error.message : String(error)]
        .filter(Boolean)
        .join("\n"),
    };
  } finally {
    console.log = previousLog;
    console.error = previousError;
    process.exitCode = previousExitCode;
  }
}
