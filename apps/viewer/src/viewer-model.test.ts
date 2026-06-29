import { describe, expect, it } from "vite-plus/test";
import type { GraphSnapshot, NodeStatus, QdNode } from "@cat-cave/qdcli-core";
import { boundsForLayoutNodes, buildLayout, emptySnapshot } from "./viewer-model.js";

describe("viewer model", () => {
  it("lays nodes out by dependencies, milestone rank, or lifecycle status", () => {
    const snapshot = snapshotWith([
      node("setup", { milestone: "baseline", status: "done" }),
      node("feature", { milestone: "alpha", status: "working" }),
      node("release", { milestone: "beta", status: "ready" }),
    ]);
    snapshot.edges.push({
      from_node: "setup",
      to_node: "feature",
      type: "requires",
      created_at: "1970-01-01T00:00:00.000Z",
    });
    snapshot.registries.milestones = [
      { name: "baseline", rank: 10, created_at: "1970-01-01T00:00:00.000Z" },
      { name: "alpha", rank: 20, created_at: "1970-01-01T00:00:00.000Z" },
      { name: "beta", rank: 30, created_at: "1970-01-01T00:00:00.000Z" },
    ];
    const ids = new Set(snapshot.nodes.map((item) => item.id));

    const dependency = layerById(buildLayout(snapshot, ids, "dependencies"));
    expect(dependency.get("setup")).toBe(0);
    expect(dependency.get("feature")).toBe(1);
    expect(dependency.get("release")).toBe(0);

    const milestone = layerById(buildLayout(snapshot, ids, "milestones"));
    expect(milestone.get("setup")).toBe(0);
    expect(milestone.get("feature")).toBe(1);
    expect(milestone.get("release")).toBe(2);

    const status = layerById(buildLayout(snapshot, ids, "status"));
    expect(status.get("release")).toBeLessThan(status.get("feature") ?? Number.MAX_SAFE_INTEGER);
    expect(status.get("feature")).toBeLessThan(status.get("setup") ?? Number.MAX_SAFE_INTEGER);
  });

  it("calculates bounds for selected neighborhoods", () => {
    const snapshot = snapshotWith([node("a"), node("b")]);
    snapshot.edges.push({
      from_node: "a",
      to_node: "b",
      type: "requires",
      created_at: "1970-01-01T00:00:00.000Z",
    });
    const layout = buildLayout(snapshot, new Set(["a", "b"]), "dependencies");

    expect(boundsForLayoutNodes([])).toBeNull();
    expect(boundsForLayoutNodes(layout.nodes)).toMatchObject({
      x: 80,
      y: 80,
      width: 580,
      height: 92,
    });
  });
});

function layerById(layout: ReturnType<typeof buildLayout>): Map<string, number> {
  return new Map(layout.nodes.map((item) => [item.node.id, item.layer]));
}

function snapshotWith(nodes: QdNode[]): GraphSnapshot {
  return {
    ...emptySnapshot,
    registries: { groups: [], projects: [], milestones: [] },
    nodes,
    edges: [],
  };
}

function node(id: string, input: Partial<QdNode> = {}): QdNode {
  return {
    id,
    title: id,
    kind: "feature",
    milestone: null,
    group_name: null,
    projects: [],
    status: "ready" as NodeStatus,
    priority: "P2",
    estimate_points: 1,
    risk: "low",
    owner: null,
    branch: null,
    spec: "spec",
    acceptance: "acceptance",
    validation: null,
    verification: [],
    audit_focus: [],
    context: null,
    status_reason: null,
    check_command: null,
    ci_command: null,
    blocked_by: null,
    blocked_reason: null,
    blocked_owner: null,
    created_at: "1970-01-01T00:00:00.000Z",
    updated_at: "1970-01-01T00:00:00.000Z",
    claimed_at: null,
    done_at: null,
    ...input,
  };
}
