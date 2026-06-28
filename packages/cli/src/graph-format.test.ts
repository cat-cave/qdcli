import { describe, expect, it } from "vite-plus/test";
import type { GraphSnapshot } from "@cat-cave/qdcli-core";
import {
  compareNodeRows,
  filterNodes,
  filterSnapshot,
  formatCell,
  formatRows,
  nextStepForNode,
  snapshotDiff,
  toDot,
  toMermaid,
} from "./graph-format.js";

describe("graph formatting helpers", () => {
  it("filters snapshots across node-owned collections and keeps matching wave memberships", () => {
    const snapshot = snapshotFixture([
      node("alpha", "Alpha", { status: "ready", milestone: "m1" }),
      node("beta", "Beta", { status: "review", milestone: "m1" }),
      node("gamma", "Gamma", { status: "review", milestone: "m2" }),
    ]);
    snapshot.edges.push(edge("alpha", "beta"), edge("beta", "gamma"), {
      ...edge("alpha", "gamma"),
      type: "related",
    });
    snapshot.findings.push(finding("f-alpha", "alpha"), finding("f-beta", "beta"));
    snapshot.runs.push(run("run-alpha", "alpha"), run("run-beta", "beta"));
    snapshot.node_notes.push(note("note-alpha", "alpha"), note("note-beta", "beta"));
    snapshot.assignments.push(assignment("assignment-beta", "beta"));
    snapshot.wave_memberships.push(
      { wave_id: "wave-1", node_id: "beta", assignment_id: null, created_at: timestamp },
      {
        wave_id: "wave-1",
        node_id: null,
        assignment_id: "assignment-beta",
        created_at: timestamp,
      },
      {
        wave_id: "wave-1",
        node_id: null,
        assignment_id: "assignment-alpha",
        created_at: timestamp,
      },
    );

    const filtered = filterSnapshot(snapshot, { statuses: ["review"], milestone: "m1" });

    expect(filtered.nodes.map((item) => item.id)).toEqual(["beta"]);
    expect(filtered.edges).toEqual([]);
    expect(filtered.findings.map((item) => item.id)).toEqual(["f-beta"]);
    expect(filtered.runs.map((item) => item.id)).toEqual(["run-beta"]);
    expect(filtered.node_notes.map((item) => item.id)).toEqual(["note-beta"]);
    expect(filtered.assignments.map((item) => item.id)).toEqual(["assignment-beta"]);
    expect(filtered.wave_memberships).toHaveLength(2);
    expect(filterSnapshot(snapshot, {})).toBe(snapshot);
  });

  it("reports snapshot diffs only when ids or serialized node data differ", () => {
    const live = snapshotFixture([
      node("same", "Same"),
      node("changed", "Before"),
      node("live-only", "Live"),
    ]);
    const exported = snapshotFixture([
      node("same", "Same"),
      node("changed", "After"),
      node("export-only", "Export"),
    ]);

    expect(snapshotDiff(live, snapshotFixture(live.nodes))).toMatchObject({
      ok: true,
      liveOnlyNodes: [],
      exportOnlyNodes: [],
      changedNodes: [],
    });
    expect(snapshotDiff(live, exported)).toMatchObject({
      ok: false,
      liveOnlyNodes: ["live-only"],
      exportOnlyNodes: ["export-only"],
      changedNodes: ["changed"],
      liveNodeCount: 3,
      exportNodeCount: 3,
    });
  });

  it("filters, sorts, and limits node rows with every supported selector", () => {
    const nodes = [
      node("zeta", "Zeta", {
        priority: "P2",
        estimate_points: 5,
        kind: "fix",
        status: "ready",
        milestone: "m1",
        projects: ["cli"],
        group_name: "runtime",
      }),
      node("alpha", "Alpha", {
        priority: "P0",
        estimate_points: 8,
        kind: "feature",
        status: "review",
        milestone: "m1",
        projects: ["cli", "viewer"],
        group_name: "runtime",
      }),
      node("beta", "Beta", {
        priority: "P0",
        estimate_points: 3,
        kind: "feature",
        status: "review",
        milestone: "m1",
        projects: ["viewer"],
        group_name: "runtime",
      }),
      node("gamma", "Gamma", {
        priority: "P1",
        estimate_points: 1,
        kind: "feature",
        status: "review",
        milestone: "m2",
        projects: ["viewer"],
        group_name: "api",
      }),
    ];

    expect(
      filterNodes(nodes, {
        status: "review",
        priority: "P0,P1",
        kind: "feature",
        milestone: "m1",
        project: "viewer",
        group: "runtime",
      }).map((item) => item.id),
    ).toEqual(["beta", "alpha"]);
    expect(filterNodes(nodes, { limit: "2" }).map((item) => item.id)).toEqual(["beta", "alpha"]);
    expect(filterNodes(nodes, { status: "ready" }).map((item) => item.id)).toEqual(["zeta"]);
    expect(filterNodes(nodes, { priority: "P1" }).map((item) => item.id)).toEqual(["gamma"]);
    expect(filterNodes(nodes, { kind: "fix" }).map((item) => item.id)).toEqual(["zeta"]);
    expect(filterNodes(nodes, { milestone: "m2" }).map((item) => item.id)).toEqual(["gamma"]);
    expect(filterNodes(nodes, { project: "cli" }).map((item) => item.id)).toEqual([
      "alpha",
      "zeta",
    ]);
    expect(filterNodes(nodes, { group: "api" }).map((item) => item.id)).toEqual(["gamma"]);
    expect(compareNodeRows(node("a", "A", { estimate_points: 2 }), node("b", "B"))).toBe(1);
  });

  it("formats selected rows, empty cells, and primitive cells predictably", () => {
    const rows = [
      { id: "a", title: "Alpha", status: "ready", nested: { ok: true }, count: 2 },
      { id: "b", title: "Beta", status: "done", nested: null, count: false },
    ];

    expect(formatRows(rows, { fields: " id, nested , count ", tsv: true })).toBe(
      'id\tnested\tcount\na\t{"ok":true}\t2\nb\t\tfalse',
    );
    expect(formatRows([], { tsv: true })).toBe("");
    expect(formatRows(rows, { compact: true })).toEqual([
      { id: "a", title: "Alpha", status: "ready", priority: undefined, milestone: undefined },
      { id: "b", title: "Beta", status: "done", priority: undefined, milestone: undefined },
    ]);
    expect(formatCell(undefined)).toBe("");
    expect(formatCell("text")).toBe("text");
  });

  it("selects the next CLI action from blockers, audits, recovery runs, and CI state", () => {
    const blocked = node("work", "Work", { status: "blocked" });
    const cleanGate = { blocking: [], runningAudits: [] };

    expect(
      nextStepForNode(blocked, { blocking: [{ id: "finding-1" }], runningAudits: [] }, null, null),
    ).toBe("qd finding resolve finding-1");
    expect(
      nextStepForNode(blocked, { blocking: [], runningAudits: [{ id: "audit-1" }] }, null, null),
    ).toBe("qd audit pass work --run-id audit-1 --from-report <audit-report.json>");
    expect(nextStepForNode(blocked, cleanGate, null, { id: "ci-1", status: "passed" })).toBe(
      'qd unblock work --from-run ci-1 --summary "<why it is unblocked>"',
    );
    expect(nextStepForNode(node("ready", "Ready"), cleanGate, null, null)).toBe("qd ci run ready");
    expect(
      nextStepForNode(node("merge", "Merge", { status: "mergeable" }), cleanGate, null, {
        id: "ci-2",
        status: "failed",
      }),
    ).toBe("qd ci run merge");
    expect(
      nextStepForNode(node("done", "Done", { status: "mergeable" }), cleanGate, null, {
        id: "ci-3",
        status: "passed",
      }),
    ).toBeNull();
  });

  it("renders graph formats with escaped labels and only requires edges", () => {
    const snapshot = snapshotFixture([
      node("alpha.node", 'Alpha "quoted"'),
      node("beta", "Beta"),
      node("related", "Related"),
    ]);
    snapshot.edges.push(edge("alpha.node", "beta"), {
      ...edge("related", "beta"),
      type: "related",
    });

    expect(toMermaid(snapshot)).toBe(
      "flowchart TD\n" +
        `  alpha_node["alpha.node: Alpha 'quoted'"]\n` +
        `  beta["beta: Beta"]\n` +
        `  related["related: Related"]\n` +
        "  alpha_node --> beta",
    );
    expect(toDot(snapshot)).toBe(
      "digraph qd {\n" +
        `  "alpha.node" [label="alpha.node: Alpha 'quoted'"];\n` +
        `  "beta" [label="beta: Beta"];\n` +
        `  "related" [label="related: Related"];\n` +
        `  "alpha.node" -> "beta";\n` +
        "}",
    );
  });
});

