import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  addEdge,
  addFinding,
  addNodeNote,
  addNode,
  claimNode,
  ciFail,
  ciPass,
  gateNode,
  graphSnapshot,
  latestRun,
  listFindings,
  listNodeNotes,
  listRuns,
  markMerged,
  promoteFindings,
  recordCiResult,
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
  updateNode,
  validateGraph,
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

  it("claims the highest priority ready node with the requested branch", async () => {
    await addNode(root, {
      id: "slow",
      title: "Slow task",
      priority: "P3",
      estimatePoints: 5,
      spec: "Do slow work",
      acceptance: "Slow work is done",
    });
    await addNode(root, {
      id: "urgent",
      title: "Urgent task",
      priority: "P1",
      estimatePoints: 3,
      spec: "Do urgent work",
      acceptance: "Urgent work is done",
    });

    const claimed = await claimNode(root, { agent: "orchestrator", branch: "spec/urgent" });

    expect(claimed.id).toBe("urgent");
    expect(claimed.status).toBe("claimed");
    expect(claimed.owner).toBe("orchestrator");
    expect(claimed.branch).toBe("spec/urgent");
    await expect(claimNode(root, { id: "urgent", agent: "other" })).rejects.toThrow(/not ready/);
  });

  it("records failed check and CI runs without marking the node mergeable", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });

    const afterCheck = await recordCheckResult(root, "a", {
      status: "failed",
      summary: "check failed",
      logPath: "logs/check.txt",
    });
    expect(afterCheck.status).toBe("blocked");
    expect(await latestRun(root, "a", "check")).toMatchObject({
      status: "failed",
      summary: "check failed",
      log_path: "logs/check.txt",
    });

    const afterCi = await recordCiResult(root, "a", {
      status: "failed",
      summary: "ci failed",
      logPath: "logs/ci.txt",
    });
    expect(afterCi.status).toBe("blocked");
    expect(await latestRun(root, "a", "ci")).toMatchObject({
      status: "failed",
      summary: "ci failed",
      log_path: "logs/ci.txt",
    });
    await expect(markMerged(root, "a", "squash")).rejects.toThrow(/status blocked/);
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

  it("records the external commit represented by a qd merge", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    await ciPass(root, "a");

    const merged = await markMerged(root, "a", "squash", {
      commitSha: "abcdef1234567890",
    });

    expect(merged.status).toBe("done");
    expect(await latestRun(root, "a", "merge")).toMatchObject({
      status: "recorded",
      summary: "Merge recorded with squash at commit abcdef1234567890",
    });
  });

  it("preserves done nodes on post-merge CI success and marks failures regressed", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    await ciPass(root, "a");
    await markMerged(root, "a", "squash");

    const passed = await recordCiResult(root, "a", {
      status: "passed",
      summary: "main CI passed after merge",
    });
    expect(passed.status).toBe("done");

    const failed = await recordCiResult(root, "a", {
      status: "failed",
      summary: "main CI failed after merge",
    });
    expect(failed.status).toBe("regressed");
  });

  it("appends node notes to status reason and lists them oldest first", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      statusReason: "Initial note",
      spec: "Do A",
      acceptance: "A works",
    });

    await addNodeNote(root, "a", "Blocked by upstream API");
    await addNodeNote(root, "a", "Retry passed locally");

    const notes = await listNodeNotes(root, "a");
    const node = await graphSnapshot(root).then((snapshot) =>
      snapshot.nodes.find((candidate) => candidate.id === "a"),
    );
    expect(notes.map((note) => note.text)).toEqual([
      "Blocked by upstream API",
      "Retry passed locally",
    ]);
    expect(node?.status_reason).toContain("Initial note");
    expect(node?.status_reason).toContain("Blocked by upstream API");
    expect(node?.status_reason).toContain("Retry passed locally");
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
      await expect(
        restoreGraphSnapshot(restoredRoot, {
          ...snapshot,
          schema_version: 2,
        }),
      ).rejects.toThrow(/Unsupported qd export/);
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
      expect((await graphSnapshot(restoredRoot)).nodes).toHaveLength(0);
    } finally {
      await rm(restoredRoot, { recursive: true, force: true });
    }
  });

  it("surfaces validation warnings for unblocked blocked nodes", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    await updateNode(root, "a", { status: "blocked" });

    const validation = await validateGraph(root);

    expect(validation.ok).toBe(true);
    expect(validation.warnings).toEqual(["a: blocked node has no incomplete dependencies"]);
  });

  it("resolves the nearest ancestor qd root", async () => {
    const nested = path.join(root, "packages", "app", "src");
    await mkdir(nested, { recursive: true });

    await expect(resolveProjectRoot({ cwd: nested })).resolves.toBe(root);
    await expect(resolveProjectRoot({ cwd: nested, root })).resolves.toBe(root);
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
