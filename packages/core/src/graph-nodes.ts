import { all, applyMigrations, get, initProject, openDatabase, run } from "./db.js";
import {
  assertNodeQuality,
  assertNodeRegistryValues,
  ensureNodeMetadataRegistered,
  hydrateNode,
  insertEdge,
  insertNode,
  nodeExists,
  nodeFromInput,
  slugify,
  uniqueNodeId,
  withoutUndefined,
  type NodeRow,
} from "./graph-internal.js";
import type { AddNodeInput, BulkEdgeInput, ListRunFilters } from "./graph-types.js";
import type {
  EdgeType,
  FindingStatus,
  NodeStatus,
  Priority,
  QdEdge,
  QdFinding,
  QdNode,
  QdRun,
} from "./types.js";

export async function setupProject(root = process.cwd()): Promise<void> {
  await initProject(root);
}

export async function addNode(root: string, input: AddNodeInput): Promise<QdNode> {
  const db = await openDatabase(root);
  await applyMigrations(db);
  const now = new Date().toISOString();
  const id = input.id ?? (await uniqueNodeId(db, slugify(input.title)));
  const node = nodeFromInput(input, id, now);
  assertNodeQuality(node);
  await assertNodeRegistryValues(db, node);
  await insertNode(db, node);
  return node;
}

export async function addNodesBulk(
  root: string,
  input: { nodes: AddNodeInput[]; edges?: BulkEdgeInput[] },
): Promise<{ nodes: QdNode[]; edges: QdEdge[] }> {
  const db = await openDatabase(root);
  await applyMigrations(db);
  await run(db, "begin immediate");
  try {
    const now = new Date().toISOString();
    const reserved = new Set<string>();
    const nodes: QdNode[] = [];
    for (const nodeInput of input.nodes) {
      const id = nodeInput.id ?? (await uniqueNodeId(db, slugify(nodeInput.title), reserved));
      if (reserved.has(id)) throw new Error(`duplicate node id in bulk add: ${id}`);
      reserved.add(id);
      const node = nodeFromInput(nodeInput, id, now);
      assertNodeQuality(node);
      nodes.push(node);
    }
    await ensureNodeMetadataRegistered(db, nodes, now);
    for (const node of nodes) await insertNode(db, node);

    const edges: QdEdge[] = [];
    const nodeIds = new Set(nodes.map((node) => node.id));
    for (const edgeInput of input.edges ?? []) {
      const type = edgeInput.type ?? "requires";
      if (!nodeIds.has(edgeInput.from) && !(await nodeExists(db, edgeInput.from))) {
        throw new Error(`edge references missing from node: ${edgeInput.from}`);
      }
      if (!nodeIds.has(edgeInput.to) && !(await nodeExists(db, edgeInput.to))) {
        throw new Error(`edge references missing to node: ${edgeInput.to}`);
      }
      edges.push(await insertEdge(db, edgeInput.from, edgeInput.to, type, now));
    }
    await run(db, "commit");
    return { nodes, edges };
  } catch (error) {
    await run(db, "rollback");
    throw error;
  }
}

export async function updateNode(
  root: string,
  id: string,
  updates: Partial<
    Pick<
      QdNode,
      | "title"
      | "kind"
      | "milestone"
      | "group_name"
      | "projects"
      | "status"
      | "owner"
      | "branch"
      | "priority"
      | "risk"
      | "spec"
      | "acceptance"
      | "validation"
      | "verification"
      | "audit_focus"
      | "context"
      | "status_reason"
      | "check_command"
      | "ci_command"
      | "blocked_by"
      | "blocked_reason"
      | "blocked_owner"
    >
  > & {
    estimatePoints?: number;
  },
): Promise<QdNode> {
  const db = await openDatabase(root);
  const current = await getNode(root, id);
  const next = {
    ...current,
    ...withoutUndefined(updates),
    estimate_points: updates.estimatePoints ?? current.estimate_points,
    updated_at: new Date().toISOString(),
  };
  assertNodeQuality(next);
  await assertNodeRegistryValues(db, next);
  await run(
    db,
    `update nodes set
      title = ?, kind = ?, milestone = ?, group_name = ?, projects_json = ?, status = ?, priority = ?, estimate_points = ?, risk = ?,
      owner = ?, branch = ?, spec = ?, acceptance = ?, validation = ?, verification_json = ?, audit_focus_json = ?, context = ?, status_reason = ?,
      check_command = ?, ci_command = ?, blocked_by = ?, blocked_reason = ?, blocked_owner = ?, updated_at = ?
    where id = ?`,
    [
      next.title,
      next.kind,
      next.milestone,
      next.group_name,
      JSON.stringify(next.projects),
      next.status,
      next.priority,
      next.estimate_points,
      next.risk,
      next.owner,
      next.branch,
      next.spec,
      next.acceptance,
      next.validation,
      JSON.stringify(next.verification),
      JSON.stringify(next.audit_focus),
      next.context,
      next.status_reason,
      next.check_command,
      next.ci_command,
      next.blocked_by,
      next.blocked_reason,
      next.blocked_owner,
      next.updated_at,
      id,
    ],
  );
  return getNode(root, id);
}

export async function listNodes(root: string): Promise<QdNode[]> {
  const db = await openDatabase(root);
  const rows = await all<NodeRow>(
    db,
    `select * from nodes order by
      case priority when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 else 3 end,
      created_at asc`,
  );
  return rows.map(hydrateNode);
}

