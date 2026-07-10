import { randomUUID } from "node:crypto";
import { openDatabase, run } from "./db.js";
import { gateNode } from "./graph-audit.js";
import { getNode } from "./graph-nodes.js";
import { policyReport } from "./graph-policy.js";
import type { QdNode } from "./types.js";

export interface MergeQueueObservationInput {
  entryId?: string | null;
  enqueuedAt?: string | null;
  mergeGroupSha?: string | null;
  pullRequestUrl?: string | null;
}

export async function markMergeQueued(
  root: string,
  nodeId: string,
  input: MergeQueueObservationInput = {},
): Promise<QdNode> {
  const node = await getNode(root, nodeId);
  if (node.status === "queued") {
    return updateMergeQueueObservation(root, nodeId, input);
  }
  if (node.status !== "mergeable") {
    throw new Error(`Cannot enqueue node with status ${node.status}; expected mergeable`);
  }
  const gate = await gateNode(root, nodeId);
  if (!gate.ok) {
    throw new Error(
      `Cannot enqueue while qd gate is blocked: ${gate.explanations.map((item) => item.message).join("; ")}`,
    );
  }
  const policy = await policyReport(root, nodeId, "merge");
  if (!policy.ok) throw new Error(policy.violations.map((item) => item.message).join("; "));
  const db = await openDatabase(root);
  const now = new Date().toISOString();
  const enqueuedAt = input.enqueuedAt ?? now;
  await run(
    db,
    `insert into runs (
      id, node_id, kind, status, provider, git_sha, external_id, url,
      started_at, finished_at, summary
    ) values (?, ?, 'merge', 'queued', 'github', ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      nodeId,
      input.mergeGroupSha ?? null,
      input.entryId ?? null,
      input.pullRequestUrl ?? node.pr_url ?? null,
      now,
      now,
      input.entryId
        ? `Pull request entered the GitHub merge queue as ${input.entryId}`
        : "GitHub accepted the merge-queue request; waiting for queue membership",
    ],
  );
  await run(
    db,
    `update nodes set
      status = 'queued', merge_queue_entry_id = ?, merge_queue_enqueued_at = ?, merge_group_sha = ?,
      merge_queue_ejected_at = null, merge_queue_ejection_reason = null, updated_at = ?
    where id = ?`,
    [input.entryId ?? null, enqueuedAt, input.mergeGroupSha ?? null, now, nodeId],
  );
  return getNode(root, nodeId);
}

export async function updateMergeQueueObservation(
  root: string,
  nodeId: string,
  input: MergeQueueObservationInput,
): Promise<QdNode> {
  const node = await getNode(root, nodeId);
  if (node.status !== "queued") {
    throw new Error(`Cannot update queue observation for node with status ${node.status}`);
  }
  const db = await openDatabase(root);
  const now = new Date().toISOString();
  await run(
    db,
    `update nodes set
      merge_queue_entry_id = ?, merge_queue_enqueued_at = ?, merge_group_sha = ?, updated_at = ?
    where id = ?`,
    [
      input.entryId ?? node.merge_queue_entry_id ?? null,
      input.enqueuedAt ?? node.merge_queue_enqueued_at ?? null,
      input.mergeGroupSha ?? node.merge_group_sha ?? null,
      now,
      nodeId,
    ],
  );
  return getNode(root, nodeId);
}

export async function markMergeQueueEjected(
  root: string,
  nodeId: string,
  input: { reason: string; mergeGroupSha?: string | null; pullRequestUrl?: string | null },
): Promise<QdNode> {
  const node = await getNode(root, nodeId);
  if (node.status !== "queued") {
    throw new Error(`Cannot eject node with status ${node.status}; expected queued`);
  }
  if (!input.reason.trim()) throw new Error("merge queue ejection reason is required");
  const db = await openDatabase(root);
  const now = new Date().toISOString();
  const mergeGroupSha = input.mergeGroupSha ?? node.merge_group_sha ?? null;
  await run(
    db,
    `insert into runs (
      id, node_id, kind, status, provider, git_sha, external_id, url,
      started_at, finished_at, summary
    ) values (?, ?, 'merge', 'ejected', 'github', ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      nodeId,
      mergeGroupSha,
      node.merge_queue_entry_id ?? null,
      input.pullRequestUrl ?? node.pr_url ?? null,
      now,
      now,
      input.reason,
    ],
  );
  await run(
    db,
    `update nodes set
      status = 'fixing', merge_queue_entry_id = null, merge_queue_ejected_at = ?,
      merge_queue_ejection_reason = ?, merge_group_sha = ?, updated_at = ?
    where id = ?`,
    [now, input.reason, mergeGroupSha, now, nodeId],
  );
  return getNode(root, nodeId);
}
