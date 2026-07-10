import { getNode, reconcileNode } from "@cat-cave/qdcli-core";
import { output, required, requiredArg } from "./args.js";
import { readJson } from "./file-io.js";
import { validateReconciliationReport } from "./reconciliation-report.js";
import { captureCommand } from "./shell.js";
import { assertCompleteVerificationCoverage, verificationRunCommandKey } from "./verification.js";

export async function reconcileCommand(
  root: string,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const id = requiredArg(nodeId, "node id");
  const commitSha = required(options.commit, "--commit");
  const reportPath = required(options["from-report"], "--from-report");
  const report = validateReconciliationReport(await readJson(root, reportPath));
  if (report.nodeId !== id) {
    throw new Error(`reconciliation report nodeId ${report.nodeId} does not match ${id}`);
  }
  await assertCommitIntegrated(root, commitSha);
  if (report.ci && report.ci.gitSha !== commitSha) {
    throw new Error(
      `reconciliation CI gitSha ${report.ci.gitSha} does not match --commit ${commitSha}`,
    );
  }
  const node = await getNode(root, id);
  assertCompleteVerificationCoverage(node.verification, report.verification, id);
  const result = await reconcileNode(root, id, {
    commitSha,
    completionSummary: report.completionSummary,
    reportPath,
    auditSummary: report.auditSummary,
    auditPassed: report.auditPassed,
    auditor: report.auditor,
    findings: report.findings,
    verification: report.verification.map((entry) => {
      const declared = node.verification[entry.index - 1];
      if (!declared) throw new Error(`verification index ${entry.index} is out of range`);
      return {
        command: verificationRunCommandKey(declared),
        summary: entry.summary,
        evidence: entry.evidence,
      };
    }),
    ci: report.ci,
  });
  output(
    {
      ...result,
      commit: commitSha,
      operation: "ledger-reconciliation",
      gitIntegrated: true,
      nextActions: result.ok
        ? []
        : [
            `Resolve or promote the recorded findings for ${id}.`,
            `Rerun qd reconcile ${id} --commit ${commitSha} --from-report <clean-reconciliation.json>.`,
          ],
    },
    json,
  );
  if (!result.ok) process.exitCode = 1;
}

export async function assertCommitIntegrated(root: string, commitSha: string): Promise<void> {
  if (!/^[0-9a-f]{7,40}$/i.test(commitSha)) {
    throw new Error("--commit must be a 7-40 character hexadecimal git commit SHA");
  }
  const exists = await captureCommand("git", ["cat-file", "-e", `${commitSha}^{commit}`], root);
  if (exists.code !== 0) throw new Error(`Git commit does not exist: ${commitSha}`);
  const ancestor = await captureCommand(
    "git",
    ["merge-base", "--is-ancestor", commitSha, "HEAD"],
    root,
  );
  if (ancestor.code !== 0) {
    throw new Error(`Git commit ${commitSha} is not integrated into the current HEAD`);
  }
}
