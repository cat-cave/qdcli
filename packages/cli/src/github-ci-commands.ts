import { listNodes, policyReport, recordCiResult, type QdNode } from "@cat-cave/qdcli-core";
import { numberOpt, output, stringOpt } from "./args.js";
import { githubPrStatus, updateGitHubPullRequestBranch, type GitHubPrStatus } from "./github-pr.js";
import { sleep } from "./shell.js";

const IN_FLIGHT_STATUSES = new Set([
  "claimed",
  "working",
  "review",
  "fixing",
  "ci",
  "mergeable",
  "blocked",
]);

export function runMonitor(
  root: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  return githubCiStatusCommand(root, undefined, { ...options, all: true }, json);
}

export async function githubCiStatusCommand(
  root: string,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (options.all) {
    const statuses = await githubStatusesForAll(root, options);
    output(
      json ? { ok: statuses.every(statusIsNonFailing), nodes: statuses } : monitorRows(statuses),
      json,
    );
    setMonitorExitCode(statuses);
    return;
  }
  if (!nodeId) throw new Error("qd ci status requires a node id or --all");
  const status = await githubPrStatus(root, nodeId, { repo: stringOpt(options.repo) });
  output(status, json);
  setMonitorExitCode([status]);
}

export async function githubCiWatchCommand(
  root: string,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (!nodeId) throw new Error("qd ci watch requires a node id");
  const intervalSeconds = numberOpt(options.interval) ?? 10;
  const timeoutSeconds = numberOpt(options.timeout) ?? 1800;
  if (intervalSeconds < 1) throw new Error("--interval must be at least 1 second");
  if (timeoutSeconds < 1) throw new Error("--timeout must be at least 1 second");
  const startedAt = Date.now();
  let status: GitHubPrStatus | null = null;
  while (Date.now() - startedAt <= timeoutSeconds * 1000) {
    status = await githubPrStatus(root, nodeId, { repo: stringOpt(options.repo) });
    if (!json) {
      console.log(
        `${status.glyph} ${status.nodeId} PR #${status.pr.number}: ${status.checkState}, behind ${status.behind}, ${status.pr.mergeStateStatus}`,
      );
    }
    if (status.checkState === "pass" || status.checkState === "fail") break;
    await sleep(intervalSeconds * 1000);
  }
  if (!status) throw new Error(`Unable to read PR status for ${nodeId}`);
  const timedOut = !["pass", "fail"].includes(status.checkState);
  output({ ...status, timedOut }, json);
  process.exitCode =
    status.checkState === "pass" ? undefined : status.checkState === "fail" ? 1 : 8;
}

export async function syncPullRequestsCommand(
  root: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const nodes = (await listNodes(root)).filter((node) => IN_FLIGHT_STATUSES.has(node.status));
  const results = [];
  for (const node of nodes) {
    try {
      const status = await githubPrStatus(root, node, { repo: stringOpt(options.repo) });
      if (options.rebase && status.behind > 0) {
        await updateGitHubPullRequestBranch(root, status, true);
        results.push({ nodeId: node.id, action: "rebase-requested", status });
        continue;
      }
      const policy = await policyReport(root, node.id, "ci");
      if (!status.readyToMerge || !policy.ok) {
        results.push({ nodeId: node.id, action: "none", status, policy });
        continue;
      }
      if (node.status === "mergeable") {
        results.push({ nodeId: node.id, action: "already-mergeable", status, policy });
        continue;
      }
      const updated = await recordVerifiedGitHubCi(root, node, status);
      results.push({
        nodeId: node.id,
        action: "advanced-to-mergeable",
        status,
        policy,
        node: updated,
      });
    } catch (error) {
      results.push({
        nodeId: node.id,
        action: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const ok = results.every((result) => result.action !== "error");
  output({ ok, nodes: results }, json);
  if (!ok) process.exitCode = 1;
}

export async function githubMergeQueue(
  root: string,
  options: Record<string, string | string[] | boolean>,
): Promise<GitHubPrStatus[]> {
  const statuses = await githubStatusesForAll(root, options);
  return statuses.filter(
    (status): status is GitHubPrStatus =>
      "readyToMerge" in status && status.ledgerStatus === "mergeable" && status.readyToMerge,
  );
}

export async function verifiedGithubCiStatus(
  root: string,
  nodeId: string,
  options: Record<string, string | string[] | boolean>,
): Promise<GitHubPrStatus> {
  const status = await githubPrStatus(root, nodeId, { repo: stringOpt(options.repo) });
  if (status.checkState !== "pass") {
    throw new Error(
      `GitHub PR #${status.pr.number} required checks are ${status.checkState}, not concluded-success`,
    );
  }
  return status;
}

export async function recordVerifiedGitHubCi(root: string, node: QdNode, status: GitHubPrStatus) {
  return recordCiResult(root, node.id, {
    status: "passed",
    summary: `GitHub required checks passed for PR #${status.pr.number}: ${status.checks.map((check) => check.name).join(", ")}`,
    provider: "github",
    gitSha: status.pr.headRefOid,
    externalId: String(status.pr.number),
    url: status.evidenceUrl,
    logPath: null,
  });
}

export type MonitorStatus =
  | GitHubPrStatus
  | { nodeId: string; ledgerStatus: string; error: string };

async function githubStatusesForAll(
  root: string,
  options: Record<string, string | string[] | boolean>,
): Promise<MonitorStatus[]> {
  const nodes = (await listNodes(root)).filter((node) => IN_FLIGHT_STATUSES.has(node.status));
  return Promise.all(
    nodes.map(async (node): Promise<MonitorStatus> => {
      try {
        return await githubPrStatus(root, node, { repo: stringOpt(options.repo) });
      } catch (error) {
        return {
          nodeId: node.id,
          ledgerStatus: node.status,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

export function monitorRows(statuses: MonitorStatus[]): Array<Record<string, unknown>> {
  return statuses.map((status) =>
    "error" in status
      ? { state: "?", node: status.nodeId, ledger: status.ledgerStatus, error: status.error }
      : {
          state: status.glyph,
          node: status.nodeId,
          pr: `#${status.pr.number}`,
          checks: status.checkState,
          behind: status.behind,
          mergeability: status.pr.mergeStateStatus,
          ledger: status.ledgerStatus,
        },
  );
}

export function statusIsNonFailing(status: MonitorStatus): boolean {
  return !("error" in status) && status.checkState !== "fail";
}

export function monitorExitCode(statuses: MonitorStatus[]): 1 | 8 | undefined {
  if (statuses.some((status) => "error" in status || status.checkState === "fail")) return 1;
  if (statuses.some((status) => "error" in status || status.checkState !== "pass")) return 8;
  return undefined;
}

function setMonitorExitCode(statuses: MonitorStatus[]): void {
  process.exitCode = monitorExitCode(statuses);
}
