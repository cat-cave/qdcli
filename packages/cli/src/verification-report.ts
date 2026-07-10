import { VERIFICATION_TYPES } from "./enums.js";
import { asRecord, requiredNodeStringField } from "./object-utils.js";

export function verificationSignoffReportSchema(): Record<string, unknown> {
  return {
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
}

export interface ValidatedBatchVerificationEntry {
  index: number;
  type: string;
  value: string;
  summary: string;
  evidence: string;
}

export function validateBatchVerificationReport(value: unknown): {
  ok: true;
  nodeId: string;
  entries: ValidatedBatchVerificationEntry[];
} {
  const report = asRecord(value, "verification sign-off report");
  const nodeId = requiredNodeStringField(
    report,
    "nodeId",
    "verification sign-off report",
    "node_id",
  );
  if (!Array.isArray(report.entries)) {
    throw new Error("verification sign-off report.entries must be an array");
  }
  const entries = report.entries.map((raw, offset) => {
    const context = `verification sign-off report.entries[${offset}]`;
    const entry = asRecord(raw, context);
    if (!Number.isInteger(entry.index) || Number(entry.index) < 1) {
      throw new Error(`${context}.index must be a positive integer`);
    }
    const type = requiredNodeStringField(entry, "type", context);
    if (!VERIFICATION_TYPES.includes(type)) {
      throw new Error(`${context}.type must be one of ${VERIFICATION_TYPES.join(", ")}`);
    }
    const status = requiredNodeStringField(entry, "status", context);
    if (status !== "passed") throw new Error(`${context}.status must be passed`);
    return {
      index: Number(entry.index),
      type,
      value: requiredNodeStringField(entry, "value", context),
      summary: requiredNodeStringField(entry, "summary", context),
      evidence: requiredNodeStringField(entry, "evidence", context),
    };
  });
  return { ok: true, nodeId, entries };
}
