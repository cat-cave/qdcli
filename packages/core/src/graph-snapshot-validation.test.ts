import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  addNode,
  graphSnapshot,
  restoreGraphSnapshot,
  setupProject,
  validateGraphSnapshotForWrite,
} from "./index.js";
import { installGraphFixture, root } from "./graph-test-fixtures.js";

installGraphFixture();

describe("graph snapshot validation", () => {
  it("rejects invalid restore snapshots before mutating the local cache", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    const snapshot = await graphSnapshot(root);
    const restoredRoot = await mkdtemp(path.join(os.tmpdir(), "qdcli-restore-invalid-"));
    try {
      await setupProject(restoredRoot);
      expect(() =>
        validateGraphSnapshotForWrite({
          ...snapshot,
          registries: {
            ...snapshot.registries,
            groups: [
              { name: "runtime", created_at: "2026-06-20T00:00:00.000Z" },
              { name: "runtime", created_at: "2026-06-20T00:00:00.000Z" },
            ],
          },
        }),
      ).toThrow(/duplicate group/);
      expect(() =>
        validateGraphSnapshotForWrite({
          ...snapshot,
          registries: {
            ...snapshot.registries,
            projects: [
              { name: "app", created_at: "2026-06-20T00:00:00.000Z" },
              { name: "app", created_at: "2026-06-20T00:00:00.000Z" },
            ],
          },
        }),
      ).toThrow(/duplicate project/);
      expect(() =>
        validateGraphSnapshotForWrite({
          ...snapshot,
          registries: {
            ...snapshot.registries,
            milestones: [
              { name: "alpha", rank: 10, created_at: "2026-06-20T00:00:00.000Z" },
              { name: "alpha", rank: 20, created_at: "2026-06-20T00:00:00.000Z" },
            ],
          },
        }),
      ).toThrow(/duplicate milestone/);
      expect(() =>
        validateGraphSnapshotForWrite({
          ...snapshot,
          nodes: [{ ...snapshot.nodes[0]!, group_name: "runtime" }],
        }),
      ).toThrow(/unregistered group/);
      expect(() =>
        validateGraphSnapshotForWrite({
          ...snapshot,
          nodes: [{ ...snapshot.nodes[0]!, milestone: "alpha" }],
        }),
      ).toThrow(/unregistered milestone/);
      expect(() =>
        validateGraphSnapshotForWrite({
          ...snapshot,
          nodes: [{ ...snapshot.nodes[0]!, projects: ["app"] }],
        }),
      ).toThrow(/unregistered project/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          schema_version: 999,
        }),
      ).rejects.toThrow(/Unsupported qd export/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          nodes: [...snapshot.nodes, snapshot.nodes[0]!],
        }),
      ).rejects.toThrow(/duplicate node id/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          edges: [
            {
              from_node: "missing",
              to_node: "a",
              type: "requires",
              created_at: "2026-06-20T00:00:00.000Z",
            },
          ],
        }),
      ).rejects.toThrow(/missing from node/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          edges: [
            {
              from_node: "a",
              to_node: "missing",
              type: "requires",
              created_at: "2026-06-20T00:00:00.000Z",
            },
          ],
        }),
      ).rejects.toThrow(/missing to node/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          edges: [
            {
              from_node: "a",
              to_node: "a",
              type: "related",
              created_at: "2026-06-20T00:00:00.000Z",
            },
            {
              from_node: "a",
              to_node: "a",
              type: "related",
              created_at: "2026-06-20T00:00:00.000Z",
            },
          ],
        }),
      ).rejects.toThrow(/duplicate edge/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          edges: [
            {
              from_node: "a",
              to_node: "a",
              type: "requires",
              created_at: "2026-06-20T00:00:00.000Z",
            },
          ],
        }),
      ).rejects.toThrow(/requires edge cycle/);
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          registries: {
            ...snapshot.registries,
            milestones: [
              {
                name: "bad-rank",
                rank: 1.5,
                created_at: "2026-06-20T00:00:00.000Z",
              },
            ],
          },
        }),
      ).rejects.toThrow(/missing integer rank/);
      expect((await graphSnapshot(restoredRoot)).nodes).toHaveLength(0);
    } finally {
      await rm(restoredRoot, { recursive: true, force: true });
    }
  });
});
