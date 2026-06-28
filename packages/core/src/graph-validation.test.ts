import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  addNode,
  openDatabase,
  readyNodes,
  resolveProjectRoot,
  run,
  updateNode,
  validateGraph,
} from "./index.js";
import { installGraphFixture, root } from "./graph-test-fixtures.js";

installGraphFixture();

describe("graph validation", () => {
  it("surfaces advisory blocker warnings and excludes blocked nodes from ready", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    await updateNode(root, "a", { status: "blocked" });

    const validation = await validateGraph(root);

    expect(validation.ok).toBe(true);
    expect(validation.warnings).toEqual([
      "a: blocked node should include blocked_by and blocked_reason for external/manual blockers",
    ]);
    expect(await readyNodes(root)).toEqual([]);
  });

  it("strictly validates corrupted persisted node fields", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    const db = await openDatabase(root);
    await run(
      db,
      "update nodes set spec = '   ', acceptance = '   ', status = 'ready', blocked_by = 'manual', blocked_reason = 'needs approval' where id = 'a'",
    );

    const validation = await validateGraph(root);

    expect(validation.ok).toBe(false);
    expect(validation.errors).toEqual([
      "a: non-draft node is missing acceptance criteria",
      "a: node is missing spec",
      "a: blocked_by is set but status is ready",
    ]);
  });

  it("can promote advisory warnings to strict validation errors", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    await updateNode(root, "a", { status: "blocked" });

    const validation = await validateGraph(root, { strict: true });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toEqual([
      "a: blocked node should include blocked_by and blocked_reason for external/manual blockers",
    ]);
  });

  it("resolves the nearest ancestor qd root", async () => {
    const nested = path.join(root, "packages", "app", "src");
    await mkdir(nested, { recursive: true });

    await expect(resolveProjectRoot({ cwd: nested })).resolves.toBe(root);
    await expect(resolveProjectRoot({ cwd: nested, root })).resolves.toBe(root);
    await expect(
      resolveProjectRoot({ cwd: nested, root: path.join(root, "missing") }),
    ).rejects.toThrow(/No qd project found/);
    await expect(
      resolveProjectRoot({ cwd: nested, root: path.join(root, "missing"), allowMissing: true }),
    ).resolves.toBe(path.join(root, "missing"));
  });

  it("fails loudly when no qd root is present unless missing roots are allowed", async () => {
    const emptyRoot = await mkdtemp(path.join(os.tmpdir(), "qdcli-empty-"));
    try {
      await expect(resolveProjectRoot({ cwd: emptyRoot })).rejects.toThrow(/No qd project/);
      await expect(resolveProjectRoot({ cwd: emptyRoot, allowMissing: true })).resolves.toBe(
        emptyRoot,
      );
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  });
});
