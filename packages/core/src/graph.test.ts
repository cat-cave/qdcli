import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  addEdge,
  addFinding,
  addNodeNote,
  addNode,
  ciPass,
  gateNode,
  graphSnapshot,
  listFindings,
  listRuns,
  markMerged,
  promoteFindings,
  recordCheckResult,
  readyNodes,
  registerGroup,
  registerMilestone,
  registerProject,
  resolveProjectRoot,
  restoreGraphSnapshot,
  resolveFinding,
  setupProject,
  startRun,
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

  it("blocks the gate for open P0/P1 findings", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
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
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    await addFinding(root, "a", {
      severity: "P2",
      title: "Improve validation",
      evidence: "Validation can be made stronger.",
    });

    const promoted = await promoteFindings(root, "a");
    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.node.kind).toBe("audit-fix");
    expect(promoted[0]?.findingId).toBeTruthy();
    expect(promoted[0]?.newNodeId).toBe(promoted[0]?.node.id);
    expect(promoted[0]?.node.status_reason).toContain("Promoted from finding");
  });

  it("lists findings and node runs for orchestrator dashboards", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    await addFinding(root, "a", {
      severity: "P1",
      title: "Missing acceptance",
      evidence: "The acceptance criterion is not implemented.",
    });
    await addFinding(root, "a", {
      severity: "P3",
      title: "Polish docs",
      evidence: "The docs could be clearer.",
    });
    await startRun(root, "a", "audit", { summary: "audit started" });

    expect(
      (await listFindings(root, { status: "open", severities: ["P1"] })).map(
        (finding) => finding.title,
      ),
    ).toEqual(["Missing acceptance"]);
    expect(await listFindings(root, { nodeId: "a" })).toHaveLength(2);
    expect((await listRuns(root, "a")).map((run) => run.kind)).toEqual(["audit"]);
  });

  it("requires a passed CI run before merge", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });

    await expect(markMerged(root, "a", "squash")).rejects.toThrow(/status ready/);
    await ciPass(root, "a");
    const merged = await markMerged(root, "a", "squash");

    expect(merged.status).toBe("done");
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

  it("enforces registered group, project, and milestone values", async () => {
    await registerGroup(root, "runtime");
    await registerProject(root, "app");
    await registerMilestone(root, "baseline", 10);

    await expect(
      addNode(root, {
        id: "bad",
        title: "Bad metadata",
        groupName: "typo",
        projects: ["app"],
        milestone: "baseline",
        spec: "Do work",
        acceptance: "Work is done",
      }),
    ).rejects.toThrow(/unknown group/);

    const node = await addNode(root, {
      id: "good",
      title: "Good metadata",
      groupName: "runtime",
      projects: ["app"],
      milestone: "baseline",
      spec: "Do work",
      acceptance: "Work is done",
    });

    expect(node.group_name).toBe("runtime");
    expect(node.projects).toEqual(["app"]);
    expect(node.milestone).toBe("baseline");
  });

  it("restores a canonical graph snapshot into a fresh local cache", async () => {
    await registerGroup(root, "runtime");
    await registerProject(root, "app");
    await registerMilestone(root, "baseline", 10);
    await addNode(root, {
      id: "a",
      title: "Build A",
      groupName: "runtime",
      projects: ["app"],
      milestone: "baseline",
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
    await startRun(root, "a", "implement", { summary: "done" });
    await addFinding(root, "a", {
      severity: "P2",
      title: "Improve validation",
      evidence: "Validation can be stronger.",
    });
    await addNodeNote(root, "a", "Ready for audit");

    const snapshot = await graphSnapshot(root);
    const restoredRoot = await mkdtemp(path.join(os.tmpdir(), "qdcli-restore-"));
    try {
      await setupProject(restoredRoot);
      await restoreGraphSnapshot(restoredRoot, snapshot);
      const restored = await graphSnapshot(restoredRoot);

      expect(restored.registries).toEqual(snapshot.registries);
      expect(restored.nodes).toEqual(snapshot.nodes);
      expect(restored.edges).toEqual(snapshot.edges);
      expect(restored.runs).toEqual(snapshot.runs);
      expect(restored.findings).toEqual(snapshot.findings);
      expect(restored.node_notes).toEqual(snapshot.node_notes);
    } finally {
      await rm(restoredRoot, { recursive: true, force: true });
    }
  });

  it("resolves the nearest ancestor qd root", async () => {
    const nested = path.join(root, "packages", "app", "src");
    await mkdir(nested, { recursive: true });

    await expect(resolveProjectRoot({ cwd: nested })).resolves.toBe(root);
    await expect(resolveProjectRoot({ cwd: nested, root })).resolves.toBe(root);
  });
});
