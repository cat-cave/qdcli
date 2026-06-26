import { describe, expect, it } from "vite-plus/test";
import { calculateCriticalPath, calculateEta, calculateVelocity } from "./analytics.js";
import type { GraphSnapshot } from "./types.js";

describe("analytics", () => {
  it("computes critical path across remaining requires edges", () => {
    const snapshot = fixture();
    const report = calculateCriticalPath(snapshot);

    expect(report.criticalPath.map((node) => node.id)).toEqual(["a", "b"]);
    expect(report.criticalPathPoints).toBe(5);
    expect(report.totalRemainingPoints).toBe(6);
  });

  it("computes velocity and ETA from completed points", () => {
    const now = new Date("2026-06-25T00:00:00.000Z");
    const snapshot = fixture();
    const velocity = calculateVelocity(snapshot, 5, now);
    const eta = calculateEta(snapshot, null, 5, now);

    expect(velocity.completedPoints).toBe(10);
    expect(velocity.pointsPerDay).toBe(2);
    expect(eta.etaDays).toBe(2.5);
    expect(eta.criticalPathPoints).toBe(5);
  });
});

function fixture(): GraphSnapshot {
  return {
    schema_version: 1,
    exported_at: "2026-06-25T00:00:00.000Z",
    registries: {
      groups: [],
      projects: [],
      milestones: [],
    },
    nodes: [
      node("done", "Done", "done", 10, "2026-06-22T00:00:00.000Z"),
      node("a", "A", "ready", 2),
      node("b", "B", "ready", 3),
      node("c", "C", "ready", 1),
    ],
    edges: [
      {
        from_node: "a",
        to_node: "b",
        type: "requires",
        created_at: "2026-06-20T00:00:00.000Z",
      },
      {
        from_node: "done",
        to_node: "a",
        type: "requires",
        created_at: "2026-06-20T00:00:00.000Z",
      },
    ],
    findings: [],
    runs: [],
    node_notes: [],
  };
}

function node(
  id: string,
  title: string,
  status: GraphSnapshot["nodes"][number]["status"],
  points: number,
  doneAt: string | null = null,
) {
  return {
    id,
    title,
    kind: "feature" as const,
    milestone: null,
    status,
    priority: "P2" as const,
    estimate_points: points,
    risk: "medium" as const,
    owner: null,
    branch: null,
    spec: title,
    acceptance: title,
    validation: null,
    group_name: null,
    projects: [],
    verification: [],
    audit_focus: [],
    status_reason: null,
    check_command: null,
    context: null,
    created_at: "2026-06-20T00:00:00.000Z",
    updated_at: "2026-06-20T00:00:00.000Z",
    claimed_at: doneAt ? "2026-06-21T00:00:00.000Z" : null,
    done_at: doneAt,
  };
}
