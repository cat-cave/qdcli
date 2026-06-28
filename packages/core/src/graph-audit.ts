import { randomUUID } from "node:crypto";
import { all, get, openDatabase, run } from "./db.js";
import { assertNodeExists, hydrateNode, type NodeRow } from "./graph-internal.js";
import type { GateExplanation } from "./graph-types.js";
import { addNodeNote } from "./graph-notes.js";
import { getNode, setNodeStatus } from "./graph-nodes.js";
import type { Priority, QdFinding, QdNode, QdRun, RunKind } from "./types.js";

export async function startRun(
  root: string,
  nodeId: string,
  kind: RunKind,
  input: {
    agent?: string | null;
    worktreePath?: string | null;
    summary?: string | null;
    logPath?: string | null;
    command?: string | null;
    provider?: string | null;
    gitSha?: string | null;
    externalId?: string | null;
    url?: string | null;
    auditKind?: string | null;
    reportPath?: string | null;
  } = {},
): Promise<QdRun> {
  const db = await openDatabase(root);
  await assertNodeExists(db, nodeId);
  const runRow: QdRun = {
    id: randomUUID(),
    node_id: nodeId,
    kind,
    status: "running",
    command: input.command ?? null,
    provider: input.provider ?? null,
    exit_code: null,
    git_sha: input.gitSha ?? null,
    external_id: input.externalId ?? null,
    url: input.url ?? null,
    rationale: null,
    superseded_by: null,
    report_path: input.reportPath ?? null,
    audit_kind: input.auditKind ?? null,
    worktree_path: input.worktreePath ?? null,
    agent: input.agent ?? null,
    started_at: new Date().toISOString(),
    finished_at: null,
    summary: input.summary ?? null,
    log_path: input.logPath ?? null,
  };
  await run(
    db,
    `insert into runs (
      id, node_id, kind, status, command, provider, exit_code, git_sha, external_id, url, rationale,
      superseded_by, report_path, audit_kind, worktree_path, agent, started_at, finished_at, summary, log_path
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runRow.id,
      runRow.node_id,
      runRow.kind,
      runRow.status,
      runRow.command,
      runRow.provider,
      runRow.exit_code,
      runRow.git_sha,
      runRow.external_id,
      runRow.url,
      runRow.rationale,
      runRow.superseded_by,
      runRow.report_path,
      runRow.audit_kind,
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

export async function disposeFinding(
  root: string,
  findingId: string,
  input: { status: "resolved" | "promoted" | "dismissed"; rationale: string },
): Promise<QdFinding> {
  const db = await openDatabase(root);
  await run(db, "update findings set status = ?, resolved_at = ? where id = ?", [
    input.status,
    new Date().toISOString(),
    findingId,
  ]);
  const finding = await get<QdFinding>(db, "select * from findings where id = ?", [findingId]);
  if (!finding) throw new Error(`Finding not found: ${findingId}`);
  await addNodeNote(
    root,
    finding.node_id,
    `Finding ${findingId} disposed as ${input.status}: ${input.rationale}`,
    { kind: "audit-disposition" },
  );
  return finding;
}

export async function gateNode(
  root: string,
  nodeId: string,
  options: { ignoreRunningAuditRunId?: string | null; ignoreNodeBlocker?: boolean } = {},
): Promise<{
  ok: boolean;
  blocking: QdFinding[];
  runningAudits: QdRun[];
  blockedDependencies: QdNode[];
  explanations: GateExplanation[];
}> {
  const db = await openDatabase(root);
  const node = await getNode(root, nodeId);
  const blocking = await all<QdFinding>(
    db,
    "select * from findings where node_id = ? and status = 'open' and severity in ('P0', 'P1') order by created_at asc",
    [nodeId],
  );
  const runningAudits = (
    await all<QdRun>(
      db,
      "select * from runs where node_id = ? and kind = 'audit' and status = 'running' order by started_at asc",
      [nodeId],
    )
  ).filter((runRow) => runRow.id !== options.ignoreRunningAuditRunId);
  const blockedDependencies = (
    await all<NodeRow>(
      db,
      `select dep.*
      from edges e
      join nodes dep on dep.id = e.from_node
      where e.to_node = ? and e.type = 'requires' and dep.status <> 'done'
      order by dep.id asc`,
      [nodeId],
    )
  ).map(hydrateNode);
  const explanations: GateExplanation[] = [
    ...blocking.map((finding) => ({
      code: "blockingFinding" as const,
      node_id: nodeId,
      message: `Open ${finding.severity} finding blocks ${nodeId}: ${finding.title}`,
      evidence: { finding },
    })),
    ...runningAudits.map((runRow) => ({
      code: "runningAudit" as const,
      node_id: nodeId,
      message: `Running audit ${runRow.id} blocks ${nodeId}.`,
      evidence: { run: runRow },
    })),
    ...blockedDependencies.map((dependency) => ({
      code: "blockedDependency" as const,
      node_id: nodeId,
      message: `Dependency ${dependency.id} is ${dependency.status}, not done.`,
      evidence: { dependency },
    })),
  ];
  if (!options.ignoreNodeBlocker && node.status === "blocked") {
    explanations.push({
      code: "nodeBlocked",
      node_id: nodeId,
      message: `Node ${nodeId} is blocked${node.blocked_by ? ` by ${node.blocked_by}` : ""}: ${
        node.blocked_reason ?? "no blocker reason recorded"
      }`,
      evidence: {
        blocked_by: node.blocked_by,
        blocked_reason: node.blocked_reason,
        blocked_owner: node.blocked_owner,
      },
    });
  }
  return {
    ok: explanations.length === 0,
    blocking,
    runningAudits,
    blockedDependencies,
    explanations,
  };
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
