import { randomUUID } from "node:crypto";
import {
  all,
  applyMigrations,
  get,
  initProject,
  openDatabase,
  readConfig,
  run,
  type Database,
} from "./db.js";
import type {
  EdgeType,
  FindingStatus,
  GraphSnapshot,
  NodeNote,
  NodeKind,
  NodeStatus,
  Priority,
  QdEdge,
  QdFinding,
  QdNode,
  QdRun,
  PromotedFinding,
  RegistryEntry,
  Risk,
  RunKind,
  VerificationEntry,
} from "./types.js";

export interface AddNodeInput {
  id?: string;
  title: string;
  kind?: NodeKind;
  milestone?: string | null;
  groupName?: string | null;
  projects?: string[];
  status?: NodeStatus;
  priority?: Priority;
  estimatePoints?: number;
  risk?: Risk;
  spec: string;
  acceptance: string;
  validation?: string | null;
  verification?: VerificationEntry[];
  auditFocus?: string[];
  context?: string | null;
  statusReason?: string | null;
  checkCommand?: string | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

interface NodeRow extends Omit<QdNode, "projects" | "verification" | "audit_focus"> {
  projects_json: string;
  verification_json: string;
  audit_focus_json: string;
}

export async function setupProject(root = process.cwd()): Promise<void> {
  await initProject(root);
}

export async function addNode(root: string, input: AddNodeInput): Promise<QdNode> {
  const db = await openDatabase(root);
  await applyMigrations(db);
  const now = new Date().toISOString();
  const id = input.id ?? (await uniqueNodeId(db, slugify(input.title)));
  const node: QdNode = {
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
    created_at: now,
    updated_at: now,
    claimed_at: null,
    done_at: null,
  };
  assertNodeQuality(node);
  await assertNodeRegistryValues(db, node);
  await run(
    db,
    `insert into nodes (
      id, title, kind, milestone, group_name, projects_json, status, priority, estimate_points, risk, owner, branch,
      spec, acceptance, validation, verification_json, audit_focus_json, context, status_reason, check_command, created_at, updated_at, claimed_at, done_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      node.created_at,
      node.updated_at,
      node.claimed_at,
      node.done_at,
    ],
  );
  return node;
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
    >
  > & {
    estimatePoints?: number;
  },
): Promise<QdNode> {
  const db = await openDatabase(root);
  const current = await getNode(root, id);
  const next = {
    ...current,
    ...updates,
    estimate_points: updates.estimatePoints ?? current.estimate_points,
    updated_at: new Date().toISOString(),
  };
  assertNodeQuality(next);
  await assertNodeRegistryValues(db, next);
  await run(
    db,
    `update nodes set
      title = ?, kind = ?, milestone = ?, group_name = ?, projects_json = ?, status = ?, priority = ?, estimate_points = ?, risk = ?,
      owner = ?, branch = ?, spec = ?, acceptance = ?, validation = ?, verification_json = ?, audit_focus_json = ?, context = ?, status_reason = ?, check_command = ?, updated_at = ?
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

export async function listRuns(root: string, nodeId?: string | null): Promise<QdRun[]> {
  const db = await openDatabase(root);
  if (nodeId) {
    return all<QdRun>(db, "select * from runs where node_id = ? order by started_at asc", [nodeId]);
  }
  return all<QdRun>(db, "select * from runs order by started_at asc");
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
    created_at: new Date().toISOString(),
  };
  await run(db, "insert into edges (from_node, to_node, type, created_at) values (?, ?, ?, ?)", [
    edge.from_node,
    edge.to_node,
    edge.type,
    edge.created_at,
  ]);
  return edge;
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
    where n.status in ('ready', 'blocked', 'regressed')
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

export async function startRun(
  root: string,
  nodeId: string,
  kind: RunKind,
  input: {
    agent?: string | null;
    worktreePath?: string | null;
    summary?: string | null;
    logPath?: string | null;
  } = {},
): Promise<QdRun> {
  const db = await openDatabase(root);
  await assertNodeExists(db, nodeId);
  const runRow: QdRun = {
    id: randomUUID(),
    node_id: nodeId,
    kind,
    status: "running",
    worktree_path: input.worktreePath ?? null,
    agent: input.agent ?? null,
    started_at: new Date().toISOString(),
    finished_at: null,
    summary: input.summary ?? null,
    log_path: input.logPath ?? null,
  };
  await run(
    db,
    `insert into runs (id, node_id, kind, status, worktree_path, agent, started_at, finished_at, summary, log_path)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runRow.id,
      runRow.node_id,
      runRow.kind,
      runRow.status,
      runRow.worktree_path,
      runRow.agent,
      runRow.started_at,
      runRow.finished_at,
      runRow.summary,
      runRow.log_path,
    ],
  );
  if (kind === "implement") await setNodeStatus(root, nodeId, "working");
  if (kind === "audit") await setNodeStatus(root, nodeId, "review");
  if (kind === "resolve") await setNodeStatus(root, nodeId, "fixing");
  if (kind === "ci") await setNodeStatus(root, nodeId, "ci");
  return runRow;
}

export async function completeNode(root: string, nodeId: string, summary: string): Promise<QdNode> {
  const db = await openDatabase(root);
  const now = new Date().toISOString();
  await run(
    db,
    `insert into runs (id, node_id, kind, status, started_at, finished_at, summary)
    values (?, ?, 'implement', 'completed', ?, ?, ?)`,
    [randomUUID(), nodeId, now, now, summary],
  );
  await run(db, "update nodes set status = 'review', updated_at = ? where id = ?", [now, nodeId]);
  return getNode(root, nodeId);
}

export async function addFinding(
  root: string,
  nodeId: string,
  input: {
    severity: Priority;
    title: string;
    evidence: string;
    runId?: string | null;
    path?: string | null;
    line?: number | null;
    expected?: string | null;
    suggestedFix?: string | null;
  },
): Promise<QdFinding> {
  const db = await openDatabase(root);
  await assertNodeExists(db, nodeId);
  const finding: QdFinding = {
    id: randomUUID(),
    node_id: nodeId,
    run_id: input.runId ?? null,
    severity: input.severity,
    status: "open",
    title: input.title,
    path: input.path ?? null,
    line: input.line ?? null,
    evidence: input.evidence,
    expected: input.expected ?? null,
    suggested_fix: input.suggestedFix ?? null,
    created_at: new Date().toISOString(),
    resolved_at: null,
  };
  await run(
    db,
    `insert into findings (id, node_id, run_id, severity, status, title, path, line, evidence, expected, suggested_fix, created_at, resolved_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      finding.id,
      finding.node_id,
      finding.run_id,
      finding.severity,
      finding.status,
      finding.title,
      finding.path,
      finding.line,
      finding.evidence,
      finding.expected,
      finding.suggested_fix,
      finding.created_at,
      finding.resolved_at,
    ],
  );
  return finding;
}

export async function resolveFinding(root: string, findingId: string): Promise<QdFinding> {
  const db = await openDatabase(root);
  await run(db, "update findings set status = 'resolved', resolved_at = ? where id = ?", [
    new Date().toISOString(),
    findingId,
  ]);
  const finding = await get<QdFinding>(db, "select * from findings where id = ?", [findingId]);
  if (!finding) throw new Error(`Finding not found: ${findingId}`);
  return finding;
}

export async function gateNode(
  root: string,
  nodeId: string,
): Promise<{ ok: boolean; blocking: QdFinding[] }> {
  const db = await openDatabase(root);
  const blocking = await all<QdFinding>(
    db,
    "select * from findings where node_id = ? and status = 'open' and severity in ('P0', 'P1') order by created_at asc",
    [nodeId],
  );
  return { ok: blocking.length === 0, blocking };
}

export async function promoteFindings(root: string, nodeId: string): Promise<PromotedFinding[]> {
  const db = await openDatabase(root);
  const gate = await gateNode(root, nodeId);
  if (!gate.ok) {
    const blocking = gate.blocking
      .map((finding) => `${finding.severity} ${finding.id}: ${finding.title}`)
      .join("; ");
    throw new Error(
      `Cannot promote findings while P0/P1 findings are open. Resolve or escalate first: ${blocking}`,
    );
  }
  const findings = await all<QdFinding>(
    db,
    "select * from findings where node_id = ? and status = 'open' and severity in ('P2', 'P3') order by created_at asc",
    [nodeId],
  );
  const promoted: PromotedFinding[] = [];
  for (const finding of findings) {
    const node = await addNode(root, {
      title: finding.title,
      kind: "audit-fix",
      status: "ready",
      priority: finding.severity,
      risk: finding.severity === "P2" ? "medium" : "low",
      spec: [finding.evidence, finding.suggested_fix].filter(Boolean).join("\n\n"),
      acceptance: finding.expected ?? "Finding is addressed and verified.",
      context: finding.path ? `${finding.path}${finding.line ? `:${finding.line}` : ""}` : null,
      statusReason: `Promoted from finding ${finding.id} on node ${nodeId}.`,
    });
    await run(db, "update findings set status = 'promoted', resolved_at = ? where id = ?", [
      new Date().toISOString(),
      finding.id,
    ]);
    promoted.push({ findingId: finding.id, newNodeId: node.id, node });
  }
  return promoted;
}

export async function ciPass(root: string, nodeId: string, summary = "CI passed"): Promise<QdNode> {
  const gate = await gateNode(root, nodeId);
  if (!gate.ok) throw new Error("Cannot pass CI while P0/P1 findings are open");
  const db = await openDatabase(root);
  const now = new Date().toISOString();
  await run(
    db,
    "insert into runs (id, node_id, kind, status, started_at, finished_at, summary) values (?, ?, 'ci', 'passed', ?, ?, ?)",
    [randomUUID(), nodeId, now, now, summary],
  );
  await run(db, "update nodes set status = 'mergeable', updated_at = ? where id = ?", [
    now,
    nodeId,
  ]);
  return getNode(root, nodeId);
}

export async function recordCiResult(
  root: string,
  nodeId: string,
  input: {
    status: "passed" | "failed";
    summary: string;
    logPath?: string | null;
    startedAt?: string;
    finishedAt?: string;
  },
): Promise<QdNode> {
  const db = await openDatabase(root);
  const now = new Date().toISOString();
  const startedAt = input.startedAt ?? now;
  const finishedAt = input.finishedAt ?? now;
  await run(
    db,
    `insert into runs (id, node_id, kind, status, started_at, finished_at, summary, log_path)
    values (?, ?, 'ci', ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      nodeId,
      input.status,
      startedAt,
      finishedAt,
      input.summary,
      input.logPath ?? null,
    ],
  );
  await run(db, "update nodes set status = ?, updated_at = ? where id = ?", [
    input.status === "passed" ? "mergeable" : "blocked",
    finishedAt,
    nodeId,
  ]);
  return getNode(root, nodeId);
}

export async function recordCheckResult(
  root: string,
  nodeId: string,
  input: {
    status: "passed" | "failed";
    summary: string;
    logPath?: string | null;
    startedAt?: string;
    finishedAt?: string;
  },
): Promise<QdNode> {
  const db = await openDatabase(root);
  await assertNodeExists(db, nodeId);
  const now = new Date().toISOString();
  const startedAt = input.startedAt ?? now;
  const finishedAt = input.finishedAt ?? now;
  await run(
    db,
    `insert into runs (id, node_id, kind, status, started_at, finished_at, summary, log_path)
    values (?, ?, 'check', ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      nodeId,
      input.status,
      startedAt,
      finishedAt,
      input.summary,
      input.logPath ?? null,
    ],
  );
  if (input.status === "failed") {
    await run(db, "update nodes set status = 'blocked', updated_at = ? where id = ?", [
      finishedAt,
      nodeId,
    ]);
  }
  return getNode(root, nodeId);
}

export async function ciFail(root: string, nodeId: string, summary = "CI failed"): Promise<QdNode> {
  const db = await openDatabase(root);
  const now = new Date().toISOString();
  await run(
    db,
    "insert into runs (id, node_id, kind, status, started_at, finished_at, summary) values (?, ?, 'ci', 'failed', ?, ?, ?)",
    [randomUUID(), nodeId, now, now, summary],
  );
  await run(db, "update nodes set status = 'blocked', updated_at = ? where id = ?", [now, nodeId]);
  return getNode(root, nodeId);
}

export async function markMerged(root: string, nodeId: string, strategy: string): Promise<QdNode> {
  const config = await readConfig(root);
  const gate = await gateNode(root, nodeId);
  if (!gate.ok) throw new Error("Cannot merge while P0/P1 findings are open");
  const node = await getNode(root, nodeId);
  if (node.status !== "mergeable")
    throw new Error(`Cannot merge node with status ${node.status}; expected mergeable`);
  if (config.requireCiBeforeMerge) {
    const latestCi = await latestRun(root, nodeId, "ci");
    if (!latestCi || latestCi.status !== "passed")
      throw new Error("Cannot merge without a latest passed CI run");
  }
  const db = await openDatabase(root);
  const now = new Date().toISOString();
  await run(
    db,
    "insert into runs (id, node_id, kind, status, started_at, finished_at, summary) values (?, ?, 'merge', 'recorded', ?, ?, ?)",
    [randomUUID(), nodeId, now, now, `Merge recorded with ${strategy}`],
  );
  await run(db, "update nodes set status = 'done', done_at = ?, updated_at = ? where id = ?", [
    now,
    now,
    nodeId,
  ]);
  return getNode(root, nodeId);
}

export async function latestRun(
  root: string,
  nodeId: string,
  kind: RunKind,
): Promise<QdRun | undefined> {
  const db = await openDatabase(root);
  return get<QdRun>(
    db,
    "select * from runs where node_id = ? and kind = ? order by started_at desc limit 1",
    [nodeId, kind],
  );
}

export async function graphSnapshot(root: string): Promise<GraphSnapshot> {
  const db = await openDatabase(root);
  return {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    registries: {
      groups: await listRegistry(root, "groups"),
      projects: await listRegistry(root, "projects"),
      milestones: await listRegistry(root, "milestones"),
    },
    nodes: (await all<NodeRow>(db, "select * from nodes order by created_at asc")).map(hydrateNode),
    edges: await all<QdEdge>(db, "select * from edges order by created_at asc"),
    findings: await all<QdFinding>(db, "select * from findings order by created_at asc"),
    runs: await all<QdRun>(db, "select * from runs order by started_at asc"),
    node_notes: await all<NodeNote>(db, "select * from node_notes order by created_at asc"),
  };
}

export async function restoreGraphSnapshot(root: string, snapshot: GraphSnapshot): Promise<void> {
  const db = await openDatabase(root);
  await applyMigrations(db);
  if (snapshot.schema_version !== 1) {
    throw new Error(`Unsupported qd export schema_version: ${snapshot.schema_version}`);
  }
  const existingNode = await get<NodeRow>(db, "select * from nodes limit 1");
  if (existingNode) {
    throw new Error(
      "qd import requires an empty qd DAG. Remove the local .qd/qd.db cache or import into a fresh qd setup.",
    );
  }
  const nodeIds = new Set<string>();
  for (const node of snapshot.nodes) {
    if (nodeIds.has(node.id)) throw new Error(`duplicate node id in qd export: ${node.id}`);
    nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of snapshot.edges) {
    const edgeId = `${edge.from_node}\0${edge.to_node}\0${edge.type}`;
    if (edgeIds.has(edgeId)) {
      throw new Error(
        `duplicate edge in qd export: ${edge.from_node} -> ${edge.to_node} (${edge.type})`,
      );
    }
    edgeIds.add(edgeId);
    if (!nodeIds.has(edge.from_node)) {
      throw new Error(`edge references missing from node: ${edge.from_node}`);
    }
    if (!nodeIds.has(edge.to_node)) {
      throw new Error(`edge references missing to node: ${edge.to_node}`);
    }
  }
  const cycle = findCycle(snapshot.edges.filter((edge) => edge.type === "requires"));
  if (cycle) throw new Error(`requires edge cycle detected: ${cycle.join(" -> ")}`);
  const runIds = new Set<string>();
  for (const runEntry of snapshot.runs) {
    if (runIds.has(runEntry.id)) throw new Error(`duplicate run id in qd export: ${runEntry.id}`);
    runIds.add(runEntry.id);
    if (!nodeIds.has(runEntry.node_id)) {
      throw new Error(`run references missing node: ${runEntry.node_id}`);
    }
  }
  for (const finding of snapshot.findings) {
    if (!nodeIds.has(finding.node_id)) {
      throw new Error(`finding references missing node: ${finding.node_id}`);
    }
    if (finding.run_id && !runIds.has(finding.run_id)) {
      throw new Error(`finding references missing run: ${finding.run_id}`);
    }
  }
  for (const note of snapshot.node_notes) {
    if (!nodeIds.has(note.node_id))
      throw new Error(`note references missing node: ${note.node_id}`);
  }

  for (const group of snapshot.registries.groups) {
    await run(db, "insert or replace into groups (name, created_at) values (?, ?)", [
      group.name,
      group.created_at,
    ]);
  }
  for (const project of snapshot.registries.projects) {
    await run(db, "insert or replace into projects (name, created_at) values (?, ?)", [
      project.name,
      project.created_at,
    ]);
  }
  for (const milestone of snapshot.registries.milestones) {
    if (!Number.isInteger(milestone.rank)) {
      throw new Error(`milestone ${milestone.name} is missing integer rank`);
    }
    await run(db, "insert or replace into milestones (name, rank, created_at) values (?, ?, ?)", [
      milestone.name,
      milestone.rank,
      milestone.created_at,
    ]);
  }

  for (const node of snapshot.nodes) {
    assertNodeQuality(node);
    await assertNodeRegistryValues(db, node);
    await run(
      db,
      `insert into nodes (
        id, title, kind, milestone, group_name, projects_json, status, priority, estimate_points, risk, owner, branch,
        spec, acceptance, validation, verification_json, audit_focus_json, context, status_reason, check_command,
        created_at, updated_at, claimed_at, done_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        node.created_at,
        node.updated_at,
        node.claimed_at,
        node.done_at,
      ],
    );
  }

  for (const edge of snapshot.edges) {
    await run(db, "insert into edges (from_node, to_node, type, created_at) values (?, ?, ?, ?)", [
      edge.from_node,
      edge.to_node,
      edge.type,
      edge.created_at,
    ]);
  }

  for (const runEntry of snapshot.runs) {
    await run(
      db,
      `insert into runs (
        id, node_id, kind, status, worktree_path, agent, started_at, finished_at, summary, log_path
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runEntry.id,
        runEntry.node_id,
        runEntry.kind,
        runEntry.status,
        runEntry.worktree_path,
        runEntry.agent,
        runEntry.started_at,
        runEntry.finished_at,
        runEntry.summary,
        runEntry.log_path,
      ],
    );
  }

  for (const finding of snapshot.findings) {
    await run(
      db,
      `insert into findings (
        id, node_id, run_id, severity, status, title, path, line, evidence, expected,
        suggested_fix, created_at, resolved_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        finding.id,
        finding.node_id,
        finding.run_id,
        finding.severity,
        finding.status,
        finding.title,
        finding.path,
        finding.line,
        finding.evidence,
        finding.expected,
        finding.suggested_fix,
        finding.created_at,
        finding.resolved_at,
      ],
    );
  }

  for (const note of snapshot.node_notes) {
    await run(db, "insert into node_notes (id, node_id, text, created_at) values (?, ?, ?, ?)", [
      note.id,
      note.node_id,
      note.text,
      note.created_at,
    ]);
  }
}

export async function validateGraph(root: string): Promise<ValidationResult> {
  const db = await openDatabase(root);
  const nodes = await listNodes(root);
  const edges = await listEdges(root);
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const node of nodes) {
    if (node.status !== "draft" && node.acceptance.trim().length === 0) {
      errors.push(`${node.id}: non-draft node is missing acceptance criteria`);
    }
    if (node.spec.trim().length === 0) {
      errors.push(`${node.id}: node is missing spec`);
    }
    const registryErrors = await nodeRegistryErrors(db, node);
    errors.push(...registryErrors.map((error) => `${node.id}: ${error}`));
  }

  const cycle = findCycle(edges.filter((edge) => edge.type === "requires"));
  if (cycle) errors.push(`requires edge cycle detected: ${cycle.join(" -> ")}`);

  for (const edge of edges) {
    if (!(await get<NodeRow>(db, "select * from nodes where id = ?", [edge.from_node]))) {
      errors.push(`edge references missing from_node: ${edge.from_node}`);
    }
    if (!(await get<NodeRow>(db, "select * from nodes where id = ?", [edge.to_node]))) {
      errors.push(`edge references missing to_node: ${edge.to_node}`);
    }
  }

  const ready = new Set((await readyNodes(root)).map((node) => node.id));
  for (const node of nodes) {
    if (node.status === "blocked" && ready.has(node.id)) {
      warnings.push(`${node.id}: blocked node has no incomplete dependencies`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export async function registerGroup(root: string, name: string): Promise<RegistryEntry> {
  return registerName(root, "groups", name);
}

export async function registerProject(root: string, name: string): Promise<RegistryEntry> {
  return registerName(root, "projects", name);
}

export async function registerMilestone(
  root: string,
  name: string,
  rank: number,
): Promise<RegistryEntry> {
  const db = await openDatabase(root);
  const now = new Date().toISOString();
  await run(db, "insert or replace into milestones (name, rank, created_at) values (?, ?, ?)", [
    name,
    rank,
    now,
  ]);
  return { name, rank, created_at: now };
}

export async function listRegistry(
  root: string,
  table: "groups" | "projects" | "milestones",
): Promise<RegistryEntry[]> {
  const db = await openDatabase(root);
  const order = table === "milestones" ? "rank asc" : "name asc";
  return all<RegistryEntry>(db, `select * from ${table} order by ${order}`);
}

export async function addNodeNote(root: string, nodeId: string, text: string): Promise<NodeNote> {
  const db = await openDatabase(root);
  await assertNodeExists(db, nodeId);
  const note: NodeNote = {
    id: randomUUID(),
    node_id: nodeId,
    text,
    created_at: new Date().toISOString(),
  };
  await run(db, "insert into node_notes (id, node_id, text, created_at) values (?, ?, ?, ?)", [
    note.id,
    note.node_id,
    note.text,
    note.created_at,
  ]);
  const node = await getNode(root, nodeId);
  const statusReason = [node.status_reason, `[${note.created_at}] ${text}`]
    .filter(Boolean)
    .join("\n");
  await run(db, "update nodes set status_reason = ?, updated_at = ? where id = ?", [
    statusReason,
    note.created_at,
    nodeId,
  ]);
  return note;
}

export async function listNodeNotes(root: string, nodeId: string): Promise<NodeNote[]> {
  const db = await openDatabase(root);
  return all<NodeNote>(db, "select * from node_notes where node_id = ? order by created_at asc", [
    nodeId,
  ]);
}

export async function stats(root: string): Promise<Record<string, unknown>> {
  const nodes = await listNodes(root);
  const ready = await readyNodes(root);
  const snapshot = await graphSnapshot(root);
  const byStatus = Object.fromEntries(
    [...new Set(nodes.map((node) => node.status))].map((status) => [
      status,
      nodes.filter((node) => node.status === status).length,
    ]),
  );
  const donePoints = nodes
    .filter((node) => node.status === "done")
    .reduce((sum, node) => sum + node.estimate_points, 0);
  const totalPoints = nodes.reduce((sum, node) => sum + node.estimate_points, 0);
  return {
    nodes: nodes.length,
    ready: ready.length,
    byStatus,
    donePoints,
    totalPoints,
    remainingPoints: totalPoints - donePoints,
    openP0P1Findings: snapshot.findings.filter(
      (finding) =>
        finding.status === "open" && (finding.severity === "P0" || finding.severity === "P1"),
    ).length,
  };
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

async function uniqueNodeId(db: Database, base: string): Promise<string> {
  let candidate = base || "node";
  let suffix = 2;
  while (await get<NodeRow>(db, "select * from nodes where id = ?", [candidate])) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function assertNodeExists(db: Database, id: string): Promise<void> {
  const node = await get<NodeRow>(db, "select * from nodes where id = ?", [id]);
  if (!node) throw new Error(`Node not found: ${id}`);
}

function assertNodeQuality(
  node: Pick<QdNode, "id" | "title" | "spec" | "acceptance" | "estimate_points">,
): void {
  if (!node.id.trim()) throw new Error("Node id is required");
  if (!node.title.trim()) throw new Error("Node title is required");
  if (!node.spec.trim()) throw new Error("Node spec is required");
  if (!node.acceptance.trim()) throw new Error("Node acceptance criteria are required");
  if (!Number.isInteger(node.estimate_points) || node.estimate_points < 1) {
    throw new Error("Node estimate_points must be a positive integer");
  }
}

async function registerName(
  root: string,
  table: "groups" | "projects",
  name: string,
): Promise<RegistryEntry> {
  const db = await openDatabase(root);
  const now = new Date().toISOString();
  await run(db, `insert or replace into ${table} (name, created_at) values (?, ?)`, [name, now]);
  return { name, created_at: now };
}

async function assertNodeRegistryValues(db: Database, node: QdNode): Promise<void> {
  const errors = await nodeRegistryErrors(db, node);
  if (errors.length > 0) throw new Error(errors.join("; "));
}

async function nodeRegistryErrors(db: Database, node: QdNode): Promise<string[]> {
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

function hydrateNode(row: NodeRow): QdNode {
  return {
    ...row,
    projects: parseJsonArray<string>(row.projects_json),
    verification: parseJsonArray<VerificationEntry>(row.verification_json),
    audit_focus: parseJsonArray<string>(row.audit_focus_json),
  };
}

function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Expected node metadata JSON to be an array");
  return parsed as T[];
}

async function wouldCreateCycle(db: Database, fromNode: string, toNode: string): Promise<boolean> {
  const edges = await all<QdEdge>(db, "select * from edges where type = 'requires'");
  const cycle = findCycle([...edges, { from_node: fromNode, to_node: toNode }]);
  return cycle !== null;
}

function findCycle(edges: Pick<QdEdge, "from_node" | "to_node">[]): string[] | null {
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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
