import { describe, expect, it } from "vite-plus/test";
import {
  addFinding,
  addNode,
  addNodesBulk,
  cancelNode,
  ciFail,
  ciPass,
  completeNode,
  graphSnapshot,
  latestRun,
  listEdges,
  listNodeNotes,
  listRegistry,
  markMerged,
  recordCheckResult,
  readyNodes,
  resolveFinding,
  stats,
  unblockNode,
  updateNode,
} from "./index.js";
import { installGraphFixture, passAudit, root } from "./graph-test-fixtures.js";

installGraphFixture();

describe("graph node state and bulk writes", () => {
  it("recovers a blocked node after a newer passed check when the gate is clean", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    await recordCheckResult(root, "a", { status: "failed", summary: "format failed" });
    const recovered = await recordCheckResult(root, "a", {
      status: "passed",
      summary: "format repaired",
    });

    expect(recovered.status).toBe("review");
  });

  it("records implementation completion as a review-ready run", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });

    const completed = await completeNode(root, "a", "implemented the spec");
    const run = await latestRun(root, "a", "implement");

    expect(completed.status).toBe("review");
    expect(run).toMatchObject({
      node_id: "a",
      kind: "implement",
      status: "completed",
      summary: "implemented the spec",
    });
  });

  it("supports explicit unblock from a passed run", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    await updateNode(root, "a", { status: "blocked" });
    await recordCheckResult(root, "a", { status: "passed", summary: "verified" });
    const run = await latestRun(root, "a", "check");
    await updateNode(root, "a", { status: "blocked" });

    const unblocked = await unblockNode(root, "a", {
      fromRunId: run?.id ?? "",
      summary: "verified by passed check",
    });

    expect(unblocked.status).toBe("review");
    expect((await listNodeNotes(root, "a", { kinds: ["retry"] }))[0]?.evidence).toContain(run?.id);
  });

  it("records CI failure through the shorthand helper", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });

    const failed = await ciFail(root, "a", "pipeline failed");

    expect(failed.status).toBe("blocked");
    expect(await latestRun(root, "a", "ci")).toMatchObject({
      status: "failed",
      summary: "pipeline failed",
    });
  });

  it("cancels nodes and reports aggregate stats", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      estimatePoints: 2,
      spec: "Do A",
      acceptance: "A works",
    });
    await addNode(root, {
      id: "b",
      title: "Build B",
      estimatePoints: 3,
      spec: "Do B",
      acceptance: "B works",
    });
    await passAudit("a");
    await ciPass(root, "a");
    await markMerged(root, "a", "squash", { commitSha: "abc1234" });
    const cancelled = await cancelNode(root, "b");
    const report = await stats(root);

    expect(cancelled.status).toBe("cancelled");
    expect(report).toMatchObject({
      nodes: 2,
      ready: 0,
      donePoints: 2,
      totalPoints: 5,
      remainingPoints: 3,
      openP0P1Findings: 0,
    });
    expect(report.byStatus).toMatchObject({ done: 1, cancelled: 1 });
  });

  it("counts only open P0/P1 findings in aggregate stats", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    const p0 = await addFinding(root, "a", {
      severity: "P0",
      title: "Blocking",
      evidence: "Must fix.",
    });
    await addFinding(root, "a", {
      severity: "P2",
      title: "Follow-up",
      evidence: "Can be later.",
    });
    await resolveFinding(root, p0.id);
    await addFinding(root, "a", {
      severity: "P1",
      title: "Still blocking",
      evidence: "Must also fix.",
    });
    await addFinding(root, "a", {
      severity: "P0",
      title: "Critical blocker",
      evidence: "Must fix before merge.",
    });

    expect((await stats(root)).openP0P1Findings).toBe(2);
  });

  it("records check runs without making the node mergeable", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });

    const checked = await recordCheckResult(root, "a", {
      status: "passed",
      summary: "check passed",
    });

    expect(checked.status).toBe("ready");
    await expect(markMerged(root, "a", "squash")).rejects.toThrow(/status ready/);
  });

  it("persists per-node check and CI command overrides", async () => {
    const created = await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
      checkCommand: "just check-a",
      ciCommand: "just ci-a",
    });

    expect(created.check_command).toBe("just check-a");
    expect(created.ci_command).toBe("just ci-a");

    const updated = await updateNode(root, "a", {
      check_command: "just check-b",
      ci_command: "just ci-b",
    });

    expect(updated.check_command).toBe("just check-b");
    expect(updated.ci_command).toBe("just ci-b");
  });

  it("edits one field without blanking untouched required fields", async () => {
    await addNode(root, {
      id: "hardening",
      title: "Hardening",
      spec: "Do hardening",
      acceptance: "Hardening is done",
    });

    const edited = await updateNode(root, "hardening", { status: "blocked" });

    expect(edited.status).toBe("blocked");
    expect(edited.spec).toBe("Do hardening");
    expect(edited.acceptance).toBe("Hardening is done");
  });

  it("stores explicit manual blocker metadata", async () => {
    const node = await addNode(root, {
      id: "manual-gate",
      title: "Manual gate",
      status: "blocked",
      blockedBy: "manual",
      blockedReason: "Fixture approval is pending.",
      blockedOwner: "trevor",
      spec: "Wait for review",
      acceptance: "Review is signed off",
    });

    expect(node.blocked_by).toBe("manual");
    expect(node.blocked_reason).toBe("Fixture approval is pending.");
    expect(await readyNodes(root)).toEqual([]);
  });

  it("rejects malformed blocker metadata loudly", async () => {
    await expect(
      addNode(root, {
        id: "bad-status",
        title: "Bad status",
        status: "ready",
        blockedBy: "manual",
        blockedReason: "Needs approval.",
        spec: "Do work",
        acceptance: "Work is done",
      }),
    ).rejects.toThrow(/blocked_by can only be set/);
    await expect(
      addNode(root, {
        id: "missing-reason",
        title: "Missing reason",
        status: "blocked",
        blockedBy: "manual",
        spec: "Do work",
        acceptance: "Work is done",
      }),
    ).rejects.toThrow(/blocked_reason is required/);
    await expect(
      addNode(root, {
        id: "empty-owner",
        title: "Empty owner",
        status: "blocked",
        blockedBy: "manual",
        blockedReason: "Needs approval.",
        blockedOwner: " ",
        spec: "Do work",
        acceptance: "Work is done",
      }),
    ).rejects.toThrow(/blocked_owner must not be empty/);
  });

  it("rejects malformed runtime update fields without raw property errors", async () => {
    await addNode(root, {
      id: "runtime-patch",
      title: "Runtime patch",
      spec: "Do runtime patch",
      acceptance: "Runtime patch is done",
    });

    await expect(
      updateNode(root, "runtime-patch", { spec: undefined as any }),
    ).resolves.toMatchObject({
      spec: "Do runtime patch",
    });
    await expect(
      updateNode(root, "runtime-patch", { blocked_owner: undefined as any }),
    ).resolves.toMatchObject({ blocked_owner: null });
    await expect(updateNode(root, "runtime-patch", { spec: null as any })).rejects.toThrow(
      /Node spec must be a string/,
    );
  });

  it("adds bulk nodes transactionally and auto-registers referenced metadata", async () => {
    await expect(
      addNodesBulk(root, {
        nodes: [
          {
            id: "a",
            title: "Build A",
            milestone: "alpha",
            groupName: "runtime",
            projects: ["app"],
            spec: "Do A",
            acceptance: "A works",
          },
          {
            id: "a",
            title: "Duplicate A",
            spec: "Duplicate",
            acceptance: "Duplicate works",
          },
        ],
      }),
    ).rejects.toThrow(/duplicate node id/);
    expect((await graphSnapshot(root)).nodes).toHaveLength(0);

    const created = await addNodesBulk(root, {
      nodes: [
        {
          id: "a",
          title: "Build A",
          milestone: "alpha",
          groupName: "runtime",
          projects: ["app"],
          spec: "Do A",
          acceptance: "A works",
        },
      ],
    });

    expect(created.nodes).toHaveLength(1);
    expect((await listRegistry(root, "milestones")).map((entry) => entry.name)).toEqual(["alpha"]);
    expect((await listRegistry(root, "groups")).map((entry) => entry.name)).toEqual(["runtime"]);
    expect((await listRegistry(root, "projects")).map((entry) => entry.name)).toEqual(["app"]);
  });

  it("adds bulk edges from existing nodes without treating them as missing", async () => {
    await addNode(root, {
      id: "existing",
      title: "Existing",
      spec: "Already exists",
      acceptance: "Existing works",
    });

    const created = await addNodesBulk(root, {
      nodes: [
        {
          id: "new",
          title: "New",
          spec: "Do new work",
          acceptance: "New work is done",
        },
      ],
      edges: [{ from: "existing", to: "new" }],
    });

    expect(created.edges).toHaveLength(1);
    expect((await readyNodes(root)).map((node) => node.id)).toEqual(["existing"]);

    const second = await addNodesBulk(root, {
      nodes: [
        {
          id: "new-2",
          title: "New 2",
          spec: "Do second new work",
          acceptance: "Second new work is done",
        },
      ],
      edges: [{ from: "new-2", to: "existing" }],
    });

    expect(second.edges).toHaveLength(1);
    expect((await listEdges(root)).map((edge) => `${edge.from_node}->${edge.to_node}`)).toEqual([
      "existing->new",
      "new-2->existing",
    ]);
  });

  it("rolls back bulk nodes when an edge is invalid", async () => {
    await expect(
      addNodesBulk(root, {
        nodes: [
          {
            id: "a",
            title: "Build A",
            spec: "Do A",
            acceptance: "A works",
          },
          {
            id: "b",
            title: "Build B",
            spec: "Do B",
            acceptance: "B works",
          },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "missing", to: "b" },
        ],
      }),
    ).rejects.toThrow(/edge references missing from node/);

    const snapshot = await graphSnapshot(root);
    expect(snapshot.nodes).toEqual([]);
    expect(snapshot.edges).toEqual([]);
  });
});
