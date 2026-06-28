import type { AddNodeInput, EdgeType, NodeStatus } from "@cat-cave/qdcli-core";
import {
  NODE_STATUSES,
  isBlockerType,
  isNodeKind,
  isNodeStatus,
  isPriority,
  isRisk,
  optionalEnumField,
} from "./enums.js";
import {
  numberAt,
  strictStringArrayAt,
  strictVerificationArrayAt,
  stringAt,
  valueAtPath,
} from "./object-utils.js";

export interface ImportMapping {
  nodesPath?: string;
  edgesPath?: string;
  id?: string;
  title?: string;
  kind?: string;
  milestone?: string;
  group?: string;
  projects?: string;
  status?: string;
  priority?: string;
  estimate?: string;
  risk?: string;
  spec?: ImportTextMapping;
  acceptance?: ImportTextMapping;
  validation?: string;
  verification?: string;
  auditFocus?: string;
  context?: string;
  statusReason?: string;
  blockedBy?: string;
  blockedReason?: string;
  blockedOwner?: string;
  statusMap?: Record<string, NodeStatus>;
  nodeEdges?: ImportNodeEdgesMapping;
  edgeFrom?: string;
  edgeTo?: string;
  edgeType?: string;
}

export type ImportTextMapping = string | ImportFoldMapping;

export interface ImportFoldMapping {
  concat: string[];
  separator?: string;
  preamble?: Record<string, string>;
}

export interface ImportNodeEdgesMapping {
  path: string;
  edgeDirection: "deps-block-this-node" | "this-node-blocks-deps";
  edgeType?: EdgeType;
}

export interface ImportReport {
  ok: boolean;
  dryRun: boolean;
  nodesFound: number;
  edgesFound: number;
  importedNodes: number;
  importedEdges: number;
  defaults: Array<{ nodeId: string; field: string; value: string | number; reason: string }>;
  droppedFields: Array<{ nodeId: string; fields: string[] }>;
  warnings: string[];
  errors: string[];
  nodes: AddNodeInput[];
  edges: PlannedImportEdge[];
}

export interface PlannedImportNode {
  sourceId: string;
  raw: unknown;
  input: AddNodeInput;
}

export interface PlannedImportEdge {
  from: string;
  to: string;
  type: EdgeType;
  source: string;
}

export const defaultImportMapping: ImportMapping = {
  nodesPath: "nodes",
  edgesPath: "edges",
  id: "id",
  title: "title",
  kind: "kind",
  milestone: "milestone",
  group: "group_name",
  projects: "projects",
  status: "status",
  priority: "priority",
  estimate: "estimate_points",
  risk: "risk",
  spec: "spec",
  acceptance: "acceptance",
  validation: "validation",
  verification: "verification",
  auditFocus: "audit_focus",
  context: "context",
  statusReason: "status_reason",
  blockedBy: "blocked_by",
  blockedReason: "blocked_reason",
  blockedOwner: "blocked_owner",
  edgeFrom: "from_node",
  edgeTo: "to_node",
  edgeType: "type",
};

