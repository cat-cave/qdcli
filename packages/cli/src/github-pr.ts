import {
  getNode,
  markMergeQueued,
  readConfig,
  setNodePullRequest,
  type QdConfig,
  type QdNode,
} from "@cat-cave/qdcli-core";
import { captureCommand, sleep } from "./shell.js";
import {
  aggregateGitHubChecks,
  monitorGlyph,
  parseGitHubPullRequest,
  prCompareArgs,
  prMergeArgs,
  prUpdateBranchArgs,
  prViewArgs,
  type GitHubCheckState,
  type GitHubPrCheck,
  type GitHubPullRequest,
} from "./github-pr-model.js";
import {
  enqueueGitHubPullRequest,
  githubMergeQueueObservation,
  type GitHubMergeQueueEntryState,
  type GitHubMergeQueueObservation,
} from "./github-merge-queue.js";
import {
  githubBranchPolicy,
  githubRequiredChecksForCommit,
  type GitHubBranchPolicy,
} from "./github-rules.js";

export type GitHubQueueMembership = "disabled" | "not-enqueued" | "queued" | "ejected" | "merged";

export interface GitHubQueueStatus {
  enabled: boolean;
  membership: GitHubQueueMembership;
  position: number | null;
  entryId: string | null;
  entryState: GitHubMergeQueueEntryState | null;
  enqueuedAt: string | null;
  estimatedTimeToMerge: number | null;
  autoMergeEnabled: boolean;
  mergeGroupSha: string | null;
  checks: GitHubPrCheck[];
  checkState: GitHubCheckState;
  missingRequiredChecks: string[];
  ejectionReason: string | null;
  url: string;
}

export interface GitHubPrStatus {
  ok: boolean;
  nodeId: string;
  ledgerStatus: string;
  repository: string;
  pr: GitHubPullRequest;
  checks: GitHubPrCheck[];
  requiredChecksOnly: boolean;
  branchPolicy: GitHubBranchPolicy;
  checkState: GitHubCheckState;
  glyph: string;
  behind: number;
  behindIgnoredByQueue: boolean;
  mergeable: boolean;
  readyToEnqueue: boolean;
  readyToMerge: boolean;
  queue: GitHubQueueStatus;
  evidenceUrl: string;
}

export async function githubPrStatus(
  root: string,
  nodeOrId: QdNode | string,
  options: { repo?: string; persist?: boolean } = {},
): Promise<GitHubPrStatus> {
  const node = typeof nodeOrId === "string" ? await getNode(root, nodeOrId) : nodeOrId;
  const config = await readConfig(root);
  const repository = githubRepository(config, options.repo);
  const pr = await resolveNodePullRequest(root, node, repository, options.persist !== false);
  const branchPolicy = await githubBranchPolicy(root, repository, pr.baseRefName);
  const queueObservation =
    config.mergeQueueMode === "off"
      ? disabledQueueObservation()
      : await githubMergeQueueObservation(root, repository, pr.number);
  const queueEnabled =
    config.mergeQueueMode !== "off" && (branchPolicy.mergeQueueEnabled || queueObservation.enabled);
  const [checks, behind] = await Promise.all([
    githubRequiredChecksForCommit(root, repository, pr.headRefOid, branchPolicy.requiredChecks),
    pullRequestBehindCount(root, repository, pr),
  ]);
  const checkState = aggregateGitHubChecks(checks);
  const mergeable =
    pr.state === "OPEN" &&
    !pr.isDraft &&
    pr.mergeable === "MERGEABLE" &&
    !["CONFLICTING", "DIRTY", "DRAFT"].includes(pr.mergeStateStatus);
  const queue = await mergeQueueStatus(
    root,
    node,
    pr,
    repository,
    branchPolicy,
    queueObservation,
    queueEnabled,
  );
  const readyToEnqueue = checkState === "pass" && mergeable && queueEnabled;
  return {
    ok: checkState === "pass" && queue.checkState !== "fail",
    nodeId: node.id,
    ledgerStatus: node.status,
    repository,
    pr,
    checks,
    requiredChecksOnly: branchPolicy.source !== "none",
    branchPolicy,
    checkState,
    glyph: monitorGlyph(checkState),
    behind,
    behindIgnoredByQueue: queueEnabled && behind > 0,
    mergeable,
    readyToEnqueue,
    readyToMerge: checkState === "pass" && mergeable && (queueEnabled || behind === 0),
    queue,
    evidenceUrl: `${pr.url}/checks`,
  };
}

