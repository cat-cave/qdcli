import { describe, expect, it } from "vite-plus/test";
import {
  addEdge,
  addFinding,
  addNode,
  addNodesBulk,
  graphSnapshot,
  readyNodes,
  unblockNode,
  updateNode,
} from "./index.js";
import { installGraphFixture, root } from "./graph-test-fixtures.js";

installGraphFixture();

describe("graph retry and blocker hygiene", () => {
  it("clears an explicit blocker without requiring dependency completion", async () => {
    await addNode(root, {
      id: "hub",
      title: "Milestone hub",
      status: "mergeable",
      spec: "Aggregate completed milestone work.",
      acceptance: "The milestone is integrated.",
    });
    await addNode(root, {
      id: "hygiene",
      title: "Blocked hygiene",
      status: "blocked",
      blockedBy: "external-dependency",
      blockedReason: "External input was unavailable.",
      blockedOwner: "external-team",
      spec: "Apply the external input after it becomes available.",
      acceptance: "The input is applied.",
    });
    await addEdge(root, "hub", "hygiene");

    const unblocked = await unblockNode(root, "hygiene", {
      summary: "External input is available.",
      evidence: "issue:resolved",
    });

    expect(unblocked).toMatchObject({ status: "ready", blocked_by: null });
    expect((await readyNodes(root)).map((node) => node.id)).not.toContain("hygiene");
  });

  it("names the remaining node-scoped gate when blocker hygiene is unsafe", async () => {
    await addNode(root, {
      id: "unsafe",
      title: "Unsafe unblock",
      status: "blocked",
      blockedBy: "provider",
      blockedReason: "Provider is unavailable.",
      blockedOwner: "provider",
      spec: "Call the provider.",
      acceptance: "The provider call succeeds.",
    });
    await addFinding(root, "unsafe", {
      severity: "P1",
      title: "Provider response corrupts state",
      evidence: "tests/provider-corruption.log",
    });

    await expect(
      unblockNode(root, "unsafe", {
        summary: "Provider is reachable.",
        evidence: "provider:health-green",
      }),
    ).rejects.toThrow(
      "Cannot unblock unsafe: Open P1 finding blocks unsafe: Provider response corrupts state",
    );
  });

  it("makes exact bulk retries idempotent and reports conflicts by node and field", async () => {
    const plan = {
      nodes: [
        { id: "a", title: "Build A", spec: "Do A", acceptance: "A works" },
        { id: "b", title: "Build B", spec: "Do B", acceptance: "B works" },
      ],
      edges: [{ from: "a", to: "b", type: "requires" as const }],
    };
    const first = await addNodesBulk(root, plan);
    expect(first.summary).toEqual({
      addedNodes: 2,
      skippedNodes: 0,
      addedEdges: 1,
      skippedEdges: 0,
    });
    await updateNode(root, "a", { status: "claimed", owner: "worker" });

    const retry = await addNodesBulk(root, plan);
    expect(retry.nodes).toEqual([]);
    expect(retry.edges).toEqual([]);
    expect(retry.nodeResults.map((result) => [result.id, result.status])).toEqual([
      ["a", "skipped-existing"],
      ["b", "skipped-existing"],
    ]);
    expect(retry.edgeResults[0]).toMatchObject({
      from: "a",
      to: "b",
      status: "skipped-existing",
    });
    expect(retry.summary).toEqual({
      addedNodes: 0,
      skippedNodes: 2,
      addedEdges: 0,
      skippedEdges: 1,
    });

    await expect(
      addNodesBulk(root, {
        nodes: [
          { id: "new", title: "New", spec: "New work", acceptance: "New works" },
          { id: "a", title: "Build A", spec: "Changed A", acceptance: "A works" },
        ],
      }),
    ).rejects.toThrow("bulk node a already exists with different fields: spec");
    expect((await graphSnapshot(root)).nodes.map((node) => node.id)).not.toContain("new");
  });
});