export function mapImportNode(
  raw: unknown,
  index: number,
  mapping: ImportMapping,
  report: ImportReport,
  verbose: boolean,
): PlannedImportNode {
  const id = stringAt(raw, mapping.id ?? "id");
  if (!id) throw new Error(`nodes[${index}] is missing required id field (${mapping.id ?? "id"})`);
  const title = stringAt(raw, mapping.title ?? "title") ?? id;
  if (title === id && !stringAt(raw, mapping.title ?? "title")) {
    defaultImportValue(report, id, "title", id, `missing ${mapping.title ?? "title"}`);
  }
  const spec = textAt(raw, mapping.spec ?? "spec", `nodes[${index}].spec`);
  if (!spec) throw new Error(`node ${id}: mapped spec is required`);
  const acceptance = textAt(raw, mapping.acceptance ?? "acceptance", `nodes[${index}].acceptance`);
  if (!acceptance) throw new Error(`node ${id}: mapped acceptance is required`);

  const input: AddNodeInput = {
    id,
    title,
    kind: mappedEnum(raw, mapping.kind ?? "kind", isNodeKind, "kind", "feature", id, report),
    milestone: stringAt(raw, mapping.milestone ?? "milestone"),
    groupName: stringAt(raw, mapping.group ?? "group"),
    projects: strictStringArrayAt(raw, mapping.projects ?? "projects", `node ${id}.projects`),
    status: mappedStatus(raw, mapping, id, report),
    priority: mappedEnum(
      raw,
      mapping.priority ?? "priority",
      isPriority,
      "priority",
      "P2",
      id,
      report,
    ),
    estimatePoints: mappedEstimate(raw, mapping.estimate ?? "estimate", id, report),
    risk: mappedEnum(raw, mapping.risk ?? "risk", isRisk, "risk", "medium", id, report),
    spec,
    acceptance,
    validation: stringAt(raw, mapping.validation ?? "validation"),
    verification: strictVerificationArrayAt(
      raw,
      mapping.verification ?? "verification",
      `node ${id}.verification`,
    ),
    auditFocus: strictStringArrayAt(
      raw,
      mapping.auditFocus ?? "auditFocus",
      `node ${id}.auditFocus`,
    ),
    context: stringAt(raw, mapping.context ?? "context"),
    statusReason: stringAt(raw, mapping.statusReason ?? "statusReason"),
    blockedBy:
      optionalEnumField(
        stringAt(raw, mapping.blockedBy ?? "blocked_by"),
        isBlockerType,
        `node ${id}.blocked_by`,
      ) ?? null,
    blockedReason: stringAt(raw, mapping.blockedReason ?? "blocked_reason"),
    blockedOwner: stringAt(raw, mapping.blockedOwner ?? "blocked_owner"),
  };
  if (verbose)
    importVerbose(
      `node ${id}: status=${input.status} priority=${input.priority} risk=${input.risk}`,
    );
  return { sourceId: id, raw, input };
}

export function planImportEdge(
  edge: PlannedImportEdge,
  planned: PlannedImportEdge[],
  report: ImportReport,
  seen: Set<string>,
): void {
  if (edge.from === edge.to) {
    report.errors.push(`edge ${edge.from} -> ${edge.to} from ${edge.source} points to itself`);
    return;
  }
  const key = `${edge.from}\0${edge.to}\0${edge.type}`;
  if (seen.has(key)) {
    report.warnings.push(
      `duplicate edge skipped: ${edge.from} -> ${edge.to} (${edge.type}) from ${edge.source}`,
    );
    return;
  }
  seen.add(key);
  planned.push(edge);
  report.edges.push(edge);
}

export function validateNodeEdgesMapping(mapping: ImportNodeEdgesMapping): void {
  if (!mapping.path) throw new Error("nodeEdges.path is required");
  if (
    mapping.edgeDirection !== "deps-block-this-node" &&
    mapping.edgeDirection !== "this-node-blocks-deps"
  ) {
    throw new Error(
      "nodeEdges.edgeDirection must be deps-block-this-node or this-node-blocks-deps",
    );
  }
}

export function importVerbose(message: string): void {
  console.error(`[qd import] ${message}`);
}

export function usedNodeMappingKeys(mapping: ImportMapping): Set<string> {
  const keys = new Set<string>();
  for (const value of [
    mapping.id ?? "id",
    mapping.title ?? "title",
    mapping.kind ?? "kind",
    mapping.milestone ?? "milestone",
    mapping.group ?? "group",
    mapping.projects ?? "projects",
    mapping.status ?? "status",
    mapping.priority ?? "priority",
    mapping.estimate ?? "estimate",
    mapping.risk ?? "risk",
    mapping.validation ?? "validation",
    mapping.verification ?? "verification",
    mapping.auditFocus ?? "auditFocus",
    mapping.context ?? "context",
    mapping.statusReason ?? "statusReason",
    mapping.blockedBy ?? "blocked_by",
    mapping.blockedReason ?? "blocked_reason",
    mapping.blockedOwner ?? "blocked_owner",
  ]) {
    keys.add(topLevelKey(value));
  }
  addTextMappingKeys(keys, mapping.spec ?? "spec");
  addTextMappingKeys(keys, mapping.acceptance ?? "acceptance");
  if (mapping.nodeEdges) keys.add(topLevelKey(mapping.nodeEdges.path));
  return keys;
}