export async function enqueueNodePullRequest(
  root: string,
  nodeOrId: QdNode | string,
  options: { repo?: string; settleSeconds?: number } = {},
): Promise<{ node: QdNode; status: GitHubPrStatus; observation: GitHubMergeQueueObservation }> {
  const node = typeof nodeOrId === "string" ? await getNode(root, nodeOrId) : nodeOrId;
  const status = await githubPrStatus(root, node, { repo: options.repo });
  if (!status.queue.enabled) {
    throw new Error(`GitHub merge queue is not enabled for ${status.pr.baseRefName}`);
  }
  if (status.queue.membership === "ejected") {
    throw new Error(
      `PR #${status.pr.number} was ejected from the merge queue: ${status.queue.ejectionReason ?? "unknown reason"}`,
    );
  }
  if (status.pr.state === "MERGED") {
    throw new Error(`PR #${status.pr.number} is already merged; run qd sync-prs to reconcile it`);
  }
  if (status.queue.membership === "queued" || status.queue.autoMergeEnabled) {
    const updated = await markMergeQueued(root, node.id, queueObservationInput(status));
    return {
      node: updated,
      status,
      observation: queueObservationFromStatus(status.queue),
    };
  }
  if (!status.readyToEnqueue) {
    throw new Error(
      `PR #${status.pr.number} is not ready to enqueue: checks=${status.checkState}, mergeability=${status.pr.mergeStateStatus}`,
    );
  }
  const observation = await enqueueGitHubPullRequest(root, {
    repository: status.repository,
    pullRequestUrl: status.pr.url,
    pullRequestNumber: status.pr.number,
    headOid: status.pr.headRefOid,
    settleSeconds: options.settleSeconds,
  });
  const updated = await markMergeQueued(root, node.id, {
    entryId: observation.entry?.id ?? null,
    enqueuedAt: observation.entry?.enqueuedAt ?? observation.autoMergeEnabledAt,
    mergeGroupSha: observation.entry?.headCommitOid ?? null,
    pullRequestUrl: status.pr.url,
  });
  return { node: updated, status, observation };
}

export async function linkNodePullRequest(
  root: string,
  nodeId: string,
  reference: string,
  options: { repo?: string } = {},
): Promise<QdNode> {
  const node = await getNode(root, nodeId);
  const repository = githubRepository(await readConfig(root), options.repo);
  const pr = await fetchPullRequest(root, reference, repository);
  assertPullRequestMatchesBranch(node, pr);
  return setNodePullRequest(root, node.id, { number: pr.number, url: pr.url });
}

export async function tryAutoLinkPullRequest(root: string, nodeId: string): Promise<QdNode> {
  const node = await getNode(root, nodeId);
  if (node.pr_url && node.pr_number) return node;
  const config = await readConfig(root);
  if (config.ciProvider !== "github" || !config.ciRepo || !node.branch) return node;
  try {
    const pr = await fetchPullRequest(root, node.branch, config.ciRepo);
    return setNodePullRequest(root, node.id, { number: pr.number, url: pr.url });
  } catch {
    return node;
  }
}

