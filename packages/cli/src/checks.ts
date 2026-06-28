import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  gateNode,
  getNode,
  getProjectPaths,
  policyReport,
  readConfig,
  recordCheckResult,
  recordCiResult,
  type QdConfig,
  type QdNode,
} from "@cat-cave/qdcli-core";
import { output, stringOpt } from "./args.js";
import { captureCommand, runPolicyHook, runShellCommand } from "./shell.js";

export async function runConfiguredCheck(
  root: string,
  nodeId: string,
  kind: "check" | "ci",
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const result = await executeConfiguredCheck(root, nodeId, kind, options);
  output(result, json);
  if (!result.ok) process.exitCode = result.exitCode;
}

export async function executeConfiguredCheck(
  root: string,
  nodeId: string,
  kind: "check" | "ci",
  options: Record<string, string | string[] | boolean>,
): Promise<{
  ok: boolean;
  exitCode: number;
  command: string | null;
  logPath: string | null;
  timedOut?: boolean;
  noOutputTimedOut?: boolean;
  node?: unknown;
  blocking?: unknown;
}> {
  const config = await readConfig(root);
  if (config.requireGateBeforeCi) {
    const gate = await gateNode(root, nodeId);
    if (!gate.ok) {
      return { ok: false, exitCode: 1, command: null, logPath: null, blocking: gate.blocking };
    }
  }

  if (kind === "ci") {
    const policy = await policyReport(root, nodeId, "ci");
    if (!policy.ok) {
      return { ok: false, exitCode: 1, command: null, logPath: null, blocking: policy };
    }
  }

  if (config.requireCleanWorktree) await assertCleanWorktree(root, config.cleanWorktreeExcept);

  const node = await getNode(root, nodeId);
  const command = commandForCheck(kind, node, config, options);
  if (!command.trim()) throw new Error(`${kind}_command is empty; configure it or pass --cmd`);
  if (shouldRunHook(options, config.hooks.preCheck)) {
    await runPolicyHook(root, config.hooks.preCheck, { root, node: nodeId, command });
  }
  const paths = getProjectPaths(root);
  await mkdir(paths.logsDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const logPath = path.join(
    paths.logsDir,
    `${kind}-${nodeId}-${startedAt.replace(/[:.]/g, "-")}.log`,
  );
  const execution = await runShellCommand(
    command,
    root,
    logPath,
    timeoutOptionsForCheck(kind, config),
  );
  if (shouldRunHook(options, config.hooks.postCheck)) {
    await runPolicyHook(root, config.hooks.postCheck, {
      root,
      node: nodeId,
      command,
      log: logPath,
    });
  }
  const finishedAt = new Date().toISOString();
  const status = runStatusFromExecution(execution);
  const recorder = kind === "ci" ? recordCiResult : recordCheckResult;
  const updatedNode = await recorder(root, nodeId, {
    status: recorderStatusForRunStatus(status),
    summary: `${kind} command ${status}: ${command}`,
    logPath,
    startedAt,
    finishedAt,
  });
  return {
    ok: execution.exitCode === 0,
    exitCode: execution.exitCode,
    timedOut: execution.timedOut,
    noOutputTimedOut: execution.noOutputTimedOut,
    command,
    logPath,
    node: updatedNode,
  };
}

export function commandForCheck(
  kind: "check" | "ci",
  node: Pick<QdNode, "check_command" | "ci_command">,
  config: QdConfig,
  options: Record<string, string | string[] | boolean>,
): string {
  return (
    stringOpt(options.cmd) ??
    (kind === "ci" ? node.ci_command : node.check_command) ??
    (kind === "ci" ? config.ciCommand : config.checkCommand)
  );
}

export function timeoutOptionsForCheck(
  kind: "check" | "ci",
  config: QdConfig,
): {
  timeoutSeconds: number;
  noOutputTimeoutSeconds: number;
} {
  return {
    timeoutSeconds: kind === "ci" ? config.ciTimeoutSeconds : config.checkTimeoutSeconds,
    noOutputTimeoutSeconds:
      kind === "ci" ? config.ciNoOutputTimeoutSeconds : config.checkNoOutputTimeoutSeconds,
  };
}

export function shouldRunHook(
  options: Record<string, string | string[] | boolean>,
  hookCommand: string,
): boolean {
  return !options["no-hooks"] && hookCommand.trim().length > 0;
}

export function runStatusFromExecution(execution: {
  exitCode: number;
  timedOut?: boolean;
}): "passed" | "timed_out" | "failed" {
  if (execution.exitCode === 0) return "passed";
  if (execution.timedOut) return "timed_out";
  return "failed";
}

export function recorderStatusForRunStatus(
  status: "passed" | "timed_out" | "failed",
): "passed" | "failed" {
  return status === "passed" ? "passed" : "failed";
}

async function assertCleanWorktree(root: string, except: string[]): Promise<void> {
  const result = await captureCommand("git", ["status", "--porcelain"], root);
  if (result.code !== 0) throw new Error("require_clean_worktree is true, but git status failed");
  const dirtyLines = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !isExceptedDirtyPath(line.slice(3), except));
  if (dirtyLines.length > 0) {
    throw new Error(`Worktree must be clean before CI/check runs:\n${dirtyLines.join("\n")}`);
  }
}

function isExceptedDirtyPath(filePath: string, except: string[]): boolean {
  return except.some(
    (entry) => filePath === entry || filePath.startsWith(entry.endsWith("/") ? entry : `${entry}/`),
  );
}
