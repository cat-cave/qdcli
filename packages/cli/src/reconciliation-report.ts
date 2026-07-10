import type { ReconcileCiInput, ReconcileFindingInput } from "@cat-cave/qdcli-core";
import { isPriority } from "./enums.js";
import {
  asRecord,
  optionalNumberField,
  optionalStringField,
  requiredNodeStringField,
} from "./object-utils.js";
import {
  auditReportSchema,
  completionReportSchema,
  validateAuditReport,
  validateCompletionReport,
} from "./schemas.js";
import {
  validateBatchVerificationReport,
  verificationSignoffReportSchema,
  type ValidatedBatchVerificationEntry,
} from "./verification-report.js";

export interface ValidatedReconciliationReport {
  nodeId: string;
  auditor: string;
  completionSummary: string;
  auditSummary: string;
  auditPassed: boolean;
  findings: ReconcileFindingInput[];
  verification: ValidatedBatchVerificationEntry[];
  ci?: ReconcileCiInput;
}

export function reconciliationReportSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["nodeId", "auditor", "completion", "audit"],
    properties: {
      nodeId: { type: "string" },
      auditor: { type: "string" },
      completion: completionReportSchema(),
      audit: auditReportSchema(),
      verification: verificationSignoffReportSchema(),
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
  };
}

export function validateReconciliationReport(value: unknown): ValidatedReconciliationReport {
  const report = asRecord(value, "reconciliation report");
  const nodeId = requiredNodeStringField(report, "nodeId", "reconciliation report", "node_id");
  const auditor = requiredNodeStringField(report, "auditor", "reconciliation report");
  const completion = asRecord(report.completion, "reconciliation report.completion");
  const completionValidation = validateCompletionReport(completion);
  assertNestedNodeId(completion, nodeId, "completion");

  const audit = asRecord(report.audit, "reconciliation report.audit");
  const auditValidation = validateAuditReport(audit);
  assertNestedNodeId(audit, nodeId, "audit");
  const findings = parseReconciliationFindings(audit.findings);
  const auditPassed =
    findings.length === 0 &&
    (auditValidation.realWorldValidation === "passed" ||
      auditValidation.realWorldValidation === "not_required");
  const verification = report.verification
    ? validateBatchVerificationReport(report.verification)
    : undefined;
  if (verification) assertReportNodeId(verification.nodeId, nodeId, "verification");
  const ci = report.ci ? parseReconciliationCi(report.ci) : undefined;
  if (auditPassed && (!verification || !ci)) {
    throw new Error(
      "A clean reconciliation report requires complete verification and passed CI evidence",
    );
  }
  return {
    nodeId,
    auditor,
    completionSummary: completionValidation.summary,
    auditSummary: auditPassed
      ? `Independent reconciliation audit passed by ${auditor}`
      : `Independent reconciliation audit failed or produced findings (${findings.length})`,
    auditPassed,
    findings,
    verification: verification?.entries ?? [],
    ci,
  };
}

function parseReconciliationFindings(value: unknown): ReconcileFindingInput[] {
  if (!Array.isArray(value))
    throw new Error("reconciliation report.audit.findings must be an array");
  return value.map((raw, index) => {
    const context = `reconciliation report.audit.findings[${index}]`;
    const finding = asRecord(raw, context);
    const severity = requiredNodeStringField(finding, "severity", context);
    if (!isPriority(severity)) throw new Error(`${context}.severity must be P0, P1, P2, or P3`);
    return {
      severity,
      title: requiredNodeStringField(finding, "title", context),
      evidence: requiredNodeStringField(finding, "evidence", context),
      path: optionalStringField(finding, "path", context),
      line: optionalNumberField(finding, "line", context),
      expected: optionalStringField(finding, "expected", context),
      suggestedFix:
        optionalStringField(finding, "suggestedFix", context) ??
        optionalStringField(finding, "suggested_fix", context),
    };
  });
}

function parseReconciliationCi(value: unknown): ReconcileCiInput {
  const ci = asRecord(value, "reconciliation report.ci");
  const status = requiredNodeStringField(ci, "status", "reconciliation report.ci");
  if (status !== "passed") throw new Error("reconciliation report.ci.status must be passed");
  const result = {
    summary: requiredNodeStringField(ci, "summary", "reconciliation report.ci"),
    provider: requiredNodeStringField(ci, "provider", "reconciliation report.ci"),
    gitSha: requiredNodeStringField(ci, "gitSha", "reconciliation report.ci", "git_sha"),
    externalId: optionalStringField(ci, "externalId", "reconciliation report.ci"),
    url: optionalStringField(ci, "url", "reconciliation report.ci"),
    logPath: optionalStringField(ci, "logPath", "reconciliation report.ci"),
  };
  if (!result.externalId && !result.url && !result.logPath) {
    throw new Error("reconciliation report.ci requires externalId, url, or logPath evidence");
  }
  return result;
}

function assertNestedNodeId(
  report: Record<string, unknown>,
  expected: string,
  context: string,
): void {
  assertReportNodeId(
    requiredNodeStringField(report, "nodeId", `reconciliation report.${context}`, "node_id"),
    expected,
    context,
  );
}

function assertReportNodeId(actual: string, expected: string, context: string): void {
  if (actual !== expected) {
    throw new Error(`reconciliation report ${context} nodeId ${actual} does not match ${expected}`);
  }
}
