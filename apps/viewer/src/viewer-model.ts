import {
  QD_EXPORT_SCHEMA_VERSION,
  type GraphSnapshot,
  type NodeStatus,
  type QdEdge,
  type QdFinding,
  type QdNode,
} from "@cat-cave/qdcli-core";

export const emptySnapshot: GraphSnapshot = {
  schema_version: QD_EXPORT_SCHEMA_VERSION,
  exported_at: new Date(0).toISOString(),
  registries: { groups: [], projects: [], milestones: [] },
  nodes: [],
  edges: [],
  findings: [],
  runs: [],
  node_notes: [],
  assignments: [],
  waves: [],
  wave_memberships: [],
};

export const statuses: NodeStatus[] = [
  "draft",
  "ready",
  "claimed",
  "working",
  "review",
  "fixing",
  "ci",
  "mergeable",
  "done",
  "regressed",
  "blocked",
  "cancelled",
];

export const nodeWidth = 230;
export const nodeHeight = 92;
export const columnGap = 120;
export const rowGap = 34;
export const graphPadding = 80;
export const layoutModes = ["dependencies", "milestones", "status"] as const;

const priorityRank = new Map([
  ["P0", 0],
  ["P1", 1],
  ["P2", 2],
  ["P3", 3],
]);

export type LayoutMode = (typeof layoutModes)[number];

export interface Filters {
  query: string;
  statuses: Set<NodeStatus>;
  milestone: string;
  group: string;
  project: string;
  layoutMode: LayoutMode;
  dimFiltered: boolean;
  focusSelection: boolean;
}

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutNode {
  node: QdNode;
  x: number;
  y: number;
  layer: number;
}

export interface LayoutGraph {
  nodes: LayoutNode[];
  edges: QdEdge[];
  bounds: Viewport;
}

export interface DragState {
  pointerId: number;
  x: number;
  y: number;
  viewport: Viewport;
}

export function buildLayout(
  snapshot: GraphSnapshot,
  renderedNodeIds: Set<string>,
  mode: LayoutMode = "dependencies",
): LayoutGraph {
  const nodes = snapshot.nodes.filter((node) => renderedNodeIds.has(node.id));
  const ids = new Set(nodes.map((node) => node.id));
  const layer = layoutLayers(snapshot, nodes, ids, mode);
  const byLayer = new Map<number, QdNode[]>();
  for (const node of nodes) {
    const nodeLayer = layer.get(node.id) ?? 0;
    byLayer.set(nodeLayer, [...(byLayer.get(nodeLayer) ?? []), node]);
  }
  const positioned: LayoutNode[] = [];
  const maxRows = Math.max(...[...byLayer.values()].map((items) => items.length), 1);
  const height = maxRows * (nodeHeight + rowGap) - rowGap;
  for (const [nodeLayer, layerNodes] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...layerNodes].sort(compareNodes);
    const columnHeight = sorted.length * (nodeHeight + rowGap) - rowGap;
    const offsetY = (height - columnHeight) / 2;
    sorted.forEach((node, index) => {
      positioned.push({
        node,
        layer: nodeLayer,
        x: graphPadding + nodeLayer * (nodeWidth + columnGap),
        y: graphPadding + offsetY + index * (nodeHeight + rowGap),
      });
    });
  }
  const maxLayer = Math.max(...positioned.map((node) => node.layer), 0);
  return {
    nodes: positioned,
    edges: snapshot.edges.filter((edge) => ids.has(edge.from_node) && ids.has(edge.to_node)),
    bounds: {
      x: 0,
      y: 0,
      width: graphPadding * 2 + (maxLayer + 1) * nodeWidth + maxLayer * columnGap,
      height: graphPadding * 2 + height,
    },
  };
}

export function layoutLayers(
  snapshot: GraphSnapshot,
  nodes: QdNode[],
  ids: Set<string>,
  mode: LayoutMode,
): Map<string, number> {
  if (mode === "milestones") return milestoneLayers(snapshot, nodes);
  if (mode === "status") return statusLayers(nodes);
  return dependencyLayers(snapshot, nodes, ids);
}

