import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { qd, root } from "./cli-e2e-fixtures.js";

const execFileAsync = promisify(execFile);

export async function setupAcknowledgedProject(): Promise<void> {
  await qd("setup", "--no-hooks");
  await qd("method", "acknowledge", "--agent", "test");
}

export async function initializeGitRepository(): Promise<string> {
  await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "qd@example.test"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "qd test"], { cwd: root });
  await writeFile(path.join(root, "tracked.txt"), "integrated\n", "utf8");
  await execFileAsync("git", ["add", "tracked.txt"], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "integrated change"], { cwd: root });
  return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
}

export async function writeNodeInput(
  id: string,
  verification: Array<{ type: string; value: string }>,
): Promise<void> {
  await writeFile(
    path.join(root, `${id}-node.json`),
    `${JSON.stringify({
      id,
      title: `${id} node`,
      spec: `Implement ${id}.`,
      acceptance: `${id} is verified.`,
      verification,
    })}\n`,
    "utf8",
  );
}

export async function writeCompletionReport(id: string): Promise<void> {
  await writeFile(
    path.join(root, `${id}-completion.json`),
    `${JSON.stringify(completionReport(id))}\n`,
    "utf8",
  );
}

export async function writeReconciliationReport(id: string, commit: string): Promise<void> {
  await writeFile(
    path.join(root, `${id}-reconciliation.json`),
    `${JSON.stringify(reconciliationReport(id, commit))}\n`,
    "utf8",
  );
}

export function reconciliationReport(id: string, commit: string) {
  const completion = completionReport(id);
  return {
    nodeId: id,
    auditor: "independent-auditor",
    completion,
    audit: {
      nodeId: id,
      acceptanceReviewed: completion.acceptanceEvidence,
      verificationEvidence: {
        diffReviewed: true,
        completionReportReviewed: true,
        verificationEvidenceReviewed: true,
      },
      realWorldValidation: completion.realWorldValidation,
      findings: [] as Array<Record<string, unknown>>,
    },
    verification: {
      nodeId: id,
      entries: [
        {
          index: 1,
          type: "command",
          value: "just ci",
          status: "passed",
          summary: "The declared command passed.",
          evidence: "logs/just-ci.log",
        },
        {
          index: 2,
          type: "manual",
          value: "owner smoke",
          status: "passed",
          summary: "The owner smoke passed.",
          evidence: "reports/owner-smoke.md",
        },
      ],
    },
    ci: {
      status: "passed",
      summary: "Trusted CI passed.",
      provider: "github",
      gitSha: commit,
      url: "https://example.test/ci/landed",
    },
  };
}

function completionReport(id: string) {
  return {
    nodeId: id,
    summary: `${id} completed with evidence.`,
    changedFiles: ["tracked.txt"],
    commits: [],
    acceptanceEvidence: [
      { criterion: `${id} is verified.`, status: "passed", evidence: `reports/${id}.md` },
    ],
    commandsRun: [{ command: "just ci", status: "passed", evidence: `logs/${id}-ci.log` }],
    evidence: [`reports/${id}-completion.md`],
    realWorldValidation: {
      required: false,
      status: "not_required",
      evidence: "No external integration is required for this fixture.",
    },
    unverifiedItems: [],
    dagChangesNeeded: [],
  };
}