export async function getNode(root: string, id: string): Promise<QdNode> {
  const db = await openDatabase(root);
  const row = await get<NodeRow>(db, "select * from nodes where id = ?", [id]);
  if (!row) throw new Error(`Node not found: ${id}`);
  return hydrateNode(row);
}

export async function listFindings(
  root: string,
  filters: {
    nodeId?: string | null;
    status?: FindingStatus | null;
    severities?: Priority[];
  } = {},
): Promise<QdFinding[]> {
  const db = await openDatabase(root);
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.nodeId) {
    where.push("node_id = ?");
    params.push(filters.nodeId);
  }
  if (filters.status) {
    where.push("status = ?");
    params.push(filters.status);
  }
  if (filters.severities && filters.severities.length > 0) {
    where.push(`severity in (${filters.severities.map(() => "?").join(", ")})`);
    params.push(...filters.severities);
  }
  const clause = where.length > 0 ? ` where ${where.join(" and ")}` : "";
  return all<QdFinding>(
    db,
    `select * from findings${clause} order by
      case severity when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 else 3 end,
      created_at asc`,
    params,
  );
}

export async function listRuns(
  root: string,
  filters: string | null | ListRunFilters = {},
): Promise<QdRun[]> {
  const db = await openDatabase(root);
  const resolved = typeof filters === "string" || filters === null ? { nodeId: filters } : filters;
  const where: string[] = [];
  const params: unknown[] = [];
  if (resolved.nodeId) {
    where.push("node_id = ?");
    params.push(resolved.nodeId);
  }
  if (resolved.status) {
    where.push("status = ?");
    params.push(resolved.status);
  }
  if (resolved.kind) {
    where.push("kind = ?");
    params.push(resolved.kind);
  }
  const clause = where.length > 0 ? ` where ${where.join(" and ")}` : "";
  return all<QdRun>(db, `select * from runs${clause} order by started_at asc`, params);
}

export async function getRun(root: string, runId: string): Promise<QdRun> {
  const db = await openDatabase(root);
  const runRow = await get<QdRun>(db, "select * from runs where id = ?", [runId]);
  if (!runRow) throw new Error(`Run not found: ${runId}`);
  return runRow;
}

export async function finishRun(
  root: string,
  runId: string,
  input: {
    status: string;
    summary?: string | null;
    rationale?: string | null;
    supersededBy?: string | null;
    reportPath?: string | null;
    exitCode?: number | null;
  },
): Promise<QdRun> {
  const db = await openDatabase(root);
  await run(
    db,
    `update runs set status = ?, finished_at = ?, summary = coalesce(?, summary), rationale = coalesce(?, rationale),
      superseded_by = coalesce(?, superseded_by), report_path = coalesce(?, report_path), exit_code = coalesce(?, exit_code)
    where id = ?`,
    [
      input.status,
      new Date().toISOString(),
      input.summary ?? null,
      input.rationale ?? null,
      input.supersededBy ?? null,
      input.reportPath ?? null,
      input.exitCode ?? null,
      runId,
    ],
  );
  return getRun(root, runId);
}

export async function cancelNode(root: string, id: string): Promise<QdNode> {
  await setNodeStatus(root, id, "cancelled");
  return getNode(root, id);
}

export async function addEdge(
  root: string,
  fromNode: string,
  toNode: string,
  type: EdgeType = "requires",
): Promise<QdEdge> {
  const db = await openDatabase(root);
  return insertEdge(db, fromNode, toNode, type, new Date().toISOString());
}

export async function removeEdge(
  root: string,
  fromNode: string,
  toNode: string,
  type: EdgeType = "requires",
): Promise<void> {
  const db = await openDatabase(root);
  await run(db, "delete from edges where from_node = ? and to_node = ? and type = ?", [
    fromNode,
    toNode,
    type,
  ]);
}

export async function listEdges(root: string): Promise<QdEdge[]> {
  const db = await openDatabase(root);
  return all<QdEdge>(db, "select * from edges order by created_at asc");
}

export async function readyNodes(root: string): Promise<QdNode[]> {
  const db = await openDatabase(root);
  const rows = await all<NodeRow>(
    db,
    `select n.*
    from nodes n
    where n.status in ('ready', 'regressed')
      and not exists (
        select 1
        from edges e
        join nodes dep on dep.id = e.from_node
        where e.to_node = n.id
          and e.type = 'requires'
          and dep.status <> 'done'
      )
    order by
      case n.priority when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 else 3 end,
      n.estimate_points asc,
      n.created_at asc`,
  );
  return rows.map(hydrateNode);
}

export async function claimNode(
  root: string,
  input: { id?: string; agent: string; branch?: string | null },
): Promise<QdNode> {
  const ready = await readyNodes(root);
  const node = input.id ? ready.find((candidate) => candidate.id === input.id) : ready[0];
  if (!node) {
    throw new Error(
      input.id ? `Node is not ready or does not exist: ${input.id}` : "No ready nodes",
    );
  }
  const now = new Date().toISOString();
  const branch = input.branch ?? `qd/${node.id}`;
  const db = await openDatabase(root);
  await run(
    db,
    "update nodes set status = 'claimed', owner = ?, branch = ?, claimed_at = ?, updated_at = ? where id = ?",
    [input.agent, branch, now, now, node.id],
  );
  return getNode(root, node.id);
}

export async function setNodeStatus(
  root: string,
  nodeId: string,
  status: NodeStatus,
): Promise<void> {
  const db = await openDatabase(root);
  await run(db, "update nodes set status = ?, updated_at = ? where id = ?", [
    status,
    new Date().toISOString(),
    nodeId,
  ]);
}
