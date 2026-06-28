import {
  ASSIGNMENT_ROLES,
  PRIORITIES,
  VERIFICATION_TYPES,
  WAVE_KINDS,
  isAssignmentRole,
  isPriority,
  strictEnum,
} from "./enums.js";
import { asRecord, requiredNodeStringField, valueAtPath } from "./object-utils.js";

export function auditReportSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["nodeId", "findings"],
    properties: {
      nodeId: { type: "string" },
      node_id: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          required: ["severity", "title", "evidence"],
          properties: {
            severity: { enum: PRIORITIES },
            title: { type: "string" },
            evidence: { type: "string" },
            path: { type: "string" },
            line: { type: "number" },
            expected: { type: "string" },
            suggested_fix: { type: "string" },
            suggestedFix: { type: "string" },
          },
        },
      },
    },
  };
}

export function findingImportSchema(): Record<string, unknown> {
  return auditReportSchema().properties
    ? {
        type: "object",
        required: ["severity", "title", "evidence"],
        properties: {
          severity: { enum: PRIORITIES },
          title: { type: "string" },
          evidence: { type: "string" },
          path: { type: "string" },
          line: { type: "number" },
          expected: { type: "string" },
          suggested_fix: { type: "string" },
          suggestedFix: { type: "string" },
        },
      }
    : {};
}

export function assignmentSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["nodeId", "role", "owner"],
    properties: {
      nodeId: { type: "string" },
      role: { enum: ASSIGNMENT_ROLES },
      owner: { type: "string" },
      branch: { type: "string" },
      worktreePath: { type: "string" },
      scope: { type: "string" },
    },
  };
}

export function verificationSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["type", "value"],
    properties: {
      type: { enum: VERIFICATION_TYPES },
      value: { type: "string" },
    },
  };
}

export function externalCiSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["nodeId", "status", "summary"],
    properties: {
      nodeId: { type: "string" },
      status: { enum: ["passed", "failed"] },
      summary: { type: "string" },
      provider: { type: "string" },
      externalId: { type: "string" },
      url: { type: "string" },
      gitSha: { type: "string" },
    },
  };
}

export function waveSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["kind", "summary"],
    properties: {
      kind: { enum: WAVE_KINDS },
      summary: { type: "string" },
      nodes: { type: "array", items: { type: "string" } },
      assignments: { type: "array", items: { type: "string" } },
    },
  };
}

export function validateAuditReport(value: unknown): { ok: true; findings: number } {
  const report = asRecord(value, "audit report");
  const findings = valueAtPath(report, "findings");
  if (!Array.isArray(findings)) throw new Error("audit report findings must be an array");
  for (const [index, finding] of findings.entries()) {
    const item = asRecord(finding, `findings[${index}]`);
    strictEnum(
      requiredNodeStringField(item, "severity", `findings[${index}]`),
      isPriority,
      "severity",
    );
    requiredNodeStringField(item, "title", `findings[${index}]`);
    requiredNodeStringField(item, "evidence", `findings[${index}]`);
  }
  return { ok: true, findings: findings.length };
}

export function validateAssignmentReport(value: unknown): { ok: true } {
  const report = asRecord(value, "assignment report");
  requiredNodeStringField(report, "nodeId", "assignment report", "node_id");
  strictEnum(
    requiredNodeStringField(report, "role", "assignment report"),
    isAssignmentRole,
    "role",
  );
  requiredNodeStringField(report, "owner", "assignment report");
  return { ok: true };
}

export function validateVerificationReport(value: unknown): { ok: true } {
  const report = asRecord(value, "verification report");
  requiredNodeStringField(report, "nodeId", "verification report", "node_id");
  const status = requiredNodeStringField(report, "status", "verification report");
  if (status !== "passed" && status !== "failed") {
    throw new Error("verification report status must be passed or failed");
  }
  return { ok: true };
}