const timestamp = "2026-06-20T00:00:00.000Z";

function snapshotFixture(nodes: GraphSnapshot["nodes"]): GraphSnapshot {
  return {
    schema_version: 1,
    exported_at: timestamp,
    registries: { groups: [], projects: [], milestones: [] },
    nodes,
    edges: [],
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
  overrides: Partial<GraphSnapshot["nodes"][number]> = {},
): GraphSnapshot["nodes"][number] {
  return {
    id,
    title,
    kind: "feature",
    milestone: "m1",
    group_name: null,
    projects: [],
    status: "ready",
    priority: "P2",
    estimate_points: 1,
    risk: "medium",
    owner: null,
    branch: null,
    spec: `Spec ${id}`,
    acceptance: `Acceptance ${id}`,
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
    created_at: timestamp,
    updated_at: timestamp,
    claimed_at: null,
    done_at: null,
    ...overrides,
  };
}

function edge(from_node: string, to_node: string): GraphSnapshot["edges"][number] {
  return { from_node, to_node, type: "requires", created_at: timestamp };
}

function finding(id: string, node_id: string): GraphSnapshot["findings"][number] {
  return {
    id,
    node_id,
    run_id: null,
    severity: "P1",
    status: "open",
    title: id,
    path: null,
    line: null,
    evidence: id,
    expected: null,
    suggested_fix: null,
    created_at: timestamp,
    resolved_at: null,
  };
}

function run(id: string, node_id: string): GraphSnapshot["runs"][number] {
  return {
    id,
    node_id,
    kind: "check",
    status: "passed",
    command: null,
    provider: null,
    exit_code: null,
    git_sha: null,
    summary: id,
    log_path: null,
    url: null,
    external_id: null,
    rationale: null,
    superseded_by: null,
    report_path: null,
    audit_kind: null,
    worktree_path: null,
    agent: null,
    started_at: timestamp,
    finished_at: timestamp,
  };
}

function note(id: string, node_id: string): GraphSnapshot["node_notes"][number] {
  return {
    id,
    node_id,
    kind: "note",
    text: id,
    evidence: null,
    created_at: timestamp,
  };
}

function assignment(id: string, node_id: string): GraphSnapshot["assignments"][number] {
  return {
    id,
    node_id,
    role: "worker",
    owner: "agent",
    branch: null,
    worktree_path: null,
    scope: null,
    status: "open",
    commits_json: "[]",
    evidence_json: "[]",
    summary: null,
    started_at: timestamp,
    finished_at: null,
  };
}
