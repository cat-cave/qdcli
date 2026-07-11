import { applyMigrations, get, openDatabase, run } from "./db.js";
import {
  assertNodeQuality,
  ensureNodeMetadataRegistered,
  hydrateNode,
  insertEdge,
  insertNode,
  nodeExists,
  nodeFromInput,
  slugify,
  uniqueNodeId,
  type NodeRow,
} from "./graph-internal.js";
import type { AddNodeInput, BulkAddResult, BulkEdgeInput } from "./graph-types.js";
import type { QdEdge, QdNode } from "./types.js";

export async function addNodesBulk(
  root: string,
  input: { nodes: AddNodeInput[]; edges?: BulkEdgeInput[] },
): Promise<BulkAddResult> {
  const db = await openDatabase(root);
  await applyMigrations(db);
  await run(db, "begin immediate");
  try {
    const now = new Date().toISOString();
    const reserved = new Set<string>();
    const candidates: QdNode[] = [];
    for (const nodeInput of input.nodes) {
      const id = nodeInput.id ?? (await uniqueNodeId(db, slugify(nodeInput.title), reserved));
      if (reserved.has(id)) throw new Error(`duplicate node id in bulk add: ${id}`);
      reserved.add(id);
      const node = nodeFromInput(nodeInput, id, now);
      assertNodeQuality(node);
      candidates.push(node);
    }
    const nodes: QdNode[] = [];
    const nodeResults: BulkAddResult["nodeResults"] = [];
    for (const candidate of candidates) {
      const existingRow = await get<NodeRow>(db, "select * from nodes where id = ?", [
        candidate.id,
      ]);
      if (!existingRow) {
        nodes.push(candidate);
        nodeResults.push({ id: candidate.id, status: "added", node: candidate });
        continue;
      }
      const existing = hydrateNode(existingRow);
      const changedFields = bulkNodeChangedFields(existing, candidate);
      if (changedFields.length > 0) {
        throw new Error(
          `bulk node ${candidate.id} already exists with different fields: ${changedFields.join(", ")}`,
        );
      }
      nodeResults.push({ id: candidate.id, status: "skipped-existing", node: existing });
    }
    await ensureNodeMetadataRegistered(db, nodes, now);
    for (const node of nodes) await insertNode(db, node);

    const edges: QdEdge[] = [];
    const nodeIds = new Set(candidates.map((node) => node.id));
    const edgeResults: BulkAddResult["edgeResults"] = [];
    for (const edgeInput of input.edges ?? []) {
      const type = edgeInput.type ?? "requires";
      if (!nodeIds.has(edgeInput.from) && !(await nodeExists(db, edgeInput.from))) {
        throw new Error(`edge references missing from node: ${edgeInput.from}`);
      }
      if (!nodeIds.has(edgeInput.to) && !(await nodeExists(db, edgeInput.to))) {
        throw new Error(`edge references missing to node: ${edgeInput.to}`);
      }
      const existing = await get<QdEdge>(
        db,
        "select * from edges where from_node = ? and to_node = ? and type = ?",
        [edgeInput.from, edgeInput.to, type],
      );
      if (existing) {
        edgeResults.push({
          from: edgeInput.from,
          to: edgeInput.to,
          type,
          status: "skipped-existing",
          edge: existing,
        });
        continue;
      }
      const edge = await insertEdge(db, edgeInput.from, edgeInput.to, type, now);
      edges.push(edge);
      edgeResults.push({
        from: edgeInput.from,
        to: edgeInput.to,
        type,
        status: "added",
        edge,
      });
    }
    await run(db, "commit");
    return {
      nodes,
      edges,
      nodeResults,
      edgeResults,
      summary: {
        addedNodes: nodes.length,
        skippedNodes: nodeResults.length - nodes.length,
        addedEdges: edges.length,
        skippedEdges: edgeResults.length - edges.length,
      },
    };
  } catch (error) {
    await run(db, "rollback");
    throw error;
  }
}

const BULK_NODE_FIELDS = [
  "title",
  "kind",
  "milestone",
  "group_name",
  "projects",
  "priority",
  "estimate_points",
  "risk",
  "spec",
  "acceptance",
  "validation",
  "verification",
  "audit_focus",
  "context",
  "status_reason",
  "check_command",
  "ci_command",
] as const satisfies ReadonlyArray<keyof QdNode>;

function bulkNodeChangedFields(existing: QdNode, candidate: QdNode): string[] {
  return BULK_NODE_FIELDS.filter(
    (field) => JSON.stringify(existing[field]) !== JSON.stringify(candidate[field]),
  );
}
