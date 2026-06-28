import type { GraphSnapshot } from "@cat-cave/qdcli-core";
import {
  assignmentCountByNode,
  edgePath,
  findingCountByNode,
  nodeHeight,
  nodeWidth,
  wrapText,
  type Filters,
  type LayoutGraph,
} from "./viewer-model.js";

export function GraphLegend() {
  return (
    <div className="legend">
      <span>
        <i className="legendLine requires" /> requires
      </span>
      <span>
        <i className="legendLine related" /> other edge
      </span>
      <span>
        <i className="legendNode critical" /> critical path
      </span>
    </div>
  );
}

export function GraphEdges({
  layout,
  selected,
  filteredIds,
  neighborIds,
  filters,
}: {
  layout: LayoutGraph;
  selected: string | null;
  filteredIds: Set<string>;
  neighborIds: Set<string>;
  filters: Filters;
}) {
  const byId = new Map(layout.nodes.map((item) => [item.node.id, item]));
  return (
    <g className="edges">
      {layout.edges.map((edge) => {
        const from = byId.get(edge.from_node);
        const to = byId.get(edge.to_node);
        if (!from || !to) return null;
        const highlighted = Boolean(
          selected && (edge.from_node === selected || edge.to_node === selected),
        );
        const dimmed =
          (filters.dimFiltered &&
            (!filteredIds.has(edge.from_node) || !filteredIds.has(edge.to_node))) ||
          (filters.focusSelection &&
            selected &&
            (!neighborIds.has(edge.from_node) || !neighborIds.has(edge.to_node)));
        return (
          <path
            key={`${edge.from_node}-${edge.to_node}-${edge.type}`}
            className={`edge ${edge.type} ${highlighted ? "highlighted" : ""} ${
              dimmed ? "dimmed" : ""
            }`}
            d={edgePath(from, to)}
            markerEnd={edge.type === "requires" ? "url(#arrow)" : undefined}
          />
        );
      })}
    </g>
  );
}

export function GraphNodes({
  layout,
  selected,
  filteredIds,
  neighborIds,
  criticalIds,
  filters,
  snapshot,
  onSelect,
}: {
  layout: LayoutGraph;
  selected: string | null;
  filteredIds: Set<string>;
  neighborIds: Set<string>;
  criticalIds: Set<string>;
  filters: Filters;
  snapshot: GraphSnapshot;
  onSelect: (id: string) => void;
}) {
  const findingCounts = findingCountByNode(snapshot.findings);
  const assignmentCounts = assignmentCountByNode(snapshot);
  return (
    <g className="nodes">
      {layout.nodes.map((item) => {
        const node = item.node;
        const titleLines = wrapText(node.title, 28, 2);
        const filtered = filteredIds.has(node.id);
        const selectedNode = selected === node.id;
        const focused = !selected || neighborIds.has(node.id);
        const dimmed =
          (filters.dimFiltered && !filtered) || (filters.focusSelection && selected && !focused);
        const blocking = findingCounts.get(node.id) ?? 0;
        const assignments = assignmentCounts.get(node.id) ?? 0;
        return (
          <g
            key={node.id}
            className={`graphNode ${node.status} ${selectedNode ? "selected" : ""} ${
              criticalIds.has(node.id) ? "critical" : ""
            } ${dimmed ? "dimmed" : ""}`}
            transform={`translate(${item.x} ${item.y})`}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(node.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelect(node.id);
            }}
          >
            <rect width={nodeWidth} height={nodeHeight} rx="8" />
            <rect className={`nodeRail ${node.priority}`} width="6" height={nodeHeight} rx="3" />
            <text className="nodeId" x="14" y="24">
              {node.id}
            </text>
            <text className="nodeStatus" x={nodeWidth - 14} y="24">
              {node.status}
            </text>
            {titleLines.map((line, index) => (
              <text key={line} className="nodeTitle" x="14" y={48 + index * 17}>
                {line}
              </text>
            ))}
            <text className="nodeMeta" x="14" y="80">
              {node.priority} - {node.estimate_points} pts
            </text>
            {blocking > 0 ? (
              <text className="findingBadge" x={nodeWidth - 14} y="80">
                {blocking} P0/P1
              </text>
            ) : assignments > 0 ? (
              <text className="findingBadge neutral" x={nodeWidth - 14} y="80">
                {assignments} active
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}
