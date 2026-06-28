import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  addEdge,
  addAssignment,
  addFinding,
  addNodeNote,
  addNode,
  addNodesBulk,
  addWaveAssignment,
  addWaveNode,
  completeAssignment,
  completeWave,
  deterministicGraphSnapshot,
  finishRun,
  graphSnapshot,
  replaceGraphSnapshot,
  registerGroup,
  registerMilestone,
  registerProject,
  restoreGraphSnapshot,
  setupProject,
  startRun,
  startWave,
  updateNode,
} from "./index.js";
import { installGraphFixture, root } from "./graph-test-fixtures.js";

installGraphFixture();

describe("graph snapshots", () => {
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
    const assignment = await addAssignment(root, {
      nodeId: "a",
      role: "auditor",
      owner: "external:auditor",
      branch: "audit/a",
      worktreePath: "/tmp/audit-a",
    });
    const wave = await startWave(root, {
      kind: "audit",
      summary: "audit wave",
    });
    await addWaveNode(root, wave.id, "a");
    await addWaveAssignment(root, wave.id, assignment.id);

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
      expect(restored.assignments).toEqual(snapshot.assignments);
      expect(restored.waves).toEqual(snapshot.waves);
      expect(restored.wave_memberships).toEqual(snapshot.wave_memberships);
    } finally {
      await rm(restoredRoot, { recursive: true, force: true });
    }
  });

  it("round-trips optional snapshot fields without dropping canonical data", async () => {
    await registerGroup(root, "runtime");
    await registerProject(root, "app");
    await registerMilestone(root, "baseline", 10);
    await addNode(root, {
      id: "a",
      title: "Build A",
      kind: "feature",
      milestone: "baseline",
      groupName: "runtime",
      projects: ["app"],
      status: "blocked",
      priority: "P1",
      estimatePoints: 5,
      risk: "high",
      spec: "Do A",
      acceptance: "A works",
      validation: "just check-a",
      verification: [{ type: "manual", value: "fixture approval" }],
      auditFocus: ["security", "data loss"],
      context: "docs/context.md",
      statusReason: "Waiting on fixture.",
      checkCommand: "just check-a",
      ciCommand: "just ci-a",
      blockedBy: "manual",
      blockedReason: "Fixture approval is pending.",
      blockedOwner: "trevor",
    });
    await updateNode(root, "a", { owner: "external:worker", branch: "spec/a" });
    const audit = await startRun(root, "a", "audit", {
      command: "just audit-a",
      provider: "local",
      gitSha: "abc123",
      externalId: "audit-1",
      url: "https://example.test/audit/1",
      reportPath: "reports/a.json",
      auditKind: "security",
      worktreePath: "/tmp/qd/a",
      agent: "external:auditor",
      summary: "audit started",
    });
    await finishRun(root, audit.id, {
      status: "superseded",
      exitCode: 2,
      rationale: "newer branch was audited",
      supersededBy: "audit-2",
      summary: "superseded by newer run",
    });
    await addFinding(root, "a", {
      runId: audit.id,
      severity: "P2",
      title: "Improve validation",
      path: "src/a.ts",
      line: 42,
      evidence: "Validation can be stronger.",
      expected: "Validation rejects invalid input.",
      suggestedFix: "Add a boundary test.",
    });
    await addNodeNote(root, "a", "Manual gate recorded", {
      kind: "external-dependency",
      evidence: "https://example.test/ticket/1",
    });
    const assignment = await addAssignment(root, {
      nodeId: "a",
      role: "auditor",
      owner: "external:auditor",
      branch: "audit/a",
      worktreePath: "/tmp/qd/audit-a",
      scope: "src/a.ts",
    });
    await completeAssignment(root, assignment.id, {
      status: "failed",
      summary: "audit found follow-up",
      commits: ["abc123"],
      evidence: ["reports/a.json"],
    });
    const wave = await startWave(root, { kind: "audit", summary: "security wave" });
    await addWaveNode(root, wave.id, "a");
    await completeWave(root, wave.id, { status: "cancelled", summary: "rescheduled" });
    await updateNode(root, "a", { status: "blocked" });

    const snapshot = await graphSnapshot(root);
    const restoredRoot = await mkdtemp(path.join(os.tmpdir(), "qdcli-restore-full-"));
    try {
      await setupProject(restoredRoot);
      await restoreGraphSnapshot(restoredRoot, snapshot);

      expect(deterministicGraphSnapshot(await graphSnapshot(restoredRoot))).toEqual(
        deterministicGraphSnapshot(snapshot),
      );
    } finally {
      await rm(restoredRoot, { recursive: true, force: true });
    }
  });

  it("replaces a local cache from a canonical graph snapshot", async () => {
    await addNode(root, {
      id: "old",
      title: "Old node",
      spec: "Old work",
      acceptance: "Old work is done",
    });
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "qdcli-replace-source-"));
    try {
      await setupProject(sourceRoot);
      await addNode(sourceRoot, {
        id: "new",
        title: "New node",
        spec: "New work",
        acceptance: "New work is done",
      });
      await replaceGraphSnapshot(root, await graphSnapshot(sourceRoot));

      expect((await graphSnapshot(root)).nodes.map((node) => node.id)).toEqual(["new"]);
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it("can produce a deterministic export snapshot", async () => {
    await addNodesBulk(root, {
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

    const stable = deterministicGraphSnapshot(await graphSnapshot(root));

    expect(stable.exported_at).toBe("1970-01-01T00:00:00.000Z");
    expect(stable.registries.groups[0]?.created_at).toBe("1970-01-01T00:00:00.000Z");
    expect(stable.registries.projects[0]?.created_at).toBe("1970-01-01T00:00:00.000Z");
    expect(stable.registries.milestones[0]?.created_at).toBe("1970-01-01T00:00:00.000Z");
  });
});
