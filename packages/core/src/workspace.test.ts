import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  addEdge,
  addNode,
  setupProject,
  workspaceGraph,
  workspaceReady,
  workspaceStatus,
} from "./index.js";

let root: string;
let repoA: string;
let repoB: string;
let configPath: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "qdcli-workspace-"));
  repoA = path.join(root, "repo-a");
  repoB = path.join(root, "repo-b");
  configPath = path.join(root, "workspaces.toml");
  await setupRepo(repoA, "a");
  await setupRepo(repoB, "b");
  await writeFile(configPath, `repos = ["${repoA}", "${repoB}"]\n`, "utf8");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("workspace roll-up", () => {
  it("summarizes multiple repo DAGs", async () => {
    const status = await workspaceStatus({ configPath });

    expect(status.ok).toBe(true);
    expect(status.totals.repos).toBe(2);
    expect(status.totals.nodes).toBe(4);
    expect(status.totals.ready).toBe(2);
  });

  it("returns ready nodes tagged by repo", async () => {
    const ready = await workspaceReady({ repos: [repoA, repoB] });

    expect(ready.map((node) => `${node.repo}:${node.id}`).sort()).toEqual([
      "repo-a:a-1",
      "repo-b:b-1",
    ]);
  });

  it("returns snapshots tagged by repo", async () => {
    const graph = await workspaceGraph({ configPath });

    expect(graph.repos.map((repo) => repo.name)).toEqual(["repo-a", "repo-b"]);
    expect(graph.snapshots.map((entry) => entry.snapshot.nodes.length)).toEqual([2, 2]);
  });

  it("reports missing repo databases without creating them", async () => {
    const missing = path.join(root, "missing");
    await mkdir(missing, { recursive: true });

    const status = await workspaceStatus({ repos: [repoA, missing] });

    expect(status.ok).toBe(false);
    expect(status.repos[1]?.errors[0]).toMatch(/Missing qd database/);
  });
});

async function setupRepo(repoRoot: string, prefix: string): Promise<void> {
  await setupProject(repoRoot);
  await addNode(repoRoot, {
    id: `${prefix}-1`,
    title: `${prefix} 1`,
    spec: "Do first",
    acceptance: "First works",
  });
  await addNode(repoRoot, {
    id: `${prefix}-2`,
    title: `${prefix} 2`,
    spec: "Do second",
    acceptance: "Second works",
  });
  await addEdge(repoRoot, `${prefix}-1`, `${prefix}-2`);
}
