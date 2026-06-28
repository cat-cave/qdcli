import { all, get, run, type Database } from "./db.js";
import type { AddNodeInput } from "./graph-types.js";
import type { EdgeType, QdEdge, QdNode, VerificationEntry } from "./types.js";

export interface NodeRow extends Omit<QdNode, "projects" | "verification" | "audit_focus"> {
  projects_json: string;
  verification_json: string;
  audit_focus_json: string;
}

export async function uniqueNodeId(
  db: Database,
  base: string,
  reserved: Set<string> = new Set(),
): Promise<string> {
  let candidate = base || "node";
  let suffix = 2;
  while (
    reserved.has(candidate) ||
    (await get<NodeRow>(db, "select * from nodes where id = ?", [candidate]))
  ) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export async function assertNodeExists(db: Database, id: string): Promise<void> {
  const node = await get<NodeRow>(db, "select * from nodes where id = ?", [id]);
  if (!node) throw new Error(`Node not found: ${id}`);
}

export async function nodeExists(db: Database, id: string): Promise<boolean> {
  return Boolean(await get<NodeRow>(db, "select * from nodes where id = ?", [id]));
}

export function nodeFromInput(input: AddNodeInput, id: string, now: string): QdNode {
  return {
    id,
    title: input.title,
    kind: input.kind ?? "feature",
    milestone: input.milestone ?? null,
    group_name: input.groupName ?? null,
    projects: input.projects ?? [],
    status: input.status ?? "ready",
    priority: input.priority ?? "P2",
    estimate_points: input.estimatePoints ?? 1,
    risk: input.risk ?? "medium",
    owner: null,
    branch: null,
    spec: input.spec,
    acceptance: input.acceptance,
    validation: input.validation ?? null,
    verification: input.verification ?? [],
    audit_focus: input.auditFocus ?? [],
    context: input.context ?? null,
    status_reason: input.statusReason ?? null,
    check_command: input.checkCommand ?? null,
    ci_command: input.ciCommand ?? null,
    blocked_by: input.blockedBy ?? null,
    blocked_reason: input.blockedReason ?? null,
    blocked_owner: input.blockedOwner ?? null,
    created_at: now,
    updated_at: now,
    claimed_at: null,
    done_at: null,
  };
}

export async function insertNode(db: Database, node: QdNode): Promise<void> {
  await run(
    db,
    `insert into nodes (
      id, title, kind, milestone, group_name, projects_json, status, priority, estimate_points, risk, owner, branch,
      spec, acceptance, validation, verification_json, audit_focus_json, context, status_reason, check_command, ci_command,
      blocked_by, blocked_reason, blocked_owner, created_at, updated_at, claimed_at, done_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      node.id,
      node.title,
      node.kind,
      node.milestone,
      node.group_name,
      JSON.stringify(node.projects),
      node.status,
      node.priority,
      node.estimate_points,
      node.risk,
      node.owner,
      node.branch,
      node.spec,
      node.acceptance,
      node.validation,
      JSON.stringify(node.verification),
      JSON.stringify(node.audit_focus),
      node.context,
      node.status_reason,
      node.check_command,
      node.ci_command,
      node.blocked_by,
      node.blocked_reason,
      node.blocked_owner,
      node.created_at,
      node.updated_at,
      node.claimed_at,
      node.done_at,
    ],
  );
}

export async function insertEdge(
  db: Database,
  fromNode: string,
  toNode: string,
  type: EdgeType,
  createdAt: string,
): Promise<QdEdge> {
  await assertNodeExists(db, fromNode);
  await assertNodeExists(db, toNode);
  if (fromNode === toNode) throw new Error("An edge cannot point to the same node");
  if (type === "requires" && (await wouldCreateCycle(db, fromNode, toNode))) {
    throw new Error(`Adding ${fromNode} -> ${toNode} would create a cycle`);
  }
  const edge: QdEdge = {
    from_node: fromNode,
    to_node: toNode,
    type,
    created_at: createdAt,
  };
  await run(db, "insert into edges (from_node, to_node, type, created_at) values (?, ?, ?, ?)", [
    edge.from_node,
    edge.to_node,
    edge.type,
    edge.created_at,
  ]);
  return edge;
}

export function assertNodeQuality(
  node: Pick<
    QdNode,
    | "id"
    | "title"
    | "spec"
    | "acceptance"
    | "estimate_points"
    | "status"
    | "blocked_by"
    | "blocked_reason"
    | "blocked_owner"
  >,
): void {
  assertStringField(node.id, "id");
  assertStringField(node.title, "title");
  assertStringField(node.spec, "spec");
  assertStringField(node.acceptance, "acceptance");
  if (!node.id.trim()) throw new Error("Node id is required");
  if (!node.title.trim()) throw new Error("Node title is required");
  if (!node.spec.trim()) throw new Error("Node spec is required");
  if (!node.acceptance.trim()) throw new Error("Node acceptance criteria are required");
  if (!Number.isInteger(node.estimate_points) || node.estimate_points < 1) {
    throw new Error("Node estimate_points must be a positive integer");
  }
  if (
    node.blocked_by !== null &&
    node.blocked_by !== "manual" &&
    node.blocked_by !== "external" &&
    node.blocked_by !== "policy"
  ) {
    throw new Error("blocked_by must be manual, external, policy, or null");
  }
  if (node.blocked_reason !== null) assertStringField(node.blocked_reason, "blocked_reason");
  if (node.blocked_owner !== null) assertStringField(node.blocked_owner, "blocked_owner");
  if (node.blocked_by && node.status !== "blocked") {
    throw new Error("blocked_by can only be set when node status is blocked");
  }
  if (node.blocked_by && !node.blocked_reason?.trim()) {
    throw new Error("blocked_reason is required when blocked_by is set");
  }
  if (node.blocked_owner !== null && !node.blocked_owner.trim()) {
    throw new Error("blocked_owner must not be empty");
  }
}

export async function ensureNodeMetadataRegistered(
  db: Database,
  nodes: QdNode[],
  now: string,
): Promise<void> {
  for (const group of new Set(nodes.map((node) => node.group_name).filter(isNonEmptyString))) {
    await run(db, "insert or ignore into groups (name, created_at) values (?, ?)", [group, now]);
  }
  for (const project of new Set(nodes.flatMap((node) => node.projects))) {
    await run(db, "insert or ignore into projects (name, created_at) values (?, ?)", [
      project,
      now,
    ]);
  }
  let rank =
    (await get<{ rank: number | null }>(db, "select max(rank) as rank from milestones"))?.rank ?? 0;
  for (const milestone of new Set(nodes.map((node) => node.milestone).filter(isNonEmptyString))) {
    if (await registryContains(db, "milestones", milestone)) continue;
    rank += 1;
    await run(db, "insert into milestones (name, rank, created_at) values (?, ?, ?)", [
      milestone,
      rank,
      now,
    ]);
  }
}

export async function assertNodeRegistryValues(db: Database, node: QdNode): Promise<void> {
  const errors = await nodeRegistryErrors(db, node);
  if (errors.length > 0) throw new Error(errors.join("; "));
}

export async function nodeRegistryErrors(db: Database, node: QdNode): Promise<string[]> {
  const errors: string[] = [];
  if (
    node.group_name &&
    (await registryHasValues(db, "groups")) &&
    !(await registryContains(db, "groups", node.group_name))
  ) {
    errors.push(`unknown group: ${node.group_name}`);
  }
  if (
    node.milestone &&
    (await registryHasValues(db, "milestones")) &&
    !(await registryContains(db, "milestones", node.milestone))
  ) {
    errors.push(`unknown milestone: ${node.milestone}`);
  }
  if (await registryHasValues(db, "projects")) {
    for (const project of node.projects) {
      if (!(await registryContains(db, "projects", project)))
        errors.push(`unknown project: ${project}`);
    }
  }
  return errors;
}

export async function openAssignmentConflict(
  db: Database,
  column: "branch" | "worktree_path",
  value: string,
): Promise<boolean> {
  const row = await get<{ id: string }>(
    db,
    `select id from assignments where ${column} = ? and status = 'open' limit 1`,
    [value],
  );
  return Boolean(row);
}

export function hydrateNode(row: NodeRow): QdNode {
  const { projects_json, verification_json, audit_focus_json, ...node } = row;
  return {
    ...node,
    projects: parseJsonArray<string>(projects_json),
    verification: parseJsonArray<VerificationEntry>(verification_json),
    audit_focus: parseJsonArray<string>(audit_focus_json),
  };
}

export function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Partial<T>;
}

export function findCycle(edges: Pick<QdEdge, "from_node" | "to_node">[]): string[] | null {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    const next = graph.get(edge.from_node) ?? [];
    next.push(edge.to_node);
    graph.set(edge.from_node, next);
    if (!graph.has(edge.to_node)) graph.set(edge.to_node, []);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(node: string): string[] | null {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (visited.has(node)) return null;
    visiting.add(node);
    stack.push(node);
    for (const child of graph.get(node) ?? []) {
      const cycle = visit(child);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

async function wouldCreateCycle(db: Database, fromNode: string, toNode: string): Promise<boolean> {
  const edges = await all<QdEdge>(db, "select * from edges where type = 'requires'");
  const cycle = findCycle([...edges, { from_node: fromNode, to_node: toNode }]);
  return cycle !== null;
}

function assertStringField(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`Node ${field} must be a string`);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function registryHasValues(
  db: Database,
  table: "groups" | "projects" | "milestones",
): Promise<boolean> {
  const row = await get<{ count: number }>(db, `select count(*) as count from ${table}`);
  return (row?.count ?? 0) > 0;
}

async function registryContains(
  db: Database,
  table: "groups" | "projects" | "milestones",
  name: string,
): Promise<boolean> {
  const row = await get<{ name: string }>(db, `select name from ${table} where name = ?`, [name]);
  return Boolean(row);
}

function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Expected node metadata JSON to be an array");
  return parsed as T[];
}
