import {
  gateNode,
  getNode,
  latestRun,
  listFindings,
  listRuns,
  policyReport,
  readConfig,
  type PolicyViolation,
} from "@cat-cave/qdcli-core";
import { output } from "./args.js";
import { verificationRunCommandKey } from "./verification.js";
import { githubPrStatus, type GitHubPrStatus } from "./github-pr.js";

export interface NodeDoctorReason {
  code: string;
  message: string;
  evidence?: unknown;
  verificationIndex?: number;
}

export async function nodeDoctorCommand(
  root: string,
  nodeId: string,
  json: boolean,
): Promise<void> {
  const node = await getNode(root, nodeId);
  const [gate, ciPolicy, mergePolicy, runs, openFindings] = await Promise.all([
    gateNode(root, nodeId),
    policyReport(root, nodeId, "ci"),
    policyReport(root, nodeId, "merge"),
    listRuns(root, { nodeId }),
    listFindings(root, { nodeId, status: "open" }),
  ]);
  const passedVerification = new Set(
    runs
      .filter((runRow) => runRow.kind === "verification" && runRow.status === "passed")
      .map((runRow) => runRow.command),
  );
  const verification = node.verification.map((entry, offset) => ({
    index: offset + 1,
    ...entry,
    signed: passedVerification.has(verificationRunCommandKey(entry)),
  }));
  const reasons = nodeDoctorReasons(
    node.status,
    gate.explanations,
    ciPolicy.violations,
    mergePolicy.violations,
  );
  for (const entry of verification.filter((item) => !item.signed)) {
    reasons.set(`verificationRequired:${entry.index}`, {
      code: "verificationRequired",
      verificationIndex: entry.index,
      message: `Declared verification #${entry.index} (${entry.type}: ${entry.value}) is unsigned.`,
      evidence: { verification: entry },
    });
  }
  if (node.status === "mergeable" && mergePolicy.ok) {
    reasons.set("mergeRecordRequired", {
      code: "mergeRecordRequired",
      message: "The real repository integration and qd merge record are still required.",
    });
  }
  let pullRequest: GitHubPrStatus | { error: string } | null = null;
  const config = await readConfig(root);
  if (node.status !== "done" && config.ciProvider === "github" && (node.pr_url || node.branch)) {
    try {
      pullRequest = await githubPrStatus(root, node, { persist: false });
      if (pullRequest.behind > 0 && !pullRequest.behindIgnoredByQueue) {
        reasons.set("staleBase", {
          code: "staleBase",
          message: `PR #${pullRequest.pr.number} is ${pullRequest.behind} commit(s) behind ${pullRequest.pr.baseRefName}.`,
          evidence: { behind: pullRequest.behind, pullRequest: pullRequest.pr },
        });
      }
      if (pullRequest.queue.membership === "ejected") {
        reasons.set("ejected-from-queue", {
          code: "ejected-from-queue",
          message:
            pullRequest.queue.ejectionReason ??
            `PR #${pullRequest.pr.number} was ejected from the merge queue.`,
          evidence: { queue: pullRequest.queue },
        });
      }
      if (pullRequest.queue.checkState === "fail") {
        reasons.set("merge-group-check-failed", {
          code: "merge-group-check-failed",
          message: `Merge-group checks failed for PR #${pullRequest.pr.number}.`,
          evidence: { queue: pullRequest.queue },
        });
      }
      if (pullRequest.queue.missingRequiredChecks.length > 0) {
        reasons.set("queue-required-check-missing", {
          code: "queue-required-check-missing",
          message: `Merge group is missing required checks: ${pullRequest.queue.missingRequiredChecks.join(", ")}.`,
          evidence: { queue: pullRequest.queue },
        });
      }
      if (node.status === "queued" && pullRequest.queue.membership !== "ejected") {
        reasons.set("queued", {
          code: "queued",
          message: `PR #${pullRequest.pr.number} is waiting for GitHub's merge queue to complete.`,
          evidence: { queue: pullRequest.queue },
        });
      }
    } catch (error) {
      pullRequest = { error: error instanceof Error ? error.message : String(error) };
      reasons.set("prStatusUnavailable", {
        code: "prStatusUnavailable",
        message: pullRequest.error,
      });
    }
  }
  const reasonList = [...reasons.values()];
  const nextActions = doctorNextActions(
    nodeId,
    node.status,
    reasonList,
    pullRequest !== null && !("error" in pullRequest),
  );
  const latest = {
    audit: (await latestRun(root, nodeId, "audit")) ?? null,
    check: (await latestRun(root, nodeId, "check")) ?? null,
    ci: (await latestRun(root, nodeId, "ci")) ?? null,
    merge: (await latestRun(root, nodeId, "merge")) ?? null,
  };
  const result = {
    ok: node.status === "done" && reasonList.length === 0,
    nodeId,
    status: node.status,
    reasons: reasonList,
    nextActions,
    verification,
    latest,
    openFindings,
    gate,
    policy: { ci: ciPolicy, merge: mergePolicy },
    pullRequest,
  };
  output(result, json);
  if (!result.ok) process.exitCode = 1;
}

