import { describe, expect, it } from "vite-plus/test";
import { ASSIGNMENT_ROLES, PRIORITIES, VERIFICATION_TYPES, WAVE_KINDS } from "./enums.js";
import {
  assignmentSchema,
  auditReportSchema,
  externalCiSchema,
  findingImportSchema,
  validateAssignmentReport,
  validateAuditReport,
  validateVerificationReport,
  verificationSchema,
  waveSchema,
} from "./schemas.js";

describe("CLI schema contracts", () => {
  it("publishes exact JSON schema contracts", () => {
    expect(auditReportSchema()).toEqual({
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
    });
    const auditSchema = auditReportSchema() as {
      properties: { findings: { items: Record<string, unknown> } };
    };
    expect(findingImportSchema()).toEqual(auditSchema.properties.findings.items);
    expect(assignmentSchema()).toEqual({
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
    });
    expect(verificationSchema()).toEqual({
      type: "object",
      required: ["type", "value"],
      properties: { type: { enum: VERIFICATION_TYPES }, value: { type: "string" } },
    });
    expect(externalCiSchema()).toEqual({
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
    });
    expect(waveSchema()).toEqual({
      type: "object",
      required: ["kind", "summary"],
      properties: {
        kind: { enum: WAVE_KINDS },
        summary: { type: "string" },
        nodes: { type: "array", items: { type: "string" } },
        assignments: { type: "array", items: { type: "string" } },
      },
    });
  });

  it("validates structured report inputs loudly", () => {
    expect(
      validateAuditReport({
        findings: [{ severity: "P1", title: "Bug", evidence: "Observed failure." }],
      }),
    ).toEqual({ ok: true, findings: 1 });
    expect(validateAuditReport({ findings: [] })).toEqual({ ok: true, findings: 0 });
    expect(() => validateAuditReport({ findings: "none" })).toThrow(/findings must be an array/);
    expect(() =>
      validateAuditReport({ findings: [{ severity: "P9", title: "Bug", evidence: "x" }] }),
    ).toThrow(/severity/);
    expect(() => validateAuditReport({ findings: [{ severity: "P1", evidence: "x" }] })).toThrow(
      /title is required/,
    );
    expect(() => validateAuditReport({ findings: [{ severity: "P1", title: "Bug" }] })).toThrow(
      /evidence is required/,
    );

    expect(validateAssignmentReport({ node_id: "a", role: "worker", owner: "agent" })).toEqual({
      ok: true,
    });
    expect(() => validateAssignmentReport({ nodeId: "a", role: "bad", owner: "agent" })).toThrow(
      /role/,
    );
    expect(() => validateAssignmentReport({ nodeId: "a", role: "worker" })).toThrow(
      /owner is required/,
    );

    expect(validateVerificationReport({ nodeId: "a", status: "passed" })).toEqual({ ok: true });
    expect(validateVerificationReport({ node_id: "a", status: "failed" })).toEqual({ ok: true });
    expect(() => validateVerificationReport({ nodeId: "a", status: "skipped" })).toThrow(
      /passed or failed/,
    );
  });
});
