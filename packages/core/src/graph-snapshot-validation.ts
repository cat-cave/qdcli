import { assertNodeQuality, findCycle } from "./graph-internal.js";
import { SUPPORTED_QD_EXPORT_SCHEMA_VERSIONS } from "./types.js";
import type { GraphSnapshot, QdEdge, RegistryEntry } from "./types.js";

export function validateGraphSnapshotForWrite(snapshot: GraphSnapshot): void {
  if (!SUPPORTED_QD_EXPORT_SCHEMA_VERSIONS.includes(snapshot.schema_version as 1 | 2)) {
    throw new Error(`Unsupported qd export schema_version: ${snapshot.schema_version}`);
  }
  const groups = uniqueRegistrySet(snapshot.registries.groups, "group");
  const projects = uniqueRegistrySet(snapshot.registries.projects, "project");
  const milestones = uniqueRegistrySet(snapshot.registries.milestones, "milestone");
  for (const milestone of snapshot.registries.milestones) {
    if (!Number.isInteger(milestone.rank)) {
      throw new Error(`milestone ${milestone.name} is missing integer rank`);
    }
  }

  const nodeIds = new Set<string>();
  for (const node of snapshot.nodes) {
    if (nodeIds.has(node.id)) throw new Error(`duplicate node id in qd export: ${node.id}`);
    assertNodeQuality(node);
    if (node.group_name && !groups.has(node.group_name)) {
      throw new Error(`node ${node.id} references unregistered group: ${node.group_name}`);
    }
    if (node.milestone && !milestones.has(node.milestone)) {
      throw new Error(`node ${node.id} references unregistered milestone: ${node.milestone}`);
    }
    for (const project of node.projects) {
      if (!projects.has(project)) {
        throw new Error(`node ${node.id} references unregistered project: ${project}`);
      }
    }
    nodeIds.add(node.id);
  }
  validateSnapshotEdges(snapshot.edges, nodeIds);
  validateSnapshotChildren(snapshot, nodeIds);
}

function uniqueRegistrySet(entries: RegistryEntry[], label: string): Set<string> {
  const values = new Set<string>();
  for (const entry of entries) {
    if (values.has(entry.name)) throw new Error(`duplicate ${label} in qd export: ${entry.name}`);
    values.add(entry.name);
  }
  return values;
}

function validateSnapshotEdges(edges: QdEdge[], nodeIds: Set<string>): void {
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    const edgeId = `${edge.from_node}\0${edge.to_node}\0${edge.type}`;
    if (edgeIds.has(edgeId)) {
      throw new Error(
        `duplicate edge in qd export: ${edge.from_node} -> ${edge.to_node} (${edge.type})`,
      );
    }
    edgeIds.add(edgeId);
    if (!nodeIds.has(edge.from_node))
      throw new Error(`edge references missing from node: ${edge.from_node}`);
    if (!nodeIds.has(edge.to_node))
      throw new Error(`edge references missing to node: ${edge.to_node}`);
  }
  const cycle = findCycle(edges.filter((edge) => edge.type === "requires"));
  if (cycle) throw new Error(`requires edge cycle detected: ${cycle.join(" -> ")}`);
}

function validateSnapshotChildren(snapshot: GraphSnapshot, nodeIds: Set<string>): void {
  const runIds = new Set<string>();
  for (const runEntry of snapshot.runs) {
    if (runIds.has(runEntry.id)) throw new Error(`duplicate run id in qd export: ${runEntry.id}`);
    runIds.add(runEntry.id);
    if (!nodeIds.has(runEntry.node_id)) {
      throw new Error(`run references missing node: ${runEntry.node_id}`);
    }
  }
  for (const finding of snapshot.findings) {
    if (!nodeIds.has(finding.node_id))
      throw new Error(`finding references missing node: ${finding.node_id}`);
    if (finding.run_id && !runIds.has(finding.run_id)) {
      throw new Error(`finding references missing run: ${finding.run_id}`);
    }
  }
  for (const note of snapshot.node_notes) {
    if (!nodeIds.has(note.node_id))
      throw new Error(`note references missing node: ${note.node_id}`);
  }
  validateSnapshotAssignments(snapshot, nodeIds);
}

function validateSnapshotAssignments(snapshot: GraphSnapshot, nodeIds: Set<string>): void {
  const assignmentIds = new Set<string>();
  for (const assignment of snapshot.assignments ?? []) {
    if (assignmentIds.has(assignment.id)) {
      throw new Error(`duplicate assignment id in qd export: ${assignment.id}`);
    }
    assignmentIds.add(assignment.id);
    if (!nodeIds.has(assignment.node_id)) {
      throw new Error(`assignment references missing node: ${assignment.node_id}`);
    }
  }
  const waveIds = new Set<string>();
  for (const wave of snapshot.waves ?? []) {
    if (waveIds.has(wave.id)) throw new Error(`duplicate wave id in qd export: ${wave.id}`);
    waveIds.add(wave.id);
  }
  for (const membership of snapshot.wave_memberships ?? []) {
    if (!waveIds.has(membership.wave_id)) {
      throw new Error(`wave membership references missing wave: ${membership.wave_id}`);
    }
    if (membership.node_id && !nodeIds.has(membership.node_id)) {
      throw new Error(`wave membership references missing node: ${membership.node_id}`);
    }
    if (membership.assignment_id && !assignmentIds.has(membership.assignment_id)) {
      throw new Error(`wave membership references missing assignment: ${membership.assignment_id}`);
    }
  }
}
