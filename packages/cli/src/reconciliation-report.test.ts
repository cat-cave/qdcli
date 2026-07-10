import { describe, expect, it } from "vite-plus/test";
import { VERIFICATION_TYPES } from "./enums.js";
import {
  reconciliationReportSchema,
  validateReconciliationReport,
} from "./reconciliation-report.js";
import { auditReportSchema, completionReportSchema } from "./schemas.js";
import {
  validateBatchVerificationReport,
  verificationSignoffReportSchema,
} from "./verification-report.js";

function verificationReport(): Record<string, unknown> {
  return {
    nodeId: "node-a",
    entries: [
      {
        index: 1,
        type: "command",
        value: "just ci",
        status: "passed",
        summary: "Command passed",
        evidence: "logs/ci.log",
      },
    ],
  };
}

function reconciliationReport(): Record<string, unknown> {
  return {
    nodeId: "node-a",
    auditor: "auditor-a",
    completion: {
      nodeId: "node-a",
      summary: "Implemented node-a",
      changedFiles: ["src/a.ts"],
      commits: [],
      acceptanceEvidence: [
        { criterion: "works", status: "passed", evidence: "reports/acceptance.md" },
      ],
      commandsRun: [{ command: "just ci", status: "passed", evidence: "logs/ci.log" }],
      evidence: ["reports/completion.md"],
      realWorldValidation: {
        required: false,
        status: "not_required",
        evidence: "No external dependency",
      },
      unverifiedItems: [],
      dagChangesNeeded: [],
    },
    audit: {
      nodeId: "node-a",
      acceptanceReviewed: [
        { criterion: "works", status: "passed", evidence: "reports/acceptance.md" },
      ],
      verificationEvidence: {
        diffReviewed: true,
        completionReportReviewed: true,
        verificationEvidenceReviewed: true,
      },
      realWorldValidation: {
        required: false,
        status: "not_required",
        evidence: "No external dependency",
      },
      findings: [],
    },
    verification: verificationReport(),
    ci: {
      status: "passed",
      summary: "CI passed",
      provider: "github",
      gitSha: "abcdef1",
      externalId: "run-1",
      url: "https://github.com/o/r/actions/runs/1",
      logPath: "logs/ci.log",
    },
  };
}

