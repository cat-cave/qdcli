import {
  getNode,
  listNodes,
  listWaveMemberships,
  listWaves,
  type QdNode,
} from "@cat-cave/qdcli-core";
import { numberOpt, output, stringOpt } from "./args.js";
import { githubCiStatusCommand, githubMergeQueue, syncPullRequests } from "./github-ci-commands.js";
import { enqueueNodePullRequest, type GitHubPrStatus } from "./github-pr.js";
import { sleep } from "./shell.js";

export async function queueCommand(
  root: string,
  action: string | undefined,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "status" || !action) {
    return githubCiStatusCommand(root, nodeId, nodeId ? options : { ...options, all: true }, json);
  }
  if (action === "enqueue") return enqueueQueueCommand(root, nodeId, options, json);
  if (action === "sync") {
    const results = await syncPullRequests(root, options, nodeId);
    const ok = results.every((result) => result.action !== "error");
    output({ ok, nodes: results }, json);
    if (!ok) process.exitCode = 1;
    return;
  }
  if (action === "watch" || action === "drain") {
    return drainQueueCommand(root, nodeId, options, json);
  }
  if (action === "bisect" || action === "cohort") {
    return queueBisectionCommand(root, nodeId, options, json);
  }
  throw new Error(`Unknown queue action: ${action}`);
}

async function enqueueQueueCommand(
  root: string,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (nodeId) {
    const result = await enqueueNodePullRequest(root, nodeId, {
      repo: stringOpt(options.repo),
      settleSeconds: numberOpt(options.settle),
    });
    output({ ok: true, action: "enqueued", ...result }, json);
    return;
  }
  if (!options.all && !options["all-ready"]) {
    throw new Error("qd queue enqueue requires a node id or --all-ready");
  }
  const statuses = await githubMergeQueue(root, options);
  const waveId = stringOpt(options.wave);
  const eligible = waveId ? await queueStatusesForWave(root, waveId, statuses) : statuses;
  const limit = numberOpt(options.limit) ?? eligible.length;
  const concurrency = numberOpt(options.concurrency) ?? 4;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  const selected = eligible.slice(0, limit);
  const results = await mapConcurrent(selected, concurrency, async (status) => {
    try {
      const result = await enqueueNodePullRequest(root, status.nodeId, {
        repo: stringOpt(options.repo),
        settleSeconds: numberOpt(options.settle),
      });
      return { nodeId: status.nodeId, action: "enqueued", ...result };
    } catch (error) {
      return {
        nodeId: status.nodeId,
        action: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const ok = results.every((result) => result.action !== "error");
  output(
    {
      ok,
      selected: selected.length,
      available: eligible.length,
      wave: waveId ?? null,
      concurrency,
      nodes: results,
    },
    json,
  );
  if (!ok) process.exitCode = 1;
}

async function queueStatusesForWave(
  root: string,
  waveId: string,
  statuses: GitHubPrStatus[],
): Promise<GitHubPrStatus[]> {
  const waves = await listWaves(root);
  if (!waves.some((wave) => wave.id === waveId)) throw new Error(`Wave not found: ${waveId}`);
  const nodeIds = new Set(
    (await listWaveMemberships(root))
      .filter((membership) => membership.wave_id === waveId && membership.node_id)
      .map((membership) => membership.node_id),
  );
  return statuses.filter((status) => nodeIds.has(status.nodeId));
}

async function drainQueueCommand(
  root: string,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const intervalSeconds = numberOpt(options.interval) ?? 10;
  const timeoutSeconds = numberOpt(options.timeout) ?? 3600;
  if (intervalSeconds < 1) throw new Error("--interval must be at least 1 second");
  if (timeoutSeconds < 1) throw new Error("--timeout must be at least 1 second");
  const deadline = Date.now() + timeoutSeconds * 1000;
  const events: Array<Record<string, unknown>> = [];
  let trackedNodeIds: Set<string> | undefined = nodeId ? new Set([nodeId]) : undefined;
  while (Date.now() <= deadline) {
    const results = await syncPullRequests(root, options, nodeId);
    events.push(...results);
    const graphNodes = nodeId ? [await getNode(root, nodeId)] : await listNodes(root);
    trackedNodeIds ??= new Set(
      graphNodes.filter((node) => node.status === "queued").map((node) => node.id),
    );
    const tracked = trackedNodeIds;
    const nodes = graphNodes.filter((node) => tracked.has(node.id));
    const active = nodes.filter((node) => node.status === "queued");
    if (!json) {
      console.log(
        active.length === 0
          ? "✓ merge queue drained"
          : `⧗ ${active.length} queued: ${active.map((node) => node.id).join(", ")}`,
      );
    }
    if (active.length === 0) {
      const ok = nodes.every((node) => node.status === "done");
      output({ ok, timedOut: false, nodes, events: latestEvents(events) }, json);
      if (!ok) process.exitCode = 1;
      return;
    }
    await sleep(intervalSeconds * 1000);
  }
  const graphNodes = nodeId ? [await getNode(root, nodeId)] : await listNodes(root);
  const nodes = graphNodes.filter((node) => trackedNodeIds?.has(node.id));
  output(
    {
      ok: false,
      timedOut: true,
      nodes: nodes.filter((node) => node.status === "queued"),
      events: latestEvents(events),
    },
    json,
  );
  process.exitCode = 8;
}

async function queueBisectionCommand(
  root: string,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const requestedSha = stringOpt(options["merge-group"]);
  const sourceNode = nodeId ? await getNode(root, nodeId) : null;
  const mergeGroupSha = requestedSha ?? sourceNode?.merge_group_sha;
  if (!mergeGroupSha) {
    throw new Error(
      "qd queue bisect requires a node with merge-group evidence or --merge-group <sha>",
    );
  }
  const cohort = (await listNodes(root))
    .filter((node) => node.merge_group_sha === mergeGroupSha)
    .sort(
      (left, right) =>
        (left.pr_number ?? Number.MAX_SAFE_INTEGER) -
          (right.pr_number ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id),
    );
  if (cohort.length === 0) throw new Error(`No qd nodes reference merge group ${mergeGroupSha}`);
  output(
    {
      ok: true,
      mergeGroupSha,
      candidates: cohort.map(queueCandidate),
      rounds: bisectionLevels(cohort),
      guidance:
        "Repair or re-enqueue one proposed batch at a time; a passing half excludes it and a failing half becomes the next candidate set.",
    },
    json,
  );
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = Array.from<R>({ length: values.length });
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        const value = values[index];
        if (value !== undefined) results[index] = await worker(value);
      }
    }),
  );
  return results;
}

