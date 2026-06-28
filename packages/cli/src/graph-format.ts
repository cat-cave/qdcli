import type { GraphSnapshot, NodeStatus, Priority, QdNode } from "@cat-cave/qdcli-core";
import { numberOpt, stringOpt } from "./args.js";
import {
  parseSeverityList,
  parseStatusList,
  PRIORITIES,
  isNodeKind,
  strictEnumOpt,
} from "./enums.js";

export function filterSnapshot(
  snapshot: GraphSnapshot,
  filters: { statuses?: NodeStatus[]; milestone?: string },
): GraphSnapshot {
  const statuses = filters.statuses ? new Set(filters.statuses) : null;
  const nodeIds = new Set(
    snapshot.nodes
      .filter((node) => !statuses || statuses.has(node.status))
      .filter((node) => !filters.milestone || node.milestone === filters.milestone)
      .map((node) => node.id),
  );
  if (!statuses && !filters.milestone) return snapshot;
  const assignmentIds = new Set(
    snapshot.assignments
      .filter((assignment) => nodeIds.has(assignment.node_id))
      .map((assignment) => assignment.id),
  );
  return {
    ...snapshot,
    nodes: snapshot.nodes.filter((node) => nodeIds.has(node.id)),
    edges: snapshot.edges.filter(
      (edge) => nodeIds.has(edge.from_node) && nodeIds.has(edge.to_node),
    ),
    findings: snapshot.findings.filter((finding) => nodeIds.has(finding.node_id)),
    runs: snapshot.runs.filter((run) => nodeIds.has(run.node_id)),
    node_notes: snapshot.node_notes.filter((note) => nodeIds.has(note.node_id)),
    assignments: snapshot.assignments.filter((assignment) => nodeIds.has(assignment.node_id)),
    wave_memberships: snapshot.wave_memberships.filter(
      (membership) =>
        (membership.node_id && nodeIds.has(membership.node_id)) ||
        (membership.assignment_id && assignmentIds.has(membership.assignment_id)),
    ),
  };
}

export function snapshotDiff(
  live: GraphSnapshot,
  exported: GraphSnapshot,
): {
  ok: boolean;
  liveOnlyNodes: string[];
  exportOnlyNodes: string[];
  changedNodes: string[];
  liveNodeCount: number;
  exportNodeCount: number;
} {
  const liveById = new Map(live.nodes.map((node) => [node.id, node]));
  const exportById = new Map(exported.nodes.map((node) => [node.id, node]));
  const liveOnlyNodes = [...liveById.keys()].filter((id) => !exportById.has(id)).sort();
  const exportOnlyNodes = [...exportById.keys()].filter((id) => !liveById.has(id)).sort();
  const changedNodes = [...liveById.keys()]
    .filter((id) => exportById.has(id))
    .filter((id) => JSON.stringify(liveById.get(id)) !== JSON.stringify(exportById.get(id)))
    .sort();
  return {
    ok: liveOnlyNodes.length === 0 && exportOnlyNodes.length === 0 && changedNodes.length === 0,
    liveOnlyNodes,
    exportOnlyNodes,
    changedNodes,
    liveNodeCount: live.nodes.length,
    exportNodeCount: exported.nodes.length,
  };
}

export function nextStepForNode(
  node: QdNode,
  gate: { blocking: Array<{ id: string }>; runningAudits: Array<{ id: string }> },
  latestCheck: { id: string; status: string } | null,
  latestCi: { id: string; status: string } | null,
): string | null {
  if (gate.blocking.length > 0) {
    const finding = gate.blocking[0];
    return finding ? `qd finding resolve ${finding.id}` : null;
  }
  if (gate.runningAudits.length > 0) {
    const runRow = gate.runningAudits[0];
    return runRow
      ? `qd audit pass ${node.id} --run-id ${runRow.id} --from-report <audit-report.json>`
      : null;
  }
  const passedRecoveryRun =
    latestCheck?.status === "passed"
      ? latestCheck
      : latestCi?.status === "passed"
        ? latestCi
        : null;
  if (node.status === "blocked" && passedRecoveryRun) {
    return `qd unblock ${node.id} --from-run ${passedRecoveryRun.id} --summary "<why it is unblocked>"`;
  }
  if (node.status !== "mergeable") return `qd ci run ${node.id}`;
  if (latestCi?.status !== "passed") return `qd ci run ${node.id}`;
  return null;
}

export function filterNodes(
  nodes: GraphSnapshot["nodes"],
  options: Record<string, string | string[] | boolean>,
): GraphSnapshot["nodes"] {
  const statuses = parseStatusList(options.status);
  const priorities = parseSeverityList(options.priority);
  const kind = strictEnumOpt(options.kind, isNodeKind, "--kind");
  const milestone = stringOpt(options.milestone);
  const project = stringOpt(options.project);
  const group = stringOpt(options.group);
  const limit = numberOpt(options.limit);
  const filtered = nodes
    .filter((node) => !statuses || statuses.includes(node.status))
    .filter((node) => !priorities || priorities.includes(node.priority))
    .filter((node) => !kind || node.kind === kind)
    .filter((node) => !milestone || node.milestone === milestone)
    .filter((node) => !project || node.projects.includes(project))
    .filter((node) => !group || node.group_name === group)
    .sort(compareNodeRows);
  return limit ? filtered.slice(0, limit) : filtered;
}

export function formatRows(
  rows: Array<Record<string, unknown> | GraphSnapshot["nodes"][number]>,
  options: Record<string, string | string[] | boolean>,
): unknown {
  const fields = stringOpt(options.fields)
    ?.split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  const shaped = fields
    ? rows.map((row) =>
        Object.fromEntries(
          fields.map((field) => [field, (row as Record<string, unknown>)[field] ?? null]),
        ),
      )
    : rows;
  if (options.tsv) {
    const selected = fields ?? Object.keys(shaped[0] ?? {});
    return [
      selected.join("\t"),
      ...shaped.map((row) =>
        selected.map((field) => formatCell((row as Record<string, unknown>)[field])).join("\t"),
      ),
    ].join("\n");
  }
  if (options.compact) {
    return shaped.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      milestone: row.milestone,
    }));
  }
  return shaped;
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function compareNodeRows(
  a: GraphSnapshot["nodes"][number],
  b: GraphSnapshot["nodes"][number],
): number {
  return (
    (PRIORITIES as readonly string[]).indexOf(a.priority as Priority) -
      (PRIORITIES as readonly string[]).indexOf(b.priority as Priority) ||
    a.estimate_points - b.estimate_points ||
    a.id.localeCompare(b.id)
  );
}

export function toMermaid(snapshot: GraphSnapshot): string {
  const lines = ["flowchart TD"];
  for (const node of snapshot.nodes) {
    lines.push(`  ${safeId(node.id)}["${node.id}: ${node.title.replaceAll('"', "'")}"]`);
  }
  for (const edge of snapshot.edges.filter((item) => item.type === "requires")) {
    lines.push(`  ${safeId(edge.from_node)} --> ${safeId(edge.to_node)}`);
  }
  return lines.join("\n");
}

export function toDot(snapshot: GraphSnapshot): string {
  const lines = ["digraph qd {"];
  for (const node of snapshot.nodes)
    lines.push(`  "${node.id}" [label="${node.id}: ${node.title.replaceAll('"', "'")}"];`);
  for (const edge of snapshot.edges.filter((item) => item.type === "requires"))
    lines.push(`  "${edge.from_node}" -> "${edge.to_node}";`);
  lines.push("}");
  return lines.join("\n");
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}
