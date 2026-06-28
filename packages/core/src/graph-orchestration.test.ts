import { describe, expect, it } from "vite-plus/test";
import {
  addAssignment,
  addNodeNote,
  addNode,
  addWaveAssignment,
  addWaveNode,
  ciPass,
  completeAssignment,
  completeWave,
  graphSnapshot,
  latestRun,
  listNodeNotes,
  listRegistry,
  listAssignments,
  listWaveMemberships,
  listWaves,
  markMerged,
  recordCiResult,
  registerGroup,
  registerMilestone,
  registerProject,
  startWave,
} from "./index.js";
import { installGraphFixture, passAudit, root } from "./graph-test-fixtures.js";

installGraphFixture();

describe("graph orchestration and registries", () => {
  it("records the external commit represented by a qd merge", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    await passAudit("a");
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
    await passAudit("a");
    await ciPass(root, "a");
    await markMerged(root, "a", "squash", { commitSha: "abc1234" });

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
    expect(node?.status_reason?.startsWith("\n")).toBe(false);
  });

  it("stores typed notes and filters them by kind", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });

    await addNodeNote(root, "a", "Waiting on fixture", {
      kind: "external-dependency",
      evidence: "https://example.test/ticket",
    });
    await addNodeNote(root, "a", "Plain note");

    const filtered = await listNodeNotes(root, "a", { kinds: ["external-dependency"] });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({
      kind: "external-dependency",
      evidence: "https://example.test/ticket",
    });
    expect(await listNodeNotes(root, "a", { kinds: [] })).toHaveLength(2);
  });

  it("tracks opaque assignments and refuses duplicate open branch or worktree ownership", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    const assignment = await addAssignment(root, {
      nodeId: "a",
      role: "worker",
      owner: "external:worker-1",
      branch: "worker/a",
      worktreePath: "/tmp/worker-a",
      scope: "src/a.ts",
    });

    await expect(
      addAssignment(root, {
        nodeId: "a",
        role: "auditor",
        owner: "external:auditor-1",
        branch: "worker/a",
      }),
    ).rejects.toThrow(/branch already has an open assignment/);
    await expect(
      addAssignment(root, {
        nodeId: "a",
        role: "auditor",
        owner: "external:auditor-2",
        worktreePath: "/tmp/worker-a",
      }),
    ).rejects.toThrow(/worktree already has an open assignment/);
    await expect(
      addAssignment(root, {
        nodeId: "a",
        role: "worker",
        owner: " ",
      }),
    ).rejects.toThrow(/owner is required/);

    const completed = await completeAssignment(root, assignment.id, {
      status: "complete",
      summary: "done",
      commits: ["abc123"],
      evidence: ["log.txt"],
    });

    expect(completed.status).toBe("complete");
    expect(JSON.parse(completed.commits_json)).toEqual(["abc123"]);
    expect(JSON.parse(completed.evidence_json)).toEqual(["log.txt"]);
    expect(await listAssignments(root)).toHaveLength(1);
    expect(await listAssignments(root, { nodeId: "a" })).toHaveLength(1);
    expect(await listAssignments(root, { nodeId: "missing" })).toEqual([]);
    expect(await listAssignments(root, { status: "open" })).toEqual([]);
    expect(await listAssignments(root, { status: "complete" })).toHaveLength(1);
    expect(await listAssignments(root, { nodeId: "a", status: "open" })).toEqual([]);
  });

  it("tracks waves with node and assignment membership", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    const assignment = await addAssignment(root, {
      nodeId: "a",
      role: "worker",
      owner: "external:worker-1",
    });
    const wave = await startWave(root, {
      kind: "implementation",
      summary: "first wave",
    });

    await addWaveNode(root, wave.id, "a");
    await addWaveAssignment(root, wave.id, assignment.id);
    const completed = await completeWave(root, wave.id, {
      summary: "merged one node",
    });

    expect(completed.status).toBe("complete");
    expect(await listWaves(root)).toHaveLength(1);
    expect(await listWaveMemberships(root)).toHaveLength(2);
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

  it("lists registries in deterministic name and rank order", async () => {
    await registerGroup(root, "runtime");
    await registerGroup(root, "app");
    await registerProject(root, "suite");
    await registerProject(root, "core");
    await registerMilestone(root, "beta", 10);
    await registerMilestone(root, "alpha", 20);

    expect((await listRegistry(root, "groups")).map((entry) => entry.name)).toEqual([
      "app",
      "runtime",
    ]);
    expect((await listRegistry(root, "projects")).map((entry) => entry.name)).toEqual([
      "core",
      "suite",
    ]);
    expect((await listRegistry(root, "milestones")).map((entry) => entry.name)).toEqual([
      "beta",
      "alpha",
    ]);
    expect(await registerMilestone(root, "release", 40)).toMatchObject({
      name: "release",
      rank: 40,
    });
  });

  it("reports all registered metadata mismatches in strict validation", async () => {
    await registerGroup(root, "runtime");
    await registerProject(root, "app");
    await registerMilestone(root, "baseline", 10);
    await expect(
      addNode(root, {
        id: "bad",
        title: "Bad metadata",
        groupName: "typo",
        projects: ["wrong"],
        milestone: "later",
        spec: "Do work",
        acceptance: "Work is done",
      }),
    ).rejects.toThrow(/unknown group: typo; unknown milestone: later; unknown project: wrong/);
  });
});
