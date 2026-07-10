import { captureCommand, sleep } from "./shell.js";

export type GitHubMergeQueueEntryState =
  | "QUEUED"
  | "AWAITING_CHECKS"
  | "MERGEABLE"
  | "UNMERGEABLE"
  | "LOCKED"
  | "UNKNOWN";

export interface GitHubMergeQueueEntry {
  id: string;
  position: number;
  state: GitHubMergeQueueEntryState;
  enqueuedAt: string;
  estimatedTimeToMerge: number | null;
  headCommitOid: string | null;
  baseCommitOid: string | null;
  queueUrl: string;
}

export interface GitHubMergeQueueObservation {
  enabled: boolean;
  inQueue: boolean;
  autoMergeEnabled: boolean;
  autoMergeEnabledAt: string | null;
  entry: GitHubMergeQueueEntry | null;
}

const MERGE_QUEUE_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      isInMergeQueue
      isMergeQueueEnabled
      autoMergeRequest{enabledAt mergeMethod}
      mergeQueueEntry{
        id
        position
        state
        enqueuedAt
        estimatedTimeToMerge
        headCommit{oid}
        baseCommit{oid}
        mergeQueue{url}
      }
    }
  }
}`;

export async function githubMergeQueueObservation(
  root: string,
  repository: string,
  pullRequestNumber: number,
): Promise<GitHubMergeQueueObservation> {
  const [owner, name] = repository.split("/", 2);
  if (!owner || !name) throw new Error("GitHub repository must use owner/name format");
  const result = await captureCommand(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      `query=${MERGE_QUEUE_QUERY}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      "-F",
      `number=${pullRequestNumber}`,
    ],
    root,
  );
  if (result.code !== 0) {
    throw new Error(`Unable to read GitHub merge queue: ${result.stderr || result.stdout}`);
  }
  return parseGitHubMergeQueueObservation(result.stdout);
}

export async function enqueueGitHubPullRequest(
  root: string,
  input: {
    repository: string;
    pullRequestUrl: string;
    headOid: string;
    pullRequestNumber: number;
    settleSeconds?: number;
  },
): Promise<GitHubMergeQueueObservation> {
  const result = await captureCommand(
    "gh",
    [
      "pr",
      "merge",
      input.pullRequestUrl,
      "--repo",
      input.repository,
      "--match-head-commit",
      input.headOid,
    ],
    root,
  );
  if (result.code !== 0) {
    throw new Error(`gh pr merge queue admission failed: ${result.stderr || result.stdout}`);
  }
  const deadline = Date.now() + (input.settleSeconds ?? 10) * 1000;
  let observation = await githubMergeQueueObservation(
    root,
    input.repository,
    input.pullRequestNumber,
  );
  while (!observation.inQueue && !observation.autoMergeEnabled && Date.now() < deadline) {
    await sleep(1000);
    observation = await githubMergeQueueObservation(
      root,
      input.repository,
      input.pullRequestNumber,
    );
  }
  return observation;
}

export function parseGitHubMergeQueueObservation(stdout: string): GitHubMergeQueueObservation {
  const root = asRecord(JSON.parse(stdout), "GitHub GraphQL response");
  const data = asRecord(root.data, "GitHub GraphQL data");
  const repository = asRecord(data.repository, "GitHub GraphQL repository");
  const pullRequest = asRecord(repository.pullRequest, "GitHub GraphQL pull request");
  const rawEntry = pullRequest.mergeQueueEntry;
  return {
    enabled: pullRequest.isMergeQueueEnabled === true,
    inQueue: pullRequest.isInMergeQueue === true,
    autoMergeEnabled: Boolean(pullRequest.autoMergeRequest),
    autoMergeEnabledAt: autoMergeEnabledAt(pullRequest.autoMergeRequest),
    entry: rawEntry ? parseEntry(rawEntry) : null,
  };
}

function parseEntry(value: unknown): GitHubMergeQueueEntry {
  const entry = asRecord(value, "GitHub merge queue entry");
  const headCommit = optionalRecord(entry.headCommit);
  const baseCommit = optionalRecord(entry.baseCommit);
  const mergeQueue = optionalRecord(entry.mergeQueue);
  const position = entry.position;
  if (typeof position !== "number" || !Number.isInteger(position) || position < 0) {
    throw new Error("GitHub merge queue entry position must be a non-negative integer");
  }
  return {
    id: requiredString(entry.id, "merge queue entry id"),
    position,
    state: mergeQueueState(entry.state),
    enqueuedAt: requiredString(entry.enqueuedAt, "merge queue enqueuedAt"),
    estimatedTimeToMerge:
      typeof entry.estimatedTimeToMerge === "number" ? entry.estimatedTimeToMerge : null,
    headCommitOid: typeof headCommit?.oid === "string" ? headCommit.oid : null,
    baseCommitOid: typeof baseCommit?.oid === "string" ? baseCommit.oid : null,
    queueUrl: typeof mergeQueue?.url === "string" ? mergeQueue.url : "",
  };
}

function autoMergeEnabledAt(value: unknown): string | null {
  const request = optionalRecord(value);
  return typeof request?.enabledAt === "string" ? request.enabledAt : null;
}

function mergeQueueState(value: unknown): GitHubMergeQueueEntryState {
  return ["QUEUED", "AWAITING_CHECKS", "MERGEABLE", "UNMERGEABLE", "LOCKED"].includes(String(value))
    ? (value as GitHubMergeQueueEntryState)
    : "UNKNOWN";
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object`);
  return record;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value;
}
