import { randomUUID } from "node:crypto";
import { all, openDatabase, readConfig, run } from "./db.js";
import { addNodeNote } from "./graph-notes.js";
import { addNode, getNode, getRun, listFindings, listRuns } from "./graph-nodes.js";
import { gateNode, latestRun } from "./graph-audit.js";
import type {
  BlockerType,
  PolicyPhase,
  PolicyReport,
  PolicyViolation,
  PromotedFinding,
  QdFinding,
  QdNode,
  VerificationEntry,
} from "./types.js";

export interface BlockNodeInput {
  type: BlockerType;
  reason: string;
  owner: string;
  needed: string;
  evidence: string;
}

export async function policyReport(
  root: string,
  nodeId: string,
  phase: PolicyPhase,
): Promise<PolicyReport> {
  const config = await readConfig(root);
  const node = await getNode(root, nodeId);
  const violations: PolicyViolation[] = [];
  if (phase === "ci" || phase === "merge") {
    if (config.policy.requireAuditBeforeCi) {
      const latestAudit = await latestRun(root, nodeId, "audit");
      if (!latestAudit || latestAudit.status !== "passed") {
        violations.push({
          code: "auditRequired",
          phase,
          node_id: nodeId,
          message: `Node ${nodeId} needs a passed audit before ${phase}.`,
          evidence: latestAudit ? { latestAudit } : { latestAudit: null },
        });
      }
    }
    if (config.policy.requireVerificationBeforeCi) {
      const missing = await missingVerificationEntries(root, node);
      if (missing.length > 0) {
        violations.push({
          code: "verificationRequired",
          phase,
          node_id: nodeId,
          message: `Node ${nodeId} is missing ${missing.length} declared verification sign-off(s).`,
          evidence: { missing },
        });
      }
    }
  }
  if (phase === "merge") {
    if (config.requireCiBeforeMerge) {
      const latestCi = await latestRun(root, nodeId, "ci");
      if (!latestCi || latestCi.status !== "passed") {
        violations.push({
          code: "ciRequired",
          phase,
          node_id: nodeId,
          message: `Node ${nodeId} needs a latest passed CI run before merge.`,
          evidence: latestCi ? { latestCi } : { latestCi: null },
        });
      }
    }
    if (config.policy.requireP2P3DispositionBeforeMerge) {
      const openFollowups = await listFindings(root, {
        nodeId,
        status: "open",
        severities: ["P2", "P3"],
      });
      if (openFollowups.length > 0) {
        violations.push({
          code: "followupDispositionRequired",
          phase,
          node_id: nodeId,
          message: `Node ${nodeId} has open P2/P3 findings that must be promoted, resolved, or dismissed before merge.`,
          evidence: { findings: openFollowups },
        });
      }
    }
  }
  return { ok: violations.length === 0, phase, node_id: nodeId, violations };
}

