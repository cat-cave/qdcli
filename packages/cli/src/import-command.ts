import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  addNodesBulk,
  adaptImportSource,
  deterministicGraphSnapshot,
  graphSnapshot,
  listNodes,
  replaceGraphSnapshot,
  restoreGraphSnapshot,
  validateGraphSnapshotForWrite,
  type EdgeType,
  type GraphSnapshot,
} from "@cat-cave/qdcli-core";
import { output, required, stringOpt } from "./args.js";
import { EDGE_TYPES, importAdapter, isEdgeType, strictOptionalEnum } from "./enums.js";
import {
  defaultImportMapping,
  droppedTopLevelKeys,
  findImportCycle,
  importVerbose,
  mapImportNode,
  planImportEdge,
  usedNodeMappingKeys,
  validateNodeEdgesMapping,
  type ImportMapping,
  type ImportReport,
  type PlannedImportEdge,
  type PlannedImportNode,
} from "./import-mapping.js";
import { qdNodeFromInput, registriesFromNodes } from "./node-input.js";
import { canonicalSnapshotFrom, strictArrayAtPath, stringAt } from "./object-utils.js";
import { snapshotDiff } from "./graph-format.js";

export async function importCommand(
  root: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const filePath = path.resolve(root, required(options.from, "--from"));
  const mappingPath = stringOpt(options["schema-mapping"]);
  const adapter = stringOpt(options.adapter);
  const dryRun = Boolean(options["dry-run"]);
  const verbose = Boolean(options.verbose);
  const allowDefaults = Boolean(options["allow-defaults"]);
  const merge = Boolean(options.merge);
  if (adapter && mappingPath) {
    throw new Error("qd import --adapter cannot be combined with --schema-mapping");
  }
  const source = adapter
    ? adaptImportSource(importAdapter(adapter), await readFile(filePath, "utf8"))
    : (JSON.parse(await readFile(filePath, "utf8")) as unknown);
  const canonicalSnapshot = adapter ? undefined : canonicalSnapshotFrom(source);
  if (canonicalSnapshot && !mappingPath) {
    const report = {
      ok: true,
      dryRun,
      format: "qd-export",
      nodesFound: canonicalSnapshot.nodes.length,
      edgesFound: canonicalSnapshot.edges.length,
      findingsFound: canonicalSnapshot.findings.length,
      runsFound: canonicalSnapshot.runs.length,
      nodeNotesFound: canonicalSnapshot.node_notes.length,
      importedNodes: dryRun ? 0 : canonicalSnapshot.nodes.length,
      importedEdges: dryRun ? 0 : canonicalSnapshot.edges.length,
      importedFindings: dryRun ? 0 : canonicalSnapshot.findings.length,
      importedRuns: dryRun ? 0 : canonicalSnapshot.runs.length,
      importedNodeNotes: dryRun ? 0 : canonicalSnapshot.node_notes.length,
    };
    if (!dryRun) {
      if (merge) await replaceGraphSnapshot(root, canonicalSnapshot);
      else await restoreGraphSnapshot(root, canonicalSnapshot);
    }
    return output(report, json);
  }

  const mapping = mappingPath
    ? (JSON.parse(await readFile(path.resolve(root, mappingPath), "utf8")) as ImportMapping)
    : defaultImportMapping;
  const nodes = strictArrayAtPath(source, mapping.nodesPath ?? "nodes", true);
  const edges = strictArrayAtPath(source, mapping.edgesPath ?? "edges", false);
  const report = buildImportReport(dryRun, nodes.length, edges.length);
  const plannedImportEdges: PlannedImportEdge[] = [];
  const plannedEdges = new Set<string>();
  const plannedNodes = planNodes(nodes, mapping, report, verbose);
  planEdges(edges, mapping, plannedImportEdges, report, plannedEdges);
  planNodeEdges(plannedNodes, mapping, plannedImportEdges, report, plannedEdges);
  validateImportPlan(plannedNodes, plannedImportEdges, report);
  await enforceImportWritePreconditions(root, report, { dryRun, allowDefaults, merge });

  const importedNodes = [];
  const importedEdges = [];
  if (report.errors.length === 0 && !dryRun) {
    if (merge) {
      const snapshot = snapshotFromImportPlan(plannedNodes, plannedImportEdges);
      await replaceGraphSnapshot(root, snapshot);
      importedNodes.push(...snapshot.nodes);
      importedEdges.push(...plannedImportEdges);
    } else {
      const created = await addNodesBulk(root, {
        nodes: plannedNodes.map((node) => node.input),
        edges: plannedImportEdges,
      });
      importedNodes.push(...created.nodes);
      importedEdges.push(...created.edges);
    }
  }

  if (dryRun && report.errors.length === 0) {
    importedNodes.push(...plannedNodes.map((node) => node.input));
    importedEdges.push(...plannedImportEdges);
  }
  report.importedNodes = importedNodes.length;
  report.importedEdges = importedEdges.length;
  report.ok = report.errors.length === 0;
  output(report, json);
  if (!report.ok) process.exitCode = 1;
}

