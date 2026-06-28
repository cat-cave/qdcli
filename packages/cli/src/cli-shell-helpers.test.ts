import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  captureShellCommand,
  exitCodeFromChild,
  noOutputIntervalMs,
  renderPolicyHookCommand,
  runPolicyHook,
  runShellCommand,
  shellEnvironment,
  shellQuote,
  timeoutMs,
} from "./shell.js";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "qdcli-shell-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("shell helpers", () => {
  it("renders shell hook placeholders with strict quoting", () => {
    expect(shellQuote("plain")).toBe("'plain'");
    expect(shellQuote("can't")).toBe("'can'\\''t'");
    expect(renderPolicyHookCommand("echo {node} {root}", { node: "node a", root })).toBe(
      `echo 'node a' '${root}'`,
    );
    expect(renderPolicyHookCommand("echo {missing}", { node: "node-a" })).toBe("echo {missing}");
    expect(shellEnvironment(root).QD_ROOT).toBe(root);
  });

  it("normalizes timeout and child exit behavior", () => {
    expect(timeoutMs(undefined)).toBeNull();
    expect(timeoutMs(0)).toBeNull();
    expect(timeoutMs(-1)).toBeNull();
    expect(timeoutMs(2)).toBe(2000);
    expect(noOutputIntervalMs(undefined)).toBe(1000);
    expect(noOutputIntervalMs(2)).toBe(2000);
    expect(noOutputIntervalMs(60)).toBe(30000);
    expect(exitCodeFromChild(0, null)).toBe(0);
    expect(exitCodeFromChild(5, null)).toBe(5);
    expect(exitCodeFromChild(null, null)).toBe(1);
    expect(exitCodeFromChild(0, "SIGTERM")).toBe(124);
  });

  it("captures shell commands, writes logs, and fails policy hooks loudly", async () => {
    const logPath = path.join(root, "command.log");
    const result = await runShellCommand("printf stdout && printf stderr >&2", root, logPath, {
      timeoutSeconds: 5,
      noOutputTimeoutSeconds: 5,
    });
    expect(result).toEqual({ exitCode: 0, timedOut: false, noOutputTimedOut: false });
    expect((await stat(logPath)).size).toBeGreaterThan(0);
    expect(await readFile(logPath, "utf8")).toBe("stdoutstderr");

    await expect(runPolicyHook(root, "printf hook-stdout; exit 9", {})).rejects.toThrow(
      /hook-stdout/,
    );
    await expect(runPolicyHook(root, "printf hook-stderr >&2; exit 8", {})).rejects.toThrow(
      /hook-stderr/,
    );
    await expect(captureShellCommand("printf captured", root)).resolves.toMatchObject({
      code: 0,
      stdout: "captured",
      stderr: "",
    });
    await expect(captureShellCommand("printf err >&2; exit 6", root)).resolves.toMatchObject({
      code: 6,
      stdout: "",
      stderr: "err",
    });
  });

  it("records command and no-output timeouts distinctly", async () => {
    await expect(
      runShellCommand('node -e "setTimeout(() => {}, 2000)"', root, path.join(root, "a.log"), {
        timeoutSeconds: 0.01,
      }),
    ).resolves.toEqual({ exitCode: 124, timedOut: true, noOutputTimedOut: false });

    await expect(
      runShellCommand('node -e "setTimeout(() => {}, 2000)"', root, path.join(root, "b.log"), {
        noOutputTimeoutSeconds: 0.01,
      }),
    ).resolves.toEqual({ exitCode: 124, timedOut: true, noOutputTimedOut: true });
  });
});
