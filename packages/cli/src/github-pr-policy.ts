import {
  policyReport,
  readConfig,
  type PolicyReport,
  type PolicyViolation,
} from "@cat-cave/qdcli-core";
import { githubPrStatus, type GitHubPrStatus, type GitHubQueueStatus } from "./github-pr.js";
import type { GitHubPullRequest } from "./github-pr-model.js";

export async function githubMergePolicyReport(
  root: string,
  nodeId: string,
  options: { repo?: string } = {},
): Promise<
  PolicyReport & {
    codes: string[];
    queue: GitHubQueueStatus | null;
    pullRequest: GitHubPullRequest | null;
  }
> {
  const base = await policyReport(root, nodeId, "merge");
  const config = await readConfig(root);
  if (config.ciProvider !== "github") {
    return {
      ...base,
      codes: base.violations.map((violation) => violation.code),
      queue: null,
      pullRequest: null,
    };
  }
  let status: GitHubPrStatus;
  try {
    status = await githubPrStatus(root, nodeId, { repo: options.repo });
  } catch (error) {
    if (config.mergeQueueMode !== "required") {
      return {
        ...base,
        codes: base.violations.map((violation) => violation.code),
        queue: null,
        pullRequest: null,
      };
    }
    const violation: PolicyViolation = {
      code: "not-enqueued",
      phase: "merge",
      node_id: nodeId,
      message: `merge_queue_mode is required, but no GitHub pull request could be resolved for ${nodeId}.`,
      evidence: { error: error instanceof Error ? error.message : String(error) },
    };
    return {
      ...base,
      ok: false,
      violations: [...base.violations, violation],
      codes: [...new Set([...base.violations.map((item) => item.code), violation.code])],
      queue: null,
      pullRequest: null,
    };
  }
  const queueViolations: PolicyViolation[] = [];
  const queueCodes: string[] = [];
  if (status.queue.enabled) {
    const stateCode =
      status.queue.membership === "ejected"
        ? "ejected-from-queue"
        : status.queue.membership === "queued"
          ? "queued"
          : status.queue.membership === "not-enqueued"
            ? "not-enqueued"
            : null;
    if (stateCode) queueCodes.push(stateCode);
    if (stateCode === "not-enqueued") {
      queueViolations.push(
        queueViolation(
          nodeId,
          "not-enqueued",
          `PR #${status.pr.number} is eligible for the merge queue but is not enqueued.`,
          status,
        ),
      );
    }
    if (stateCode === "ejected-from-queue") {
      queueViolations.push(
        queueViolation(
          nodeId,
          "ejected-from-queue",
          status.queue.ejectionReason ??
            `PR #${status.pr.number} was ejected from the merge queue.`,
          status,
        ),
      );
    }
    if (status.queue.checkState === "fail") {
      queueCodes.push("merge-group-check-failed");
      queueViolations.push(
        queueViolation(
          nodeId,
          "merge-group-check-failed",
          `Merge-group checks failed for PR #${status.pr.number}.`,
          status,
        ),
      );
    }
    if (status.queue.missingRequiredChecks.length > 0) {
      queueCodes.push("queue-required-check-missing");
      queueViolations.push(
        queueViolation(
          nodeId,
          "queue-required-check-missing",
          `Merge group is missing required checks: ${status.queue.missingRequiredChecks.join(", ")}.`,
          status,
        ),
      );
    }
  } else if (config.mergeQueueMode === "required") {
    queueCodes.push("not-enqueued");
    queueViolations.push(
      queueViolation(
        nodeId,
        "not-enqueued",
        `merge_queue_mode is required, but ${status.pr.baseRefName} has no active merge queue.`,
        status,
      ),
    );
  }
  const violations = [...base.violations, ...queueViolations];
  return {
    ...base,
    ok: violations.length === 0,
    violations,
    codes: [...new Set([...base.violations.map((violation) => violation.code), ...queueCodes])],
    queue: status.queue,
    pullRequest: status.pr,
  };
}

function queueViolation(
  nodeId: string,
  code:
    | "not-enqueued"
    | "ejected-from-queue"
    | "merge-group-check-failed"
    | "queue-required-check-missing",
  message: string,
  status: GitHubPrStatus,
): PolicyViolation {
  return {
    code,
    phase: "merge",
    node_id: nodeId,
    message,
    evidence: {
      pullRequest: status.pr,
      queue: status.queue,
      branchPolicy: status.branchPolicy,
    },
  };
}
