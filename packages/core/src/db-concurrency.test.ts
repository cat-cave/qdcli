import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  addNode,
  graphSnapshot,
  nodeDetailSnapshot,
  openDatabase,
  run,
  setupProject,
} from "./index.js";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "qd-concurrency-"));
  await setupProject(root);
  await addNode(root, {
    id: "concurrent",
    title: "Concurrent reads",
    spec: "Keep reads coherent during writes.",
    acceptance: "Readers receive a complete snapshot.",
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("ledger concurrency", () => {
  it("serves coherent graph and node snapshots while a write transaction is open", async () => {
    const writer = await openDatabase(root);
    await run(writer, "begin immediate");
    await run(writer, "update nodes set status = 'review' where id = 'concurrent'");

    const [graphBeforeCommit, detailBeforeCommit] = await Promise.all([
      graphSnapshot(root),
      nodeDetailSnapshot(root, "concurrent"),
    ]);
    expect(graphBeforeCommit.nodes).toEqual([
      expect.objectContaining({ id: "concurrent", status: "ready" }),
    ]);
    expect(detailBeforeCommit.node).toMatchObject({ id: "concurrent", status: "ready" });

    await run(writer, "commit");
    await writer.close();
    const [graphAfterCommit, detailAfterCommit] = await Promise.all([
      graphSnapshot(root),
      nodeDetailSnapshot(root, "concurrent"),
    ]);
    expect(graphAfterCommit.nodes[0]?.status).toBe("review");
    expect(detailAfterCommit.node.status).toBe("review");
  });
});