describe("reconciliation report contracts", () => {
  it("publishes exact verification and reconciliation schemas", () => {
    const verificationSchema = {
      type: "object",
      required: ["nodeId", "entries"],
      properties: {
        nodeId: { type: "string" },
        entries: {
          type: "array",
          items: {
            type: "object",
            required: ["index", "type", "value", "status", "summary", "evidence"],
            properties: {
              index: { type: "integer", minimum: 1 },
              type: { enum: VERIFICATION_TYPES },
              value: { type: "string" },
              status: { enum: ["passed"] },
              summary: { type: "string" },
              evidence: { type: "string" },
            },
          },
        },
      },
    };
    expect(verificationSignoffReportSchema()).toEqual(verificationSchema);
    expect(reconciliationReportSchema()).toEqual({
      type: "object",
      required: ["nodeId", "auditor", "completion", "audit"],
      properties: {
        nodeId: { type: "string" },
        auditor: { type: "string" },
        completion: completionReportSchema(),
        audit: auditReportSchema(),
        verification: verificationSchema,
        ci: {
          type: "object",
          required: ["status", "summary", "provider", "gitSha"],
          properties: {
            status: { enum: ["passed"] },
            summary: { type: "string" },
            provider: { type: "string" },
            gitSha: { type: "string" },
            externalId: { type: "string" },
            url: { type: "string" },
            logPath: { type: "string" },
          },
        },
      },
    });
  });

  it("validates complete batch verification evidence", () => {
    expect(validateBatchVerificationReport(verificationReport())).toEqual({
      ok: true,
      nodeId: "node-a",
      entries: [
        {
          index: 1,
          type: "command",
          value: "just ci",
          summary: "Command passed",
          evidence: "logs/ci.log",
        },
      ],
    });
    expect(
      validateBatchVerificationReport({
        node_id: "node-a",
        entries: [
          {
            index: 2,
            type: "url",
            value: "https://example.test",
            status: "passed",
            summary: "URL checked",
            evidence: "reports/url.md",
          },
        ],
      }),
    ).toMatchObject({ nodeId: "node-a", entries: [{ index: 2, type: "url" }] });
  });

  it("rejects every malformed batch verification boundary", () => {
    expect(() => validateBatchVerificationReport(null)).toThrow("must be an object");
    expect(() => validateBatchVerificationReport({ entries: [] })).toThrow("nodeId is required");
    expect(() => validateBatchVerificationReport({ nodeId: "node-a", entries: {} })).toThrow(
      "entries must be an array",
    );
    for (const index of [0, -1, 1.5, "1", null]) {
      const report = verificationReport();
      (report.entries as Array<Record<string, unknown>>)[0]!.index = index;
      expect(() => validateBatchVerificationReport(report)).toThrow("positive integer");
    }
    for (const [field, value, message] of [
      ["type", "shell", "type must be one of"],
      ["status", "failed", "status must be passed"],
      ["value", "", "value is required"],
      ["summary", 1, "summary is required"],
      ["evidence", null, "evidence is required"],
    ] as const) {
      const report = verificationReport();
      (report.entries as Array<Record<string, unknown>>)[0]![field] = value;
      expect(() => validateBatchVerificationReport(report)).toThrow(message);
    }
    const report = verificationReport();
    report.entries = [null];
    expect(() => validateBatchVerificationReport(report)).toThrow("entries[0] must be an object");
  });

  it("normalizes a clean reconciliation with all optional CI evidence", () => {
    expect(validateReconciliationReport(reconciliationReport())).toEqual({
      nodeId: "node-a",
      auditor: "auditor-a",
      completionSummary: "Implemented node-a",
      auditSummary: "Independent reconciliation audit passed by auditor-a",
      auditPassed: true,
      findings: [],
      verification: [
        {
          index: 1,
          type: "command",
          value: "just ci",
          summary: "Command passed",
          evidence: "logs/ci.log",
        },
      ],
      ci: {
        summary: "CI passed",
        provider: "github",
        gitSha: "abcdef1",
        externalId: "run-1",
        url: "https://github.com/o/r/actions/runs/1",
        logPath: "logs/ci.log",
      },
    });
  });

  it("accepts a failed audit without downstream evidence and preserves finding details", () => {
    const report = reconciliationReport();
    delete report.verification;
    delete report.ci;
    const audit = report.audit as Record<string, unknown>;
    audit.realWorldValidation = {
      required: true,
      status: "failed",
      evidence: "reports/live-failure.md",
    };
    audit.findings = [
      {
        severity: "P1",
        title: "Live failure",
        evidence: "reports/live-failure.md",
        observed: "Failed",
        expected: "Passed",
        classification: "implementation",
        path: "src/a.ts",
        line: 42,
        expectedBehavior: "unused",
        suggested_fix: "Fix it",
      },
    ];
    expect(validateReconciliationReport(report)).toMatchObject({
      auditPassed: false,
      auditSummary: "Independent reconciliation audit failed or produced findings (1)",
      verification: [],
      ci: undefined,
      findings: [
        {
          severity: "P1",
          title: "Live failure",
          evidence: "reports/live-failure.md",
          path: "src/a.ts",
          line: 42,
          suggestedFix: "Fix it",
        },
      ],
    });
  });

  it("requires downstream evidence only after a clean independent audit", () => {
    for (const field of ["verification", "ci"] as const) {
      const report = reconciliationReport();
      delete report[field];
      expect(() => validateReconciliationReport(report)).toThrow(
        "requires complete verification and passed CI evidence",
      );
    }
  });

  it("rejects mismatched nested node identities", () => {
    for (const field of ["completion", "audit", "verification"] as const) {
      const report = reconciliationReport();
      (report[field] as Record<string, unknown>).nodeId = "other";
      expect(() => validateReconciliationReport(report)).toThrow(
        `${field} nodeId other does not match node-a`,
      );
    }
  });

  it("validates reconciliation finding and CI evidence fields", () => {
    const withFinding = (finding: Record<string, unknown>) => {
      const report = reconciliationReport();
      (report.audit as Record<string, unknown>).findings = [
        {
          severity: "P1",
          title: "Finding",
          evidence: "evidence",
          observed: "observed",
          expected: "expected",
          classification: "implementation",
          ...finding,
        },
      ];
      return report;
    };
    expect(() => validateReconciliationReport(withFinding({ severity: "urgent" }))).toThrow(
      "severity must be one of P0, P1, P2, P3",
    );
    expect(() => validateReconciliationReport(withFinding({ path: 1 }))).toThrow(
      "path must be a string",
    );
    expect(() => validateReconciliationReport(withFinding({ line: "42" }))).toThrow(
      "line must be a number",
    );
    const badFindings = reconciliationReport();
    (badFindings.audit as Record<string, unknown>).findings = {};
    expect(() => validateReconciliationReport(badFindings)).toThrow("findings must be an array");

    for (const [field, value, message] of [
      ["status", "failed", "status must be passed"],
      ["summary", "", "summary is required"],
      ["provider", null, "provider is required"],
      ["gitSha", 1, "gitSha is required"],
    ] as const) {
      const report = reconciliationReport();
      (report.ci as Record<string, unknown>)[field] = value;
      expect(() => validateReconciliationReport(report)).toThrow(message);
    }
    const noEvidence = reconciliationReport();
    noEvidence.ci = {
      status: "passed",
      summary: "CI passed",
      provider: "github",
      gitSha: "abcdef1",
    };
    expect(() => validateReconciliationReport(noEvidence)).toThrow(
      "requires externalId, url, or logPath evidence",
    );
  });
});