export async function syncCommand(
  root: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const filePath = path.resolve(root, required(options.from, "--from"));
  const snapshot = canonicalSnapshotFrom(JSON.parse(await readFile(filePath, "utf8")) as unknown);
  if (!snapshot) throw new Error("qd sync requires a canonical qd export JSON file");
  validateGraphSnapshotForWrite(snapshot);
  const live = await graphSnapshot(root);
  const diff = snapshotDiff(live, snapshot);
  if (options["dry-run"]) {
    output(
      {
        ok: true,
        dryRun: true,
        path: path.relative(root, filePath),
        wouldReplace: !diff.ok,
        diff,
        nodes: snapshot.nodes.length,
        edges: snapshot.edges.length,
        findings: snapshot.findings.length,
        runs: snapshot.runs.length,
        nodeNotes: snapshot.node_notes.length,
      },
      json,
    );
    return;
  }
  await replaceGraphSnapshot(root, snapshot);
  return output(
    {
      ok: true,
      path: path.relative(root, filePath),
      replaced: !diff.ok,
      diff,
      nodes: snapshot.nodes.length,
      edges: snapshot.edges.length,
      findings: snapshot.findings.length,
      runs: snapshot.runs.length,
      nodeNotes: snapshot.node_notes.length,
    },
    json,
  );
}

export function buildImportReport(
  dryRun: boolean,
  nodesFound: number,
  edgesFound: number,
): ImportReport {
  const report: ImportReport = {
    ok: true,
    dryRun,
    nodesFound,
    edgesFound,
    importedNodes: 0,
    importedEdges: 0,
    defaults: [],
    droppedFields: [],
    warnings: [],
    errors: [],
    nodes: [],
    edges: [],
  };
  if (nodesFound === 0) report.errors.push("No nodes found at nodes");
  return report;
}

export function planNodes(
  nodes: unknown[],
  mapping: ImportMapping,
  report: ImportReport,
  verbose: boolean,
): PlannedImportNode[] {
  const nodeKeysUsed = usedNodeMappingKeys(mapping);
  return nodes.flatMap((raw, index): PlannedImportNode[] => {
    try {
      const planned = mapImportNode(raw, index, mapping, report, verbose);
      const dropped = droppedTopLevelKeys(raw, nodeKeysUsed);
      if (dropped.length > 0) {
        report.droppedFields.push({
          nodeId: planned.input.id ?? planned.sourceId,
          fields: dropped,
        });
        if (verbose) {
          importVerbose(`node ${planned.sourceId}: dropped unmapped fields ${dropped.join(", ")}`);
        }
      }
      report.nodes.push(planned.input);
      return [planned];
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error));
      return [];
    }
  });
}