export function droppedTopLevelKeys(source: unknown, used: Set<string>): string[] {
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  return Object.keys(source as Record<string, unknown>)
    .filter((key) => !used.has(key))
    .sort();
}

export function findImportCycle(
  edges: Array<Pick<PlannedImportEdge, "from" | "to">>,
): string[] | null {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    graph.set(edge.from, [...(graph.get(edge.from) ?? []), edge.to]);
    if (!graph.has(edge.to)) graph.set(edge.to, []);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(node: string): string[] | null {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (visited.has(node)) return null;
    visiting.add(node);
    stack.push(node);
    for (const child of graph.get(node) ?? []) {
      const cycle = visit(child);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

function mappedStatus(
  raw: unknown,
  mapping: ImportMapping,
  nodeId: string,
  report: ImportReport,
): NodeStatus {
  const sourceStatus = stringAt(raw, mapping.status ?? "status");
  if (!sourceStatus) {
    defaultImportValue(report, nodeId, "status", "ready", `missing ${mapping.status ?? "status"}`);
    return "ready";
  }
  const mapped = mapping.statusMap?.[sourceStatus];
  if (mapped) {
    if (!isNodeStatus(mapped))
      throw new Error(`statusMap.${sourceStatus} must be one of ${NODE_STATUSES.join(", ")}`);
    return mapped;
  }
  if (isNodeStatus(sourceStatus)) return sourceStatus;
  throw new Error(
    `node ${nodeId}: unknown status "${sourceStatus}"; add statusMap.${sourceStatus} to the import mapping`,
  );
}

function mappedEnum<T extends string>(
  raw: unknown,
  pathText: string,
  isValue: (value: string) => value is T,
  field: string,
  fallback: T,
  nodeId: string,
  report: ImportReport,
): T {
  const value = stringAt(raw, pathText);
  if (!value) {
    defaultImportValue(report, nodeId, field, fallback, `missing ${pathText}`);
    return fallback;
  }
  if (!isValue(value)) throw new Error(`node ${nodeId}: ${field} "${value}" is not valid`);
  return value;
}

function mappedEstimate(
  raw: unknown,
  pathText: string,
  nodeId: string,
  report: ImportReport,
): number {
  const value = valueAtPath(raw, pathText);
  if (value === undefined) {
    defaultImportValue(report, nodeId, "estimate_points", 1, `missing ${pathText}`);
    return 1;
  }
  const parsed = numberAt(raw, pathText);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`node ${nodeId}: estimate at ${pathText} must be a positive integer`);
  }
  return parsed;
}

function textAt(source: unknown, mapping: ImportTextMapping, label: string): string | undefined {
  if (typeof mapping === "string") {
    const value = valueAtPath(source, mapping);
    if (value === undefined) return undefined;
    if (typeof value !== "string")
      throw new Error(`${label}: ${mapping} must be a string or use a fold descriptor`);
    return value.trim() ? value : undefined;
  }
  if (!Array.isArray(mapping.concat) || mapping.concat.length === 0) {
    throw new Error(`${label}: fold descriptor requires a non-empty concat array`);
  }
  const parts: string[] = [];
  for (const pathText of mapping.concat) {
    const value = valueAtPath(source, pathText);
    if (value === undefined) continue;
    const preamble = mapping.preamble?.[pathText] ?? "";
    if (typeof value === "string") {
      if (value.trim()) parts.push(`${preamble}${value}`);
      continue;
    }
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      const items = value.filter((item) => item.trim());
      if (items.length > 0) parts.push(`${preamble}${items.join(mapping.separator ?? "\n")}`);
      continue;
    }
    throw new Error(`${label}: ${pathText} must be a string or string array`);
  }
  const text = parts.join("");
  return text.trim() ? text : undefined;
}

function defaultImportValue(
  report: ImportReport,
  nodeId: string,
  field: string,
  value: string | number,
  reason: string,
): void {
  report.defaults.push({ nodeId, field, value, reason });
}

function addTextMappingKeys(keys: Set<string>, mapping: ImportTextMapping): void {
  if (typeof mapping === "string") {
    keys.add(topLevelKey(mapping));
    return;
  }
  for (const pathText of mapping.concat) keys.add(topLevelKey(pathText));
}

function topLevelKey(pathText: string): string {
  return pathText.split(".")[0] ?? pathText;
}