export async function mergeGitHubPullRequest(
  root: string,
  node: QdNode,
  strategy: "squash" | "merge" | "rebase",
  options: { repo?: string; timeoutSeconds?: number } = {},
): Promise<{
  pr: GitHubPullRequest;
  commitSha: string;
  repository: string;
  alreadyMerged: boolean;
}> {
  const repository = githubRepository(await readConfig(root), options.repo);
  let pr = await resolveNodePullRequest(root, node, repository, true);
  if (pr.state === "MERGED") {
    const commitSha = pr.mergeCommit?.oid;
    if (!commitSha) throw new Error(`Merged PR ${pr.url} has no merge commit SHA`);
    return { pr, commitSha, repository, alreadyMerged: true };
  }
  const args = prMergeArgs(pr.url, repository, strategy, pr.headRefOid);
  const merged = await captureCommand("gh", args, root);
  if (merged.code !== 0) throw new Error(`gh pr merge failed: ${merged.stderr || merged.stdout}`);
  const deadline = Date.now() + (options.timeoutSeconds ?? 300) * 1000;
  do {
    pr = await fetchPullRequest(root, pr.url, repository);
    const commitSha = pr.mergeCommit?.oid;
    if (pr.state === "MERGED" && commitSha) {
      return { pr, commitSha, repository, alreadyMerged: false };
    }
    await sleep(2000);
  } while (Date.now() <= deadline);
  throw new Error(
    `GitHub accepted the merge request but PR ${pr.url} did not reach merged state before timeout; rerun qd merge --via-pr to reconcile it`,
  );
}

export async function updateGitHubPullRequestBranch(
  root: string,
  status: GitHubPrStatus,
  rebase: boolean,
): Promise<void> {
  const result = await captureCommand(
    "gh",
    prUpdateBranchArgs(status.pr.url, status.repository, rebase),
    root,
  );
  if (result.code !== 0) {
    throw new Error(`gh pr update-branch failed: ${result.stderr || result.stdout}`);
  }
}

export function githubRepository(config: QdConfig, override?: string): string {
  const repository = (override ?? config.ciRepo).trim();
  if (!repository) throw new Error("GitHub PR commands require --repo or configured ci_repo");
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error("GitHub repository must use owner/name format");
  }
  return repository;
}

async function resolveNodePullRequest(
  root: string,
  node: QdNode,
  repository: string,
  persist: boolean,
): Promise<GitHubPullRequest> {
  const reference = node.pr_url ?? (node.pr_number ? String(node.pr_number) : node.branch);
  if (!reference) {
    throw new Error(
      `Node ${node.id} has no PR or branch. Use qd node set-pr ${node.id} <number-or-url>.`,
    );
  }
  const pr = await fetchPullRequest(root, reference, repository);
  assertPullRequestMatchesBranch(node, pr);
  if (persist && (node.pr_number !== pr.number || node.pr_url !== pr.url)) {
    await setNodePullRequest(root, node.id, { number: pr.number, url: pr.url });
  }
  return pr;
}

async function fetchPullRequest(
  root: string,
  reference: string,
  repository: string,
): Promise<GitHubPullRequest> {
  const result = await captureCommand("gh", prViewArgs(reference, repository), root);
  if (result.code !== 0) {
    throw new Error(`Unable to resolve GitHub PR ${reference}: ${result.stderr || result.stdout}`);
  }
  return parseGitHubPullRequest(result.stdout);
}

async function pullRequestBehindCount(
  root: string,
  repository: string,
  pr: GitHubPullRequest,
): Promise<number> {
  const result = await captureCommand(
    "gh",
    prCompareArgs(repository, pr.baseRefOid, pr.headRefOid),
    root,
  );
  if (result.code !== 0) throw new Error(`Unable to calculate PR drift: ${result.stderr}`);
  const behind = Number(result.stdout.trim());
  if (!Number.isInteger(behind) || behind < 0) {
    throw new Error(`GitHub compare returned invalid behind count: ${result.stdout.trim()}`);
  }
  return behind;
}

function assertPullRequestMatchesBranch(node: QdNode, pr: GitHubPullRequest): void {
  if (node.branch && node.branch !== pr.headRefName) {
    throw new Error(
      `PR ${pr.url} head branch ${pr.headRefName} does not match node branch ${node.branch}`,
    );
  }
}