function latestEvents(events: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const latest = new Map<string, Record<string, unknown>>();
  for (const event of events) {
    if (typeof event.nodeId === "string") latest.set(event.nodeId, event);
  }
  return [...latest.values()];
}

function queueCandidate(node: QdNode) {
  return {
    id: node.id,
    pr: node.pr_number ?? null,
    points: node.estimate_points,
    status: node.status,
    ejectionReason: node.merge_queue_ejection_reason ?? null,
  };
}

function bisectionLevels(nodes: QdNode[]) {
  const levels: Array<Array<{ ids: string[]; prs: Array<number | null>; points: number }>> = [];
  let groups = [nodes];
  while (groups.some((group) => group.length > 1)) {
    groups = groups.flatMap((group) => splitByPoints(group));
    levels.push(
      groups.map((group) => ({
        ids: group.map((node) => node.id),
        prs: group.map((node) => node.pr_number ?? null),
        points: group.reduce((total, node) => total + node.estimate_points, 0),
      })),
    );
  }
  return levels;
}

function splitByPoints(nodes: QdNode[]): QdNode[][] {
  if (nodes.length < 2) return [nodes];
  const total = nodes.reduce((sum, node) => sum + node.estimate_points, 0);
  let running = 0;
  let split = 1;
  for (let index = 1; index < nodes.length; index += 1) {
    running += nodes[index - 1]?.estimate_points ?? 0;
    split = index;
    if (running >= total / 2) break;
  }
  return [nodes.slice(0, split), nodes.slice(split)].filter((group) => group.length > 0);
}
