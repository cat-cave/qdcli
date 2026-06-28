import { randomUUID } from "node:crypto";
import { all, get, openDatabase, run } from "./db.js";
import type { QdAssignment, QdWave, QdWaveMembership, RegistryEntry, WaveKind } from "./types.js";
import type {
  AddAssignmentInput,
  ListAssignmentFilters,
  ValidateGraphOptions,
  ValidationResult,
} from "./graph-types.js";
import {
  assertNodeExists,
  findCycle,
  nodeRegistryErrors,
  openAssignmentConflict,
  type NodeRow,
} from "./graph-internal.js";
export {
  addFinding,
  completeNode,
  disposeFinding,
  gateNode,
  latestRun,
  resolveFinding,
  startRun,
} from "./graph-audit.js";
export {
  ciFail,
  ciPass,
  markMerged,
  policyReport,
  promoteFindings,
  recordCheckResult,
  recordCiResult,
  unblockNode,
} from "./graph-policy.js";
import { listEdges, listNodes, readyNodes } from "./graph-nodes.js";
export {
  addEdge,
  addNode,
  addNodesBulk,
  cancelNode,
  claimNode,
  finishRun,
  getNode,
  getRun,
  listEdges,
  listFindings,
  listNodes,
  listRuns,
  readyNodes,
  removeEdge,
  setNodeStatus,
  setupProject,
  updateNode,
} from "./graph-nodes.js";
export { addNodeNote, listNodeNotes } from "./graph-notes.js";
import { graphSnapshot } from "./graph-snapshot.js";
export {
  deterministicGraphSnapshot,
  graphSnapshot,
  replaceGraphSnapshot,
  restoreGraphSnapshot,
} from "./graph-snapshot.js";
export { validateGraphSnapshotForWrite } from "./graph-snapshot-validation.js";
export type {
  AddAssignmentInput,
  AddNodeInput,
  BulkEdgeInput,
  GateExplanation,
  ListAssignmentFilters,
  ListRunFilters,
  ValidateGraphOptions,
  ValidationResult,
} from "./graph-types.js";

