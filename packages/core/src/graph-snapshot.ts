import { all, applyMigrations, get, openDatabase, run } from "./db.js";
import {
  assertNodeQuality,
  assertNodeRegistryValues,
  hydrateNode,
  type NodeRow,
} from "./graph-internal.js";
import { validateGraphSnapshotForWrite } from "./graph-snapshot-validation.js";
import type {
  GraphSnapshot,
  NodeNote,
  QdAssignment,
  QdEdge,
  QdFinding,
  QdRun,
  QdWave,
  QdWaveMembership,
  RegistryEntry,
} from "./types.js";

export async function graphSnapshot(root: string): Promise<GraphSnapshot> {
  const db = await openDatabase(root);
  return {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    registries: {
      groups: await listRegistrySnapshot(root, "groups"),
      projects: await listRegistrySnapshot(root, "projects"),
      milestones: await listRegistrySnapshot(root, "milestones"),
    },
    nodes: (await all<NodeRow>(db, "select * from nodes order by created_at asc")).map(hydrateNode),
    edges: await all<QdEdge>(db, "select * from edges order by created_at asc"),
    findings: await all<QdFinding>(db, "select * from findings order by created_at asc"),
    runs: await all<QdRun>(db, "select * from runs order by started_at asc"),
    node_notes: await all<NodeNote>(db, "select * from node_notes order by created_at asc"),
    assignments: await all<QdAssignment>(db, "select * from assignments order by started_at asc"),
    waves: await all<QdWave>(db, "select * from waves order by started_at asc"),
    wave_memberships: await all<QdWaveMembership>(
      db,
      "select * from wave_memberships order by created_at asc",
    ),
  };
}

export function deterministicGraphSnapshot(snapshot: GraphSnapshot): GraphSnapshot {
  const stableTime = "1970-01-01T00:00:00.000Z";
  return {
    ...snapshot,
    exported_at: stableTime,
    registries: {
      groups: snapshot.registries.groups
        .map((entry) => ({ ...entry, created_at: stableTime }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      projects: snapshot.registries.projects
        .map((entry) => ({ ...entry, created_at: stableTime }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      milestones: snapshot.registries.milestones
        .map((entry) => ({ ...entry, created_at: stableTime }))
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.name.localeCompare(b.name)),
    },
  };
}

export async function restoreGraphSnapshot(root: string, snapshot: GraphSnapshot): Promise<void> {
  await writeGraphSnapshot(root, snapshot, { replace: false });
}

export async function replaceGraphSnapshot(root: string, snapshot: GraphSnapshot): Promise<void> {
  await writeGraphSnapshot(root, snapshot, { replace: true });
}

async function writeGraphSnapshot(
  root: string,
  snapshot: GraphSnapshot,
  options: { replace: boolean },
): Promise<void> {
  const db = await openDatabase(root);
  await applyMigrations(db);
  validateGraphSnapshotForWrite(snapshot);
  const existingNode = await get<NodeRow>(db, "select * from nodes limit 1");
  if (existingNode && !options.replace) {
    throw new Error(
      "qd import requires an empty qd DAG. Remove the local .qd/qd.db cache or import into a fresh qd setup.",
    );
  }

  await run(db, "begin immediate");
  try {
    if (options.replace) await clearGraphTables(db);
    await writeRegistries(db, snapshot);
    await writeNodes(db, snapshot);
    await writeEdges(db, snapshot);
    await writeRuns(db, snapshot);
    await writeFindings(db, snapshot);
    await writeNotes(db, snapshot);
    await writeAssignments(db, snapshot);
    await writeWaves(db, snapshot);
    await run(db, "commit");
  } catch (error) {
    await run(db, "rollback");
    throw error;
  }
}

async function clearGraphTables(db: Awaited<ReturnType<typeof openDatabase>>): Promise<void> {
  for (const table of [
    "wave_memberships",
    "waves",
    "assignments",
    "node_notes",
    "findings",
    "runs",
    "edges",
    "nodes",
    "groups",
    "projects",
    "milestones",
  ]) {
    await run(db, `delete from ${table}`);
  }
}

async function listRegistrySnapshot(
  root: string,
  table: "groups" | "projects" | "milestones",
): Promise<RegistryEntry[]> {
  const db = await openDatabase(root);
  const order = table === "milestones" ? "rank asc" : "name asc";
  return all<RegistryEntry>(db, `select * from ${table} order by ${order}`);
}

async function writeRegistries(
  db: Awaited<ReturnType<typeof openDatabase>>,
  snapshot: GraphSnapshot,
): Promise<void> {
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
    await run(db, "insert or replace into milestones (name, rank, created_at) values (?, ?, ?)", [
      milestone.name,
      milestone.rank,
      milestone.created_at,
    ]);
  }
}

async function writeNodes(
  db: Awaited<ReturnType<typeof openDatabase>>,
  snapshot: GraphSnapshot,
): Promise<void> {
  for (const node of snapshot.nodes) {
    assertNodeQuality(node);
    await assertNodeRegistryValues(db, node);
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
        node.ci_command ?? null,
        node.blocked_by ?? null,
        node.blocked_reason ?? null,
        node.blocked_owner ?? null,
        node.created_at,
        node.updated_at,
        node.claimed_at,
        node.done_at,
      ],
    );
  }
}

