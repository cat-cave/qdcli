import { describe, expect, it } from "vite-plus/test";
import {
  calculateCriticalPath,
  calculateEta,
  calculateStats,
  calculateVelocity,
} from "./analytics.js";
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

  it("uses the default velocity window and includes completions on the boundary", () => {
    const now = new Date("2026-06-25T00:00:00.000Z");
    const snapshot = fixture();
    snapshot.nodes.push(
      node("boundary", "Boundary", "done", 4, "2026-06-18T00:00:00.000Z"),
      node("old", "Old", "done", 8, "2026-06-17T23:59:59.999Z"),
    );

    const velocity = calculateVelocity(snapshot, undefined, now);

    expect(velocity.windowDays).toBe(7);
    expect(velocity.completedNodes).toBe(2);
    expect(velocity.completedPoints).toBe(14);
    expect(velocity.pointsPerDay).toBe(2);
  });

  it("ignores non-done and invalid cycle-time candidates in velocity reports", () => {
    const now = new Date("2026-06-25T00:00:00.000Z");
    const snapshot = fixture();
    snapshot.nodes.push(
      {
        ...node("done-without-date", "Done without date", "done", 5),
        claimed_at: "2026-06-23T00:00:00.000Z",
      },
      {
        ...node("working-with-date", "Working with date", "working", 7, "2026-06-24T00:00:00.000Z"),
        claimed_at: "2026-06-23T00:00:00.000Z",
      },
      {
        ...node("negative-cycle", "Negative cycle", "done", 1, "2026-06-24T00:00:00.000Z"),
        claimed_at: "2026-06-25T00:00:00.000Z",
      },
      {
        ...node("invalid-cycle", "Invalid cycle", "done", 1, "2026-06-24T00:00:00.000Z"),
        claimed_at: "not-a-date",
      },
    );

    const velocity = calculateVelocity(snapshot, 5, now);

    expect(velocity.completedNodes).toBe(3);
    expect(velocity.completedPoints).toBe(12);
    expect(velocity.averageCycleHours).toBe(24);
  });

  it("includes zero-hour cycle times in average velocity reports", () => {
    const now = new Date("2026-06-25T00:00:00.000Z");
    const snapshot = fixture();
    snapshot.nodes.push({
      ...node("instant", "Instant", "done", 2, "2026-06-24T00:00:00.000Z"),
      claimed_at: "2026-06-24T00:00:00.000Z",
    });

    const velocity = calculateVelocity(snapshot, 5, now);

    expect(velocity.completedNodes).toBe(2);
    expect(velocity.completedPoints).toBe(12);
    expect(velocity.averageCycleHours).toBe(12);
  });

  it("returns null ETA when no recent velocity exists", () => {
    const now = new Date("2026-07-25T00:00:00.000Z");
    const eta = calculateEta(fixture(), null, 5, now);

    expect(eta.velocityPointsPerDay).toBe(0);
    expect(eta.etaDays).toBeNull();
    expect(eta.etaDate).toBeNull();
  });

  it("computes the exact ETA date from the current time and velocity", () => {
    const now = new Date("2026-06-25T12:00:00.000Z");
    const eta = calculateEta(fixture(), null, 5, now);

    expect(eta.etaDays).toBe(2.5);
    expect(eta.etaDate).toBe("2026-06-28T00:00:00.000Z");
  });

  it("scopes critical path reports to a milestone", () => {
    const snapshot = fixture();
    snapshot.nodes = snapshot.nodes.map((node) => ({
      ...node,
      milestone: node.id === "c" ? "later" : "baseline",
    }));

    const report = calculateCriticalPath(snapshot, "later");

    expect(report.milestone).toBe("later");
    expect(report.totalRemainingPoints).toBe(1);
    expect(report.criticalPath.map((node) => node.id)).toEqual(["c"]);
  });

  it("excludes cancelled nodes and non-requires edges from the critical path", () => {
    const snapshot = fixture();
    snapshot.nodes.find((item) => item.id === "c")!.status = "cancelled";
    snapshot.edges.push({
      from_node: "b",
      to_node: "c",
      type: "related",
      created_at: "2026-06-20T00:00:00.000Z",
    });

    const report = calculateCriticalPath(snapshot);

    expect(report.totalRemainingPoints).toBe(5);
    expect(report.criticalPath.map((node) => node.id)).toEqual(["a", "b"]);
    expect(report.criticalPath.every((item) => item.status !== "cancelled")).toBe(true);
  });

  it("chooses the highest-value branch and root for the critical path", () => {
    const snapshot = fixture();
    snapshot.nodes.push(
      node("short-child", "Short child", "ready", 1),
      node("long-child", "Long child", "ready", 8),
      node("largest-root", "Largest root", "ready", 20),
    );
    snapshot.edges.push(
      {
        from_node: "a",
        to_node: "short-child",
        type: "requires",
        created_at: "2026-06-20T00:00:00.000Z",
      },
      {
        from_node: "a",
        to_node: "long-child",
        type: "requires",
        created_at: "2026-06-20T00:00:00.000Z",
      },
    );

    const report = calculateCriticalPath(snapshot);

    expect(report.criticalPathPoints).toBe(20);
    expect(report.criticalPath.map((item) => item.id)).toEqual(["largest-root"]);
  });

  it("returns an empty critical path when every scoped node is done or cancelled", () => {
    const snapshot = fixture();
    snapshot.nodes = snapshot.nodes.map((item) => ({
      ...item,
      milestone: "finished",
      status: item.id === "c" ? "cancelled" : "done",
      done_at: item.id === "c" ? null : "2026-06-24T00:00:00.000Z",
    }));

    const report = calculateCriticalPath(snapshot, "finished");

    expect(report.totalRemainingPoints).toBe(0);
    expect(report.criticalPathPoints).toBe(0);
    expect(report.criticalPath).toEqual([]);
  });

  it("counts ready nodes and open blocking findings in stats", () => {
    const snapshot = fixture();
    snapshot.findings.push({
      id: "finding-1",
      node_id: "a",
      run_id: null,
      severity: "P1",
      status: "open",
      title: "Blocking finding",
      path: null,
      line: null,
      evidence: "A blocking issue remains.",
      expected: null,
      suggested_fix: null,
      created_at: "2026-06-24T00:00:00.000Z",
      resolved_at: null,
    });

    const stats = calculateStats(snapshot);

    expect(stats.ready).toBe(2);
    expect(stats.openP0P1Findings).toBe(1);
    expect(stats.remainingPoints).toBe(6);
  });

  it("ignores resolved and lower-severity findings in blocking stats", () => {
    const snapshot = fixture();
    snapshot.findings.push(
      finding("open-p0", "P0", "open"),
      finding("open-p2", "P2", "open"),
      finding("resolved-p1", "P1", "resolved"),
      finding("dismissed-p0", "P0", "dismissed"),
    );

    const stats = calculateStats(snapshot);

    expect(stats.openP0P1Findings).toBe(1);
  });

  it("counts regressed nodes as ready candidates but excludes blocked nodes", () => {
    const snapshot = fixture();
    snapshot.nodes.find((item) => item.id === "a")!.status = "regressed";
    snapshot.nodes.find((item) => item.id === "c")!.status = "blocked";

    const stats = calculateStats(snapshot);

    expect(stats.ready).toBe(1);
  });

  it("treats unknown required nodes as blocking ready status", () => {
    const snapshot = fixture();
    snapshot.edges.push({
      from_node: "missing",
      to_node: "c",
      type: "requires",
      created_at: "2026-06-20T00:00:00.000Z",
    });

    const stats = calculateStats(snapshot);

    expect(stats.ready).toBe(1);
    expect(stats.byStatus).toMatchObject({ done: 1, ready: 3 });
    expect(stats.donePoints).toBe(10);
    expect(stats.totalPoints).toBe(16);
  });
});

function finding(
  id: string,
  severity: GraphSnapshot["findings"][number]["severity"],
  status: GraphSnapshot["findings"][number]["status"],
): GraphSnapshot["findings"][number] {
  return {
    id,
    node_id: "a",
    run_id: null,
    severity,
    status,
    title: id,
    path: null,
    line: null,
    evidence: id,
    expected: null,
    suggested_fix: null,
    created_at: "2026-06-24T00:00:00.000Z",
    resolved_at: status === "resolved" ? "2026-06-25T00:00:00.000Z" : null,
  };
}

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
    assignments: [],
    waves: [],
    wave_memberships: [],
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
    ci_command: null,
    blocked_by: null,
    blocked_reason: null,
    blocked_owner: null,
    context: null,
    created_at: "2026-06-20T00:00:00.000Z",
    updated_at: "2026-06-20T00:00:00.000Z",
    claimed_at: doneAt ? "2026-06-21T00:00:00.000Z" : null,
    done_at: doneAt,
  };
}