function dependencyLayers(
  snapshot: GraphSnapshot,
  nodes: QdNode[],
  ids: Set<string>,
): Map<string, number> {
  const requires = snapshot.edges.filter(
    (edge) => edge.type === "requires" && ids.has(edge.from_node) && ids.has(edge.to_node),
  );
  const layer = new Map(nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const edge of requires) {
      const from = layer.get(edge.from_node) ?? 0;
      const to = layer.get(edge.to_node) ?? 0;
      if (to <= from) {
        layer.set(edge.to_node, from + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layer;
}

function milestoneLayers(snapshot: GraphSnapshot, nodes: QdNode[]): Map<string, number> {
  const ranked = [...snapshot.registries.milestones].sort(
    (a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER),
  );
  const byMilestone = new Map(ranked.map((entry, index) => [entry.name, index]));
  const unassigned = byMilestone.size;
  return new Map(
    nodes.map((node) => [node.id, byMilestone.get(node.milestone ?? "") ?? unassigned]),
  );
}

function statusLayers(nodes: QdNode[]): Map<string, number> {
  const byStatus = new Map(statuses.map((status, index) => [status, index]));
  return new Map(nodes.map((node) => [node.id, byStatus.get(node.status) ?? statuses.length]));
}

export function readyNodes(snapshot: GraphSnapshot): QdNode[] {
  return snapshot.nodes.filter((node) => {
    if (!["ready", "regressed"].includes(node.status)) return false;
    return !snapshot.edges.some((edge) => {
      if (edge.type !== "requires" || edge.to_node !== node.id) return false;
      return snapshot.nodes.find((candidate) => candidate.id === edge.from_node)?.status !== "done";
    });
  });
}

export function matchesFilters(node: QdNode, filters: Filters): boolean {
  const query = filters.query.trim().toLowerCase();
  if (!filters.statuses.has(node.status)) return false;
  if (filters.milestone !== "all" && node.milestone !== filters.milestone) return false;
  if (filters.group !== "all" && node.group_name !== filters.group) return false;
  if (filters.project !== "all" && !node.projects.includes(filters.project)) return false;
  if (!query) return true;
  return [node.id, node.title, node.spec, node.acceptance, node.owner ?? "", node.branch ?? ""]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

export function fitBounds(bounds: Viewport): Viewport {
  return {
    x: bounds.x - graphPadding,
    y: bounds.y - graphPadding,
    width: Math.max(bounds.width + graphPadding * 2, 600),
    height: Math.max(bounds.height + graphPadding * 2, 420),
  };
}

export function boundsForLayoutNodes(nodes: LayoutNode[]): Viewport | null {
  if (nodes.length === 0) return null;
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + nodeWidth));
  const maxY = Math.max(...nodes.map((node) => node.y + nodeHeight));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function zoomViewport(
  current: Viewport,
  event: { clientX: number; clientY: number; deltaY: number },
  svg: SVGSVGElement | null,
): Viewport {
  const rect = svg?.getBoundingClientRect();
  if (!rect) return current;
  const mx = (event.clientX - rect.left) / rect.width;
  const my = (event.clientY - rect.top) / rect.height;
  const factor = event.deltaY > 0 ? 1.12 : 0.88;
  const width = clamp(current.width * factor, 260, 20000);
  const height = clamp(current.height * factor, 180, 20000);
  const graphX = current.x + mx * current.width;
  const graphY = current.y + my * current.height;
  return {
    x: graphX - mx * width,
    y: graphY - my * height,
    width,
    height,
  };
}

export function edgePath(from: LayoutNode, to: LayoutNode): string {
  const startX = from.x + nodeWidth;
  const startY = from.y + nodeHeight / 2;
  const endX = to.x;
  const endY = to.y + nodeHeight / 2;
  const distance = Math.max(Math.abs(endX - startX) * 0.45, 80);
  return `M ${startX} ${startY} C ${startX + distance} ${startY}, ${
    endX - distance
  } ${endY}, ${endX} ${endY}`;
}

export function neighborhood(snapshot: GraphSnapshot, id: string): Set<string> {
  const ids = new Set([id]);
  for (const edge of snapshot.edges) {
    if (edge.from_node === id) ids.add(edge.to_node);
    if (edge.to_node === id) ids.add(edge.from_node);
  }
  return ids;
}

export function findingCountByNode(findings: QdFinding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    if (finding.status !== "open" || (finding.severity !== "P0" && finding.severity !== "P1"))
      continue;
    counts.set(finding.node_id, (counts.get(finding.node_id) ?? 0) + 1);
  }
  return counts;
}

export function assignmentCountByNode(snapshot: GraphSnapshot): Map<string, number> {
  const counts = new Map<string, number>();
  for (const assignment of snapshot.assignments) {
    if (assignment.status !== "open") continue;
    counts.set(assignment.node_id, (counts.get(assignment.node_id) ?? 0) + 1);
  }
  return counts;
}

export function latestRunsByKind(
  runs: GraphSnapshot["runs"],
): Map<string, GraphSnapshot["runs"][number]> {
  const byKind = new Map<string, GraphSnapshot["runs"][number]>();
  for (const run of runs) byKind.set(run.kind, run);
  return byKind;
}

export function milestoneProgress(snapshot: GraphSnapshot): Array<{
  name: string;
  done: number;
  total: number;
  percent: number;
}> {
  const names = [...new Set(snapshot.nodes.map((node) => node.milestone ?? "unassigned"))].sort();
  return names.map((name) => {
    const nodes = snapshot.nodes.filter((node) => (node.milestone ?? "unassigned") === name);
    const done = nodes.filter((node) => node.status === "done").length;
    return {
      name,
      done,
      total: nodes.length,
      percent: nodes.length === 0 ? 0 : Math.round((done / nodes.length) * 100),
    };
  });
}

export function wrapText(text: string, maxLength: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxLength) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === 0) return [text.slice(0, maxLength)];
  const last = lines.at(-1);
  if (last && words.join(" ").length > lines.join(" ").length) {
    lines[lines.length - 1] = `${last.slice(0, Math.max(maxLength - 3, 1))}...`;
  }
  return lines;
}

function compareNodes(a: QdNode, b: QdNode): number {
  return (
    (priorityRank.get(a.priority) ?? 9) - (priorityRank.get(b.priority) ?? 9) ||
    statuses.indexOf(a.status) - statuses.indexOf(b.status) ||
    a.id.localeCompare(b.id)
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