async function writeEdges(db: Awaited<ReturnType<typeof openDatabase>>, snapshot: GraphSnapshot) {
  for (const edge of snapshot.edges) {
    await run(db, "insert into edges (from_node, to_node, type, created_at) values (?, ?, ?, ?)", [
      edge.from_node,
      edge.to_node,
      edge.type,
      edge.created_at,
    ]);
  }
}

async function writeRuns(db: Awaited<ReturnType<typeof openDatabase>>, snapshot: GraphSnapshot) {
  for (const runEntry of snapshot.runs) {
    await run(
      db,
      `insert into runs (
        id, node_id, kind, status, command, provider, exit_code, git_sha, external_id, url, rationale,
        superseded_by, report_path, audit_kind, worktree_path, agent, started_at, finished_at, summary, log_path
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runEntry.id,
        runEntry.node_id,
        runEntry.kind,
        runEntry.status,
        runEntry.command ?? null,
        runEntry.provider ?? null,
        runEntry.exit_code ?? null,
        runEntry.git_sha ?? null,
        runEntry.external_id ?? null,
        runEntry.url ?? null,
        runEntry.rationale ?? null,
        runEntry.superseded_by ?? null,
        runEntry.report_path ?? null,
        runEntry.audit_kind ?? null,
        runEntry.worktree_path,
        runEntry.agent,
        runEntry.started_at,
        runEntry.finished_at,
        runEntry.summary,
        runEntry.log_path,
      ],
    );
  }
}

async function writeFindings(
  db: Awaited<ReturnType<typeof openDatabase>>,
  snapshot: GraphSnapshot,
) {
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
}

async function writeNotes(db: Awaited<ReturnType<typeof openDatabase>>, snapshot: GraphSnapshot) {
  for (const note of snapshot.node_notes) {
    await run(
      db,
      "insert into node_notes (id, node_id, kind, text, evidence, created_at) values (?, ?, ?, ?, ?, ?)",
      [
        note.id,
        note.node_id,
        note.kind ?? "note",
        note.text,
        note.evidence ?? null,
        note.created_at,
      ],
    );
  }
}

async function writeAssignments(
  db: Awaited<ReturnType<typeof openDatabase>>,
  snapshot: GraphSnapshot,
) {
  for (const assignment of snapshot.assignments ?? []) {
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
  }
}

async function writeWaves(db: Awaited<ReturnType<typeof openDatabase>>, snapshot: GraphSnapshot) {
  for (const wave of snapshot.waves ?? []) {
    await run(
      db,
      "insert into waves (id, kind, status, summary, started_at, finished_at) values (?, ?, ?, ?, ?, ?)",
      [wave.id, wave.kind, wave.status, wave.summary, wave.started_at, wave.finished_at],
    );
  }
  for (const membership of snapshot.wave_memberships ?? []) {
    await run(
      db,
      "insert into wave_memberships (wave_id, node_id, assignment_id, created_at) values (?, ?, ?, ?)",
      [membership.wave_id, membership.node_id, membership.assignment_id, membership.created_at],
    );
  }
}