export async function promoteFindings(root: string, nodeId: string): Promise<PromotedFinding[]> {
  const db = await openDatabase(root);
  const gate = await gateNode(root, nodeId, { ignoreNodeBlocker: true });
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
    provider?: string | null;
    gitSha?: string | null;
    externalId?: string | null;
    url?: string | null;
    startedAt?: string;
    finishedAt?: string;
  },
): Promise<QdNode> {
  if (input.status === "passed") {
    const policy = await policyReport(root, nodeId, "ci");
    if (!policy.ok) throw new Error(policy.violations.map((item) => item.message).join("; "));
  }
  const db = await openDatabase(root);
  const current = await getNode(root, nodeId);
  const now = new Date().toISOString();
  const startedAt = input.startedAt ?? now;
  const finishedAt = input.finishedAt ?? now;
  await recordRunResult(
    db,
    nodeId,
    "ci",
    input.status,
    input.summary,
    input.logPath,
    startedAt,
    finishedAt,
    {
      provider: input.provider,
      gitSha: input.gitSha,
      externalId: input.externalId,
      url: input.url,
    },
  );
  const nextStatus =
    input.status === "passed"
      ? current.status === "done"
        ? "done"
        : "mergeable"
      : current.status === "done"
        ? "regressed"
        : "blocked";
  await run(db, "update nodes set status = ?, updated_at = ? where id = ?", [
    nextStatus,
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
  const current = await getNode(root, nodeId);
  const now = new Date().toISOString();
  const startedAt = input.startedAt ?? now;
  const finishedAt = input.finishedAt ?? now;
  await recordRunResult(
    db,
    nodeId,
    "check",
    input.status,
    input.summary,
    input.logPath,
    startedAt,
    finishedAt,
  );
  if (input.status === "failed") {
    await run(db, "update nodes set status = 'blocked', updated_at = ? where id = ?", [
      finishedAt,
      nodeId,
    ]);
  } else if (current.status === "blocked") {
    const gate = await gateNode(root, nodeId, {
      ignoreRunningAuditRunId: null,
      ignoreNodeBlocker: current.blocked_by === null,
    });
    if (gate.ok) {
      await run(db, "update nodes set status = 'review', updated_at = ? where id = ?", [
        finishedAt,
        nodeId,
      ]);
    }
  }
  return getNode(root, nodeId);
}

export async function blockNode(
  root: string,
  nodeId: string,
  input: BlockNodeInput,
): Promise<QdNode> {
  if (!input.reason.trim()) throw new Error("block reason is required");
  if (!input.owner.trim()) throw new Error("block owner is required");
  if (!input.needed.trim()) throw new Error("block needed action is required");
  if (!input.evidence.trim()) throw new Error("block evidence is required");
  const db = await openDatabase(root);
  const now = new Date().toISOString();
  await run(
    db,
    "update nodes set status = 'blocked', blocked_by = ?, blocked_reason = ?, blocked_owner = ?, updated_at = ? where id = ?",
    [input.type, input.reason, input.owner, now, nodeId],
  );
  await addNodeNote(
    root,
    nodeId,
    [`Blocked by ${input.type}: ${input.reason}`, `Needed: ${input.needed}`].join("\n"),
    { kind: "blocker", evidence: input.evidence },
  );
  return getNode(root, nodeId);
}

export async function ciFail(root: string, nodeId: string, summary = "CI failed"): Promise<QdNode> {
  const db = await openDatabase(root);
  const current = await getNode(root, nodeId);
  const now = new Date().toISOString();
  await run(
    db,
    "insert into runs (id, node_id, kind, status, started_at, finished_at, summary) values (?, ?, 'ci', 'failed', ?, ?, ?)",
    [randomUUID(), nodeId, now, now, summary],
  );
  await run(db, "update nodes set status = ?, updated_at = ? where id = ?", [
    current.status === "done" ? "regressed" : "blocked",
    now,
    nodeId,
  ]);
  return getNode(root, nodeId);
}

export async function unblockNode(
  root: string,
  nodeId: string,
  input: { fromRunId?: string | null; summary: string; evidence?: string | null },
): Promise<QdNode> {
  const node = await getNode(root, nodeId);
  if (node.status !== "blocked") throw new Error(`Cannot unblock node with status ${node.status}`);
  if (!input.summary.trim()) throw new Error("unblock summary is required");
  if (!input.fromRunId && !input.evidence?.trim()) {
    throw new Error("unblock requires --from-run <passed-run> or --evidence <path-or-proof>");
  }
  let evidence = input.evidence ?? null;
  if (input.fromRunId) {
    const runRow = await getRun(root, input.fromRunId);
    if (runRow.node_id !== nodeId) throw new Error(`Run ${runRow.id} does not belong to ${nodeId}`);
    if (runRow.status !== "passed") throw new Error(`Run ${runRow.id} is not passed`);
    evidence = evidence ?? `run:${input.fromRunId}`;
  }
  const gate = await gateNode(root, nodeId, { ignoreNodeBlocker: true });
  if (!gate.ok) throw new Error("Cannot unblock while qd gate is blocked");
  const db = await openDatabase(root);
  const now = new Date().toISOString();
  await run(
    db,
    "update nodes set status = 'ready', blocked_by = null, blocked_reason = null, blocked_owner = null, updated_at = ? where id = ?",
    [now, nodeId],
  );
  await addNodeNote(root, nodeId, input.summary, {
    kind: "retry",
    evidence,
  });
  return getNode(root, nodeId);
}

export async function markMerged(
  root: string,
  nodeId: string,
  strategy: string,
  input: { commitSha?: string | null } = {},
): Promise<QdNode> {
  const config = await readConfig(root);
  const node = await getNode(root, nodeId);
  if (node.status !== "mergeable")
    throw new Error(`Cannot merge node with status ${node.status}; expected mergeable`);
  const gate = await gateNode(root, nodeId);
  if (!gate.ok)
    throw new Error(
      `Cannot merge while qd gate is blocked: ${gate.explanations.map((item) => item.message).join("; ")}`,
    );
  const policy = await policyReport(root, nodeId, "merge");
  if (!policy.ok) throw new Error(policy.violations.map((item) => item.message).join("; "));
  if (config.policy.requireMergeCommit && !input.commitSha?.trim()) {
    throw new Error(
      "Cannot merge without --use-existing-commit <sha> or --already-merged-at <sha>",
    );
  }
  const db = await openDatabase(root);
  const now = new Date().toISOString();
  await run(
    db,
    "insert into runs (id, node_id, kind, status, git_sha, started_at, finished_at, summary) values (?, ?, 'merge', 'recorded', ?, ?, ?, ?)",
    [
      randomUUID(),
      nodeId,
      input.commitSha ?? null,
      now,
      now,
      input.commitSha
        ? `Merge recorded with ${strategy} at commit ${input.commitSha}`
        : `Merge recorded with ${strategy}`,
    ],
  );
  await run(db, "update nodes set status = 'done', done_at = ?, updated_at = ? where id = ?", [
    now,
    now,
    nodeId,
  ]);
  return getNode(root, nodeId);
}

async function missingVerificationEntries(
  root: string,
  node: QdNode,
): Promise<VerificationEntry[]> {
  if (node.verification.length === 0) return [];
  const passedRuns = (await listRuns(root, { nodeId: node.id, kind: "verification" })).filter(
    (runRow) => runRow.status === "passed",
  );
  return node.verification.filter((entry) => {
    const expectedCommand = entry.type === "command" ? entry.value : `${entry.type}:${entry.value}`;
    return !passedRuns.some((runRow) => runRow.command === expectedCommand);
  });
}

async function recordRunResult(
  db: Awaited<ReturnType<typeof openDatabase>>,
  nodeId: string,
  kind: "ci" | "check",
  status: "passed" | "failed",
  summary: string,
  logPath: string | null | undefined,
  startedAt: string,
  finishedAt: string,
  evidence: {
    provider?: string | null;
    gitSha?: string | null;
    externalId?: string | null;
    url?: string | null;
  } = {},
): Promise<void> {
  await run(
    db,
    `insert into runs (
      id, node_id, kind, status, provider, git_sha, external_id, url,
      started_at, finished_at, summary, log_path
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      nodeId,
      kind,
      status,
      evidence.provider ?? null,
      evidence.gitSha ?? null,
      evidence.externalId ?? null,
      evidence.url ?? null,
      startedAt,
      finishedAt,
      summary,
      logPath ?? null,
    ],
  );
}