async function mergeQueueStatus(
  root: string,
  node: QdNode,
  pr: GitHubPullRequest,
  repository: string,
  branchPolicy: GitHubBranchPolicy,
  observation: GitHubMergeQueueObservation,
  queueEnabled: boolean,
): Promise<GitHubQueueStatus> {
  const membership = queueMembership(node, pr, observation, queueEnabled);
  const mergeGroupSha = observation.entry?.headCommitOid ?? node.merge_group_sha ?? null;
  const checks = mergeGroupSha
    ? await githubRequiredChecksForCommit(
        root,
        repository,
        mergeGroupSha,
        branchPolicy.requiredChecks,
      )
    : [];
  const checkState = aggregateGitHubChecks(checks);
  const missingRequiredChecks = checks
    .filter((check) => check.source === "missing")
    .map((check) => check.name);
  const failingChecks = checks
    .filter((check) => check.bucket === "fail" || check.bucket === "cancel")
    .map((check) => check.name);
  const ejectionReason =
    membership === "ejected"
      ? (node.merge_queue_ejection_reason ??
        (failingChecks.length > 0
          ? `merge-group checks failed: ${failingChecks.join(", ")}`
          : missingRequiredChecks.length > 0
            ? `required merge-group checks missing: ${missingRequiredChecks.join(", ")}`
            : pr.state === "CLOSED"
              ? "pull request closed before merge"
              : "GitHub removed the pull request from the merge queue"))
      : null;
  return {
    enabled: queueEnabled,
    membership,
    position: observation.entry?.position ?? null,
    entryId: observation.entry?.id ?? node.merge_queue_entry_id ?? null,
    entryState: observation.entry?.state ?? null,
    enqueuedAt: observation.entry?.enqueuedAt ?? node.merge_queue_enqueued_at ?? null,
    estimatedTimeToMerge: observation.entry?.estimatedTimeToMerge ?? null,
    autoMergeEnabled: observation.autoMergeEnabled,
    mergeGroupSha,
    checks,
    checkState,
    missingRequiredChecks,
    ejectionReason,
    url: observation.entry?.queueUrl ?? "",
  };
}

function queueMembership(
  node: QdNode,
  pr: GitHubPullRequest,
  observation: GitHubMergeQueueObservation,
  queueEnabled: boolean,
): GitHubQueueMembership {
  if (pr.state === "MERGED") return "merged";
  if (!queueEnabled) return node.status === "queued" ? "ejected" : "disabled";
  if (observation.inQueue || observation.entry) return "queued";
  if (node.status === "queued" && !observation.autoMergeEnabled) return "ejected";
  if (node.merge_queue_ejected_at && node.status === "fixing") return "ejected";
  return "not-enqueued";
}

function disabledQueueObservation(): GitHubMergeQueueObservation {
  return {
    enabled: false,
    inQueue: false,
    autoMergeEnabled: false,
    autoMergeEnabledAt: null,
    entry: null,
  };
}

function queueObservationInput(status: GitHubPrStatus) {
  return {
    entryId: status.queue.entryId,
    enqueuedAt: status.queue.enqueuedAt,
    mergeGroupSha: status.queue.mergeGroupSha,
    pullRequestUrl: status.pr.url,
  };
}

function queueObservationFromStatus(queue: GitHubQueueStatus): GitHubMergeQueueObservation {
  return {
    enabled: queue.enabled,
    inQueue: queue.membership === "queued",
    autoMergeEnabled: queue.autoMergeEnabled,
    autoMergeEnabledAt: queue.enqueuedAt,
    entry:
      queue.entryId && queue.enqueuedAt
        ? {
            id: queue.entryId,
            position: queue.position ?? 0,
            state: queue.entryState ?? "UNKNOWN",
            enqueuedAt: queue.enqueuedAt,
            estimatedTimeToMerge: queue.estimatedTimeToMerge,
            headCommitOid: queue.mergeGroupSha,
            baseCommitOid: null,
            queueUrl: queue.url,
          }
        : null,
  };
}
