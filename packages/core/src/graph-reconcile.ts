import { randomUUID } from "node:crypto";
import { all, get, openDatabase, run, type Database } from "./db.js";
import { hydrateNode, type NodeRow } from "./graph-internal.js";
import type { Priority, QdFinding, QdNode, QdRun } from "./types.js";

export interface ReconcileFindingInput {
  severity: Priority;
  title: string;
  evidence: string;
  path?: string | null;
  line?: number | null;
  expected?: string | null;
  suggestedFix?: string | null;
}

export interface ReconcileVerificationInput {
  command: string;
  summary: string;
  evidence: string;
}

export interface ReconcileCiInput {
  summary: string;
  provider: string;
  gitSha: string;
  externalId?: string | null;
  url?: string | null;
  logPath?: string | null;
}

export interface ReconcileNodeInput {
  commitSha: string;
  completionSummary: string;
  reportPath: string;
  auditSummary: string;
  auditPassed: boolean;
  auditor: string;
  findings: ReconcileFindingInput[];
  verification: ReconcileVerificationInput[];
  ci?: ReconcileCiInput;
}

export interface ReconcileNodeResult {
  ok: boolean;
  idempotent: boolean;
  stoppedAt: "review" | "done";
  node: QdNode;
  runs: QdRun[];
  findings: QdFinding[];
}

interface ReconcileRunInput {
  command?: string | null;
  provider?: string | null;
  exitCode?: number | null;
  gitSha?: string | null;
  externalId?: string | null;
  url?: string | null;
  rationale?: string | null;
  reportPath?: string | null;
  auditKind?: string | null;
  agent?: string | null;
  summary?: string | null;
  logPath?: string | null;
}

export async function reconcileNode(
  root: string,
  nodeId: string,
  input: ReconcileNodeInput,
): Promise<ReconcileNodeResult> {
  const db = await openDatabase(root);
  await run(db, "begin immediate");
  let transactionOpen = true;
  try {
    const row = await get<NodeRow>(db, "select * from nodes where id = ?", [nodeId]);
    if (!row) throw new Error(`Node not found: ${nodeId}`);
    const node = hydrateNode(row);
    const idempotent = await idempotentReconciliation(db, node, input.commitSha);
    if (idempotent) {
      await run(db, "commit");
      transactionOpen = false;
      return {
        ok: true,
        idempotent: true,
        stoppedAt: "done",
        node,
        runs: [],
        findings: [],
      };
    }
    assertReconcileStatus(node);
    await assertReconcileGates(db, nodeId);
    assertVerificationMatches(node, input.verification);

    const now = new Date().toISOString();
    const runs: QdRun[] = [];
    if (!["review", "mergeable"].includes(node.status)) {
      runs.push(
        await insertReconcileRun(db, nodeId, "implement", "completed", now, {
          summary: input.completionSummary,
          reportPath: input.reportPath,
        }),
      );
    }
    const auditRun = await insertReconcileRun(
      db,
      nodeId,
      "audit",
      input.auditPassed ? "passed" : "failed",
      now,
      {
        summary: input.auditSummary,
        reportPath: input.reportPath,
        agent: input.auditor,
        auditKind: "reconciliation",
      },
    );
    runs.push(auditRun);
    const findings = await insertReconcileFindings(db, nodeId, auditRun.id, input.findings, now);

    if (!input.auditPassed) {
      await run(db, "update nodes set status = 'review', updated_at = ? where id = ?", [
        now,
        nodeId,
      ]);
      await run(db, "commit");
      transactionOpen = false;
      return {
        ok: false,
        idempotent: false,
        stoppedAt: "review",
        node: await nodeFromDatabase(db, nodeId),
        runs,
        findings,
      };
    }

    if (!input.ci) throw new Error("A passed reconciliation requires CI evidence");
    for (const entry of input.verification) {
      runs.push(
        await insertReconcileRun(db, nodeId, "verification", "passed", now, {
          command: entry.command,
          provider: "reconciliation-report",
          summary: entry.summary,
          reportPath: entry.evidence,
        }),
      );
    }
    runs.push(
      await insertReconcileRun(db, nodeId, "ci", "passed", now, {
        summary: input.ci.summary,
        provider: input.ci.provider,
        gitSha: input.ci.gitSha,
        externalId: input.ci.externalId,
        url: input.ci.url,
        logPath: input.ci.logPath,
      }),
    );
    runs.push(
      await insertReconcileRun(db, nodeId, "merge", "recorded", now, {
        summary: `Merge recorded from reconciliation at commit ${input.commitSha}`,
        provider: "reconciliation",
        gitSha: input.commitSha,
        reportPath: input.reportPath,
      }),
    );
    await run(db, "update nodes set status = 'done', done_at = ?, updated_at = ? where id = ?", [
      now,
      now,
      nodeId,
    ]);
    await run(db, "commit");
    transactionOpen = false;
    return {
      ok: true,
      idempotent: false,
      stoppedAt: "done",
      node: await nodeFromDatabase(db, nodeId),
      runs,
      findings,
    };
  } catch (error) {
    if (transactionOpen) await run(db, "rollback");
    throw error;
  } finally {
    await db.close();
  }
}

