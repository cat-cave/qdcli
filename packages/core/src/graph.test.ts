import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addEdge,
  addFinding,
  addNode,
  ciPass,
  gateNode,
  markMerged,
  promoteFindings,
  readyNodes,
  resolveFinding,
  setupProject,
} from "./index.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "qdcli-"));
  await setupProject(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("graph lifecycle", () => {
  it("returns only dependency-unblocked ready nodes", async () => {
    await addNode(root, { id: "a", title: "Build A", spec: "Do A", acceptance: "A works" });
    await addNode(root, { id: "b", title: "Build B", spec: "Do B", acceptance: "B works" });
    await addEdge(root, "a", "b");

    expect((await readyNodes(root)).map((node) => node.id)).toEqual(["a"]);
  });

  it("rejects requires cycles", async () => {
    await addNode(root, { id: "a", title: "Build A", spec: "Do A", acceptance: "A works" });
    await addNode(root, { id: "b", title: "Build B", spec: "Do B", acceptance: "B works" });
    await addEdge(root, "a", "b");

    await expect(addEdge(root, "b", "a")).rejects.toThrow(/cycle/);
  });

  it("blocks the gate for open P0/P1 findings", async () => {
    await addNode(root, { id: "a", title: "Build A", spec: "Do A", acceptance: "A works" });
    const finding = await addFinding(root, "a", {
      severity: "P1",
      title: "Missing acceptance",
      evidence: "The acceptance criterion is not implemented.",
    });

    expect((await gateNode(root, "a")).ok).toBe(false);
    await resolveFinding(root, finding.id);
    expect((await gateNode(root, "a")).ok).toBe(true);
  });

  it("promotes P2/P3 findings into future nodes", async () => {
    await addNode(root, { id: "a", title: "Build A", spec: "Do A", acceptance: "A works" });
    await addFinding(root, "a", {
      severity: "P2",
      title: "Improve validation",
      evidence: "Validation can be made stronger.",
    });

    const promoted = await promoteFindings(root, "a");
    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.kind).toBe("audit-fix");
  });

  it("requires a passed CI run before merge", async () => {
    await addNode(root, { id: "a", title: "Build A", spec: "Do A", acceptance: "A works" });

    await expect(markMerged(root, "a", "squash")).rejects.toThrow(/status ready/);
    await ciPass(root, "a");
    const merged = await markMerged(root, "a", "squash");

    expect(merged.status).toBe("done");
  });
});
