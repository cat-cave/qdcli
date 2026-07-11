import { NODE_KINDS, NODE_STATUSES, PRIORITIES, RISKS } from "./enums.js";
import { verificationSchema } from "./schemas.js";

const nodeProperties = {
  id: { type: "string" },
  title: { type: "string" },
  kind: { enum: NODE_KINDS },
  milestone: { type: ["string", "null"] },
  groupName: { type: ["string", "null"] },
  projects: { type: "array", items: { type: "string" } },
  status: { enum: NODE_STATUSES },
  priority: { enum: PRIORITIES },
  estimatePoints: { type: "number", minimum: 1 },
  risk: { enum: RISKS },
  spec: { type: "string" },
  acceptance: { type: "string" },
  validation: { type: ["string", "null"] },
  verification: { type: "array", items: verificationSchema() },
  auditFocus: { type: "array", items: { type: "string" } },
  context: { type: ["string", "null"] },
  statusReason: { type: ["string", "null"] },
  checkCommand: { type: ["string", "null"] },
  ciCommand: { type: ["string", "null"] },
};

export function nodeSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["title", "spec", "acceptance"],
    additionalProperties: false,
    properties: nodeProperties,
  };
}

export function nodePatchSchema(): Record<string, unknown> {
  return {
    type: "object",
    minProperties: 1,
    additionalProperties: false,
    properties: {
      ...Object.fromEntries(Object.entries(nodeProperties).filter(([key]) => key !== "id")),
      branch: { type: ["string", "null"] },
    },
  };
}