export async function validateGraph(
  root: string,
  options: ValidateGraphOptions = {},
): Promise<ValidationResult> {
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
    const target = options.strict ? errors : warnings;
    target.push(...registryErrors.map((error) => `${node.id}: ${error}`));
    if (node.blocked_by && node.status !== "blocked") {
      errors.push(`${node.id}: blocked_by is set but status is ${node.status}`);
    }
    if (node.status === "blocked" && !node.blocked_by) {
      const message = `${node.id}: blocked node should include blocked_by and blocked_reason for external/manual blockers`;
      if (options.strict) errors.push(message);
      else warnings.push(message);
    }
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

export async function addAssignment(
  root: string,
  input: AddAssignmentInput,
): Promise<QdAssignment> {
  const db = await openDatabase(root);
  await assertNodeExists(db, input.nodeId);
  if (!input.owner.trim()) throw new Error("assignment owner is required");
  if (input.branch && (await openAssignmentConflict(db, "branch", input.branch))) {
    throw new Error(`branch already has an open assignment: ${input.branch}`);
  }
  if (
    input.worktreePath &&
    (await openAssignmentConflict(db, "worktree_path", input.worktreePath))
  ) {
    throw new Error(`worktree already has an open assignment: ${input.worktreePath}`);
  }
  const now = new Date().toISOString();
  const assignment: QdAssignment = {
    id: randomUUID(),
    node_id: input.nodeId,
    role: input.role,
    owner: input.owner,
    branch: input.branch ?? null,
    worktree_path: input.worktreePath ?? null,
    scope: input.scope ?? null,
    status: "open",
    commits_json: "[]",
    evidence_json: "[]",
    summary: null,
    started_at: now,
    finished_at: null,
  };
  await run(
    db,
    `insert into assignments (
      id, node_id, role, owner, branch, worktree_path, scope, status, commits_json, evidence_json, summary, started_at, finished_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      assignment.id,
      assignment.node_id,
      assignment.role,
      assignment.owner,
      assignment.branch,
      assignment.worktree_path,
      assignment.scope,
      assignment.status,
      assignment.commits_json,
      assignment.evidence_json,
      assignment.summary,
      assignment.started_at,
      assignment.finished_at,
    ],
  );
  return assignment;
}

export async function completeAssignment(
  root: string,
  assignmentId: string,
  input: {
    status: "complete" | "failed" | "cancelled";
    summary: string;
    commits?: string[];
    evidence?: string[];
  },
): Promise<QdAssignment> {
  const db = await openDatabase(root);
  await run(
    db,
    `update assignments set status = ?, summary = ?, commits_json = ?, evidence_json = ?, finished_at = ? where id = ?`,
    [
      input.status,
      input.summary,
      JSON.stringify(input.commits ?? []),
      JSON.stringify(input.evidence ?? []),
      new Date().toISOString(),
      assignmentId,
    ],
  );
  const assignment = await get<QdAssignment>(db, "select * from assignments where id = ?", [
    assignmentId,
  ]);
  if (!assignment) throw new Error(`Assignment not found: ${assignmentId}`);
  return assignment;
}

export async function listAssignments(
  root: string,
  filters: ListAssignmentFilters = {},
): Promise<QdAssignment[]> {
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
  const clause = where.length > 0 ? ` where ${where.join(" and ")}` : "";
  return all<QdAssignment>(
    db,
    `select * from assignments${clause} order by started_at asc`,
    params,
  );
}

export async function startWave(
  root: string,
  input: { kind: WaveKind; summary: string },
): Promise<QdWave> {
  const db = await openDatabase(root);
  const now = new Date().toISOString();
  const wave: QdWave = {
    id: randomUUID(),
    kind: input.kind,
    status: "open",
    summary: input.summary,
    started_at: now,
    finished_at: null,
  };
  await run(
    db,
    "insert into waves (id, kind, status, summary, started_at, finished_at) values (?, ?, ?, ?, ?, ?)",
    [wave.id, wave.kind, wave.status, wave.summary, wave.started_at, wave.finished_at],
  );
  return wave;
}

export async function completeWave(
  root: string,
  waveId: string,
  input: { status?: "complete" | "cancelled"; summary: string },
): Promise<QdWave> {
  const db = await openDatabase(root);
  await run(db, "update waves set status = ?, summary = ?, finished_at = ? where id = ?", [
    input.status ?? "complete",
    input.summary,
    new Date().toISOString(),
    waveId,
  ]);
  const wave = await get<QdWave>(db, "select * from waves where id = ?", [waveId]);
  if (!wave) throw new Error(`Wave not found: ${waveId}`);
  return wave;
}

export async function addWaveNode(root: string, waveId: string, nodeId: string): Promise<void> {
  const db = await openDatabase(root);
  await assertNodeExists(db, nodeId);
  await run(
    db,
    "insert or ignore into wave_memberships (wave_id, node_id, assignment_id, created_at) values (?, ?, null, ?)",
    [waveId, nodeId, new Date().toISOString()],
  );
}

export async function addWaveAssignment(
  root: string,
  waveId: string,
  assignmentId: string,
): Promise<void> {
  const db = await openDatabase(root);
  await run(
    db,
    "insert or ignore into wave_memberships (wave_id, node_id, assignment_id, created_at) values (?, null, ?, ?)",
    [waveId, assignmentId, new Date().toISOString()],
  );
}

export async function listWaves(root: string): Promise<QdWave[]> {
  const db = await openDatabase(root);
  return all<QdWave>(db, "select * from waves order by started_at asc");
}

export async function listWaveMemberships(root: string): Promise<QdWaveMembership[]> {
  const db = await openDatabase(root);
  return all<QdWaveMembership>(db, "select * from wave_memberships order by created_at asc");
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
