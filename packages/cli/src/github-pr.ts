import {
  getNode,
  readConfig,
  setNodePullRequest,
  type QdConfig,
  type QdNode,
} from "@cat-cave/qdcli-core";
import { captureCommand, sleep } from "./shell.js";
import {
  aggregateGitHubChecks,
  monitorGlyph,
  parseGitHubPrChecks,
  parseGitHubPullRequest,
  prChecksArgs,
  prCompareArgs,
  prMergeArgs,
  prUpdateBranchArgs,
  prViewArgs,
  type GitHubCheckState,
  type GitHubPrCheck,
  type GitHubPullRequest,
} from "./github-pr-model.js";

export interface GitHubPrStatus {
  ok: boolean;
  nodeId: string;
  ledgerStatus: string;
  repository: string;
  pr: GitHubPullRequest;
  checks: GitHubPrCheck[];
  requiredChecksOnly: boolean;
  checkState: GitHubCheckState;
  glyph: string;
  behind: number;
  mergeable: boolean;
  readyToMerge: boolean;
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
  const checkResult = await requiredOrAllChecks(root, pr.url, repository);
  const checkState = aggregateGitHubChecks(checkResult.checks);
  const behind = await pullRequestBehindCount(root, repository, pr);
  const mergeable =
    pr.state === "OPEN" &&
    !pr.isDraft &&
    pr.mergeable === "MERGEABLE" &&
    !["CONFLICTING", "DIRTY", "DRAFT"].includes(pr.mergeStateStatus);
  return {
    ok: checkState === "pass",
    nodeId: node.id,
    ledgerStatus: node.status,
    repository,
    pr,
    checks: checkResult.checks,
    requiredChecksOnly: checkResult.requiredOnly,
    checkState,
    glyph: monitorGlyph(checkState),
    behind,
    mergeable,
    readyToMerge: checkState === "pass" && mergeable && behind === 0,
    evidenceUrl: `${pr.url}/checks`,
  };
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

async function requiredOrAllChecks(
  root: string,
  reference: string,
  repository: string,
): Promise<{ checks: GitHubPrCheck[]; requiredOnly: boolean }> {
  const required = await captureCommand("gh", prChecksArgs(reference, repository, true), root);
  const requiredChecks = parseChecksWhenAvailable(required.stdout);
  if (requiredChecks.length > 0) return { checks: requiredChecks, requiredOnly: true };
  const all = await captureCommand("gh", prChecksArgs(reference, repository, false), root);
  if (![0, 8].includes(all.code) && !all.stdout.trim()) {
    throw new Error(`gh pr checks failed: ${all.stderr}`);
  }
  return { checks: parseGitHubPrChecks(all.stdout), requiredOnly: false };
}

function parseChecksWhenAvailable(stdout: string): GitHubPrCheck[] {
  if (!stdout.trim()) return [];
  return parseGitHubPrChecks(stdout);
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