function assertReconcileStatus(node: QdNode): void {
  if (["blocked", "cancelled", "regressed", "draft"].includes(node.status)) {
    throw new Error(`Cannot reconcile node with status ${node.status}`);
  }
}

async function assertReconcileGates(db: Database, nodeId: string): Promise<void> {
  const dependencies = await all<{ id: string; status: string }>(
    db,
    `select dep.id, dep.status from edges e join nodes dep on dep.id = e.from_node
     where e.to_node = ? and e.type = 'requires' and dep.status <> 'done' order by dep.id`,
    [nodeId],
  );
  if (dependencies.length > 0) {
    throw new Error(
      `Cannot reconcile while dependencies are incomplete: ${dependencies.map((item) => `${item.id} (${item.status})`).join(", ")}`,
    );
  }
  const findings = await all<QdFinding>(
    db,
    "select * from findings where node_id = ? and status = 'open' order by created_at",
    [nodeId],
  );
  if (findings.length > 0) {
    throw new Error(
      `Cannot reconcile with existing open findings: ${findings.map((item) => item.id).join(", ")}`,
    );
  }
  const runningAudits = await all<QdRun>(
    db,
    "select * from runs where node_id = ? and kind = 'audit' and status = 'running'",
    [nodeId],
  );
  if (runningAudits.length > 0) {
    throw new Error(
      `Cannot reconcile while audit runs are active: ${runningAudits.map((item) => item.id).join(", ")}`,
    );
  }
}

function assertVerificationMatches(node: QdNode, entries: ReconcileVerificationInput[]): void {
  const expected = node.verification.map((entry) =>
    entry.type === "command" ? entry.value : `${entry.type}:${entry.value}`,
  );
  const actual = entries.map((entry) => entry.command);
  if (
    expected.length !== actual.length ||
    expected.some((command, index) => command !== actual[index])
  ) {
    throw new Error(
      "Reconciliation verification evidence does not match the declared verification set",
    );
  }
}

async function idempotentReconciliation(
  db: Database,
  node: QdNode,
  commitSha: string,
): Promise<boolean> {
  if (node.status !== "done") return false;
  const mergeRun = await get<QdRun>(
    db,
    "select * from runs where node_id = ? and kind = 'merge' order by started_at desc limit 1",
    [node.id],
  );
  const recorded = mergeRun?.git_sha ?? mergeRun?.summary?.match(/\b[0-9a-f]{7,40}\b/i)?.[0];
  if (recorded === commitSha) return true;
  throw new Error(
    `Node ${node.id} is already done at ${recorded ?? "an unknown commit"}; refusing to reconcile ${commitSha}`,
  );
}

async function insertReconcileRun(
  db: Database,
  nodeId: string,
  kind: QdRun["kind"],
  status: string,
  now: string,
  input: ReconcileRunInput,
): Promise<QdRun> {
  const row: QdRun = {
    id: randomUUID(),
    node_id: nodeId,
    kind,
    status,
    command: input.command ?? null,
    provider: input.provider ?? null,
    exit_code: input.exitCode ?? null,
    git_sha: input.gitSha ?? null,
    external_id: input.externalId ?? null,
    url: input.url ?? null,
    rationale: input.rationale ?? null,
    superseded_by: null,
    report_path: input.reportPath ?? null,
    audit_kind: input.auditKind ?? null,
    worktree_path: null,
    agent: input.agent ?? null,
    started_at: now,
    finished_at: now,
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
      row.id,
      row.node_id,
      row.kind,
      row.status,
      row.command,
      row.provider,
      row.exit_code,
      row.git_sha,
      row.external_id,
      row.url,
      row.rationale,
      row.superseded_by,
      row.report_path,
      row.audit_kind,
      row.worktree_path,
      row.agent,
      row.started_at,
      row.finished_at,
      row.summary,
      row.log_path,
    ],
  );
  return row;
}

async function insertReconcileFindings(
  db: Database,
  nodeId: string,
  runId: string,
  inputs: ReconcileFindingInput[],
  now: string,
): Promise<QdFinding[]> {
  const findings: QdFinding[] = [];
  for (const input of inputs) {
    const finding: QdFinding = {
      id: randomUUID(),
      node_id: nodeId,
      run_id: runId,
      severity: input.severity,
      status: "open",
      title: input.title,
      path: input.path ?? null,
      line: input.line ?? null,
      evidence: input.evidence,
      expected: input.expected ?? null,
      suggested_fix: input.suggestedFix ?? null,
      created_at: now,
      resolved_at: null,
    };
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
    findings.push(finding);
  }
  return findings;
}

async function nodeFromDatabase(db: Database, nodeId: string): Promise<QdNode> {
  const row = await get<NodeRow>(db, "select * from nodes where id = ?", [nodeId]);
  if (!row) throw new Error(`Node not found: ${nodeId}`);
  return hydrateNode(row);
}