export function nodeDoctorReasons(
  status: string,
  gateExplanations: Array<{ code: string; message: string; evidence?: unknown }>,
  ciViolations: PolicyViolation[],
  mergeViolations: PolicyViolation[],
): Map<string, NodeDoctorReason> {
  const reasons = new Map<string, NodeDoctorReason>();
  for (const explanation of gateExplanations) {
    reasons.set(explanation.code, explanation);
  }
  const relevantPolicy =
    status === "mergeable" || status === "queued" || status === "done"
      ? mergeViolations
      : ciViolations;
  for (const violation of relevantPolicy) {
    reasons.set(violation.code, {
      code: violation.code,
      message: violation.message,
      evidence: violation.evidence,
    });
  }
  if (!["review", "mergeable", "queued", "done", "blocked", "cancelled"].includes(status)) {
    reasons.set("completionRequired", {
      code: "completionRequired",
      message: `Node status ${status} has not recorded evidence-backed completion.`,
    });
  }
  if (status === "cancelled") {
    reasons.set("nodeCancelled", {
      code: "nodeCancelled",
      message: "The node is cancelled and cannot advance.",
    });
  }
  return reasons;
}

export function doctorNextActions(
  nodeId: string,
  status: string,
  reasons: NodeDoctorReason[],
  hasPullRequest: boolean,
): string[] {
  const codes = new Set(reasons.map((reason) => reason.code));
  const actions: string[] = [];
  if (codes.has("completionRequired")) {
    actions.push(`qd complete ${nodeId} --from-report <completion-report.json>`);
  }
  if (codes.has("auditRequired")) {
    actions.push(`qd audit start ${nodeId}`);
    actions.push(`qd audit pass ${nodeId} --from-report <audit-report.json>`);
  }
  for (const reason of reasons.filter((item) => item.code === "verificationRequired")) {
    if (reason.verificationIndex) {
      actions.push(
        `qd verification sign-off ${nodeId} --index ${reason.verificationIndex} --note <what-was-checked> --evidence <path-or-url>`,
      );
    }
  }
  if (codes.has("ciRequired")) actions.push(`qd ci run ${nodeId}`);
  if (codes.has("followupDispositionRequired")) {
    actions.push(`qd finding list --node ${nodeId} --open`);
  }
  if (codes.has("staleBase")) actions.push("qd sync-prs --rebase");
  if (codes.has("queued")) actions.push(`qd queue watch ${nodeId}`);
  if (codes.has("ejected-from-queue") || codes.has("merge-group-check-failed")) {
    actions.push(`qd queue bisect ${nodeId}`);
    actions.push(`qd complete ${nodeId} --from-report <completion-report.json>`);
  }
  if (codes.has("blockingFinding")) actions.push(`qd finding list --node ${nodeId} --open`);
  if (codes.has("runningAudit")) {
    actions.push(`qd audit pass ${nodeId} --from-report <audit-report.json>`);
  }
  if (status === "mergeable" && codes.has("mergeRecordRequired")) {
    actions.push(
      hasPullRequest
        ? `qd merge ${nodeId} --via-pr`
        : `qd merge ${nodeId} --use-existing-commit <sha>`,
    );
  }
  return [...new Set(actions)];
}
