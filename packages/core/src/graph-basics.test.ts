import { describe, expect, it } from "vite-plus/test";
import {
  addEdge,
  addNode,
  listEdges,
  openDatabase,
  readyNodes,
  removeEdge,
  run,
  validateGraph,
} from "./index.js";
import { installGraphFixture, root } from "./graph-test-fixtures.js";

installGraphFixture();

describe("graph basics", () => {
  it("returns only dependency-unblocked ready nodes", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    await addNode(root, {
      id: "b",
      title: "Build B",
      spec: "Do B",
      acceptance: "B works",
    });
    await addEdge(root, "a", "b");

    expect((await readyNodes(root)).map((node) => node.id)).toEqual(["a"]);
  });

  it("rejects requires cycles", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    await addNode(root, {
      id: "b",
      title: "Build B",
      spec: "Do B",
      acceptance: "B works",
    });
    await addEdge(root, "a", "b");

    await expect(addEdge(root, "b", "a")).rejects.toThrow(/cycle/);
  });

  it("allows related cycles but validateGraph reports requires cycles", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    await addNode(root, {
      id: "b",
      title: "Build B",
      spec: "Do B",
      acceptance: "B works",
    });

    await addEdge(root, "a", "b", "related");
    await addEdge(root, "b", "a", "related");
    expect(await validateGraph(root)).toMatchObject({ ok: true });

    const db = await openDatabase(root);
    await run(
      db,
      "insert into edges (from_node, to_node, type, created_at) values (?, ?, 'requires', ?)",
      ["a", "b", new Date().toISOString()],
    );
    await run(
      db,
      "insert into edges (from_node, to_node, type, created_at) values (?, ?, 'requires', ?)",
      ["b", "a", new Date().toISOString()],
    );

    const validation = await validateGraph(root);
    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toMatch(/requires edge cycle/);
  });

  it("rejects self edges and can remove existing edges", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    await addNode(root, {
      id: "b",
      title: "Build B",
      spec: "Do B",
      acceptance: "B works",
    });

    await expect(addEdge(root, "a", "a")).rejects.toThrow(/same node/);
    await addEdge(root, "a", "b");
    expect(await listEdges(root)).toHaveLength(1);
    await removeEdge(root, "a", "b");
    expect(await listEdges(root)).toEqual([]);
  });

  it("generates stable unique ids from titles and validates required node quality", async () => {
    const first = await addNode(root, {
      title: "Runtime API!",
      spec: "Do runtime",
      acceptance: "Runtime works",
    });
    const second = await addNode(root, {
      title: "Runtime API!",
      spec: "Do more runtime",
      acceptance: "Runtime still works",
    });
    const long = await addNode(root, {
      title: "A".repeat(80),
      spec: "Do long work",
      acceptance: "Long work is done",
    });

    expect(first.id).toBe("runtime-api");
    expect(second.id).toBe("runtime-api-2");
    expect(long.id).toHaveLength(64);
    await expect(
      addNode(root, {
        title: " ",
        spec: "Do work",
        acceptance: "Work is done",
      }),
    ).rejects.toThrow(/Node title is required/);
    await expect(
      addNode(root, {
        title: "No estimate",
        estimatePoints: 0,
        spec: "Do work",
        acceptance: "Work is done",
      }),
    ).rejects.toThrow(/positive integer/);
  });
});
