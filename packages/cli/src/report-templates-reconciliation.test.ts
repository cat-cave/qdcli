import { describe, expect, it } from "vite-plus/test";
import { reportTemplate } from "./report-templates.js";

describe("evidence report templates", () => {
  it("publishes the exact audit template", () => {
    expect(reportTemplate("audit-report")).toEqual({
      nodeId: "node-id",
      acceptanceReviewed: [
        {
          criterion: "The real integration returns a typed success response.",
          status: "passed",
          evidence: "reports/node-id/provider-smoke.md",
        },
      ],
      verificationEvidence: {
        diffReviewed: true,
        completionReportReviewed: true,
        verificationEvidenceReviewed: true,
      },
      realWorldValidation: {
        required: true,
        status: "passed",
        evidence: "reports/node-id/live-smoke.md",
      },
      findings: [],
    });
  });

  it("publishes the exact batch verification template", () => {
    expect(reportTemplate("verification-signoff-report")).toEqual({
      nodeId: "node-id",
      entries: [
        {
          index: 1,
          type: "command",
          value: "just ci",
          status: "passed",
          summary: "The declared verification command passed.",
          evidence: "logs/node-id/just-ci.log",
        },
      ],
    });
  });

  it("publishes the exact atomic reconciliation template", () => {
    expect(reportTemplate("reconciliation-report")).toEqual({
      nodeId: "node-id",
      auditor: "independent-auditor",
      completion: {
        nodeId: "node-id",
        summary: "Implementation completed with acceptance evidence.",
        changedFiles: ["src/example.ts"],
        commits: [],
        acceptanceEvidence: [
          {
            criterion: "The behavior works in the intended environment.",
            status: "passed",
            evidence: "reports/node-id/acceptance.md",
          },
        ],
        commandsRun: [
          { command: "just ci", status: "passed", evidence: "logs/node-id/just-ci.log" },
        ],
        evidence: ["reports/node-id/completion.md"],
        realWorldValidation: {
          required: false,
          status: "not_required",
          evidence: "No external integration is required.",
        },
        unverifiedItems: [],
        dagChangesNeeded: [],
      },
      audit: {
        nodeId: "node-id",
        acceptanceReviewed: [
          {
            criterion: "The behavior works in the intended environment.",
            status: "passed",
            evidence: "reports/node-id/acceptance.md",
          },
        ],
        verificationEvidence: {
          diffReviewed: true,
          completionReportReviewed: true,
          verificationEvidenceReviewed: true,
        },
        realWorldValidation: {
          required: false,
          status: "not_required",
          evidence: "No external integration is required.",
        },
        findings: [],
      },
      verification: {
        nodeId: "node-id",
        entries: [
          {
            index: 1,
            type: "command",
            value: "just ci",
            status: "passed",
            summary: "The declared verification passed.",
            evidence: "logs/node-id/just-ci.log",
          },
        ],
      },
      ci: {
        status: "passed",
        summary: "Trusted CI passed for the integrated commit.",
        provider: "github",
        gitSha: "replace-with-integrated-commit-sha",
        url: "https://github.com/owner/repo/actions/runs/123",
      },
    });
  });
});