export function planEdges(
  edges: unknown[],
  mapping: ImportMapping,
  plannedImportEdges: PlannedImportEdge[],
  report: ImportReport,
  plannedEdges: Set<string>,
): void {
  for (const [index, raw] of edges.entries()) {
    const from = stringAt(raw, mapping.edgeFrom ?? "from");
    const to = stringAt(raw, mapping.edgeTo ?? "to");
    if (!from || !to) {
      report.errors.push(
        `edges[${index}] must include ${mapping.edgeFrom ?? "from"} and ${mapping.edgeTo ?? "to"}`,
      );
      continue;
    }
    try {
      const type = strictOptionalEnum<EdgeType>(
        stringAt(raw, mapping.edgeType ?? "type"),
        isEdgeType,
        "edge.type",
        "requires",
      );
      planImportEdge({ from, to, type, source: "edges" }, plannedImportEdges, report, plannedEdges);
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
}

export function planNodeEdges(
  plannedNodes: PlannedImportNode[],
  mapping: ImportMapping,
  plannedImportEdges: PlannedImportEdge[],
  report: ImportReport,
  plannedEdges: Set<string>,
): void {
  if (!mapping.nodeEdges) return;
  try {
    validateNodeEdgesMapping(mapping.nodeEdges);
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  }
  for (const planned of plannedNodes) {
    const refs = readNodeEdgeRefs(planned, mapping, report);
    if (refs.length === 0) continue;
    const type = mapping.nodeEdges.edgeType ?? "requires";
    if (!isEdgeType(type)) {
      report.errors.push(`nodeEdges.edgeType must be one of ${EDGE_TYPES.join(", ")}`);
      continue;
    }
    for (const ref of refs) {
      const edge =
        mapping.nodeEdges.edgeDirection === "deps-block-this-node"
          ? { from: ref, to: planned.sourceId, type, source: `nodeEdges:${mapping.nodeEdges.path}` }
          : {
              from: planned.sourceId,
              to: ref,
              type,
              source: `nodeEdges:${mapping.nodeEdges.path}`,
            };
      planImportEdge(edge, plannedImportEdges, report, plannedEdges);
    }
  }
}

export function readNodeEdgeRefs(
  planned: PlannedImportNode,
  mapping: ImportMapping,
  report: ImportReport,
): string[] {
  if (!mapping.nodeEdges) return [];
  try {
    return strictArrayAtPath(planned.raw, mapping.nodeEdges.path, false).map((value) => {
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`node ${planned.sourceId}.nodeEdges must contain non-empty strings`);
      }
      return value.trim();
    });
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
    return [];
  }
}

export function validateImportPlan(
  plannedNodes: PlannedImportNode[],
  plannedImportEdges: PlannedImportEdge[],
  report: ImportReport,
): void {
  if (report.errors.length > 0) return;
  const nodeIds = new Set(plannedNodes.map((node) => node.sourceId));
  if (nodeIds.size !== plannedNodes.length)
    report.errors.push("Import contains duplicate node ids");
  for (const edge of plannedImportEdges) {
    if (!nodeIds.has(edge.from))
      report.errors.push(`edge references missing from node: ${edge.from}`);
    if (!nodeIds.has(edge.to)) report.errors.push(`edge references missing to node: ${edge.to}`);
  }
  const cycle = findImportCycle(plannedImportEdges.filter((edge) => edge.type === "requires"));
  if (cycle) report.errors.push(`requires edge cycle detected: ${cycle.join(" -> ")}`);
}

export async function enforceImportWritePreconditions(
  root: string,
  report: ImportReport,
  options: { dryRun: boolean; allowDefaults: boolean; merge: boolean },
): Promise<void> {
  if (report.errors.length > 0 || options.dryRun) return;
  if (!options.allowDefaults && report.defaults.length > 0) {
    report.errors.push(
      `Import would use ${report.defaults.length} defaulted field(s). Re-run with --allow-defaults if those defaults are intentional.`,
    );
  }
  if (report.errors.length > 0) return;
  const existingNodes = await listNodes(root);
  if (existingNodes.length > 0 && !options.merge) {
    report.errors.push(
      "qd import requires an empty qd DAG. Run imports before creating nodes, use --merge for explicit sync semantics, or use --dry-run to inspect a mapping.",
    );
  }
}

export function snapshotFromImportPlan(
  plannedNodes: PlannedImportNode[],
  plannedImportEdges: PlannedImportEdge[],
): GraphSnapshot {
  const now = new Date().toISOString();
  const nodesForSnapshot = plannedNodes.map((node) =>
    qdNodeFromInput(node.input, node.input.id ?? node.sourceId, now),
  );
  return deterministicGraphSnapshot({
    schema_version: 1,
    exported_at: now,
    registries: registriesFromNodes(nodesForSnapshot, now),
    nodes: nodesForSnapshot,
    edges: plannedImportEdges.map((edge) => ({
      from_node: edge.from,
      to_node: edge.to,
      type: edge.type,
      created_at: now,
    })),
    findings: [],
    runs: [],
    node_notes: [],
    assignments: [],
    waves: [],
    wave_memberships: [],
  });
}
