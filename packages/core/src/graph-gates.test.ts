import { describe, expect, it } from "vite-plus/test";
import {
  addEdge,
  addFinding,
  addNodeNote,
  addNode,
  finishRun,
  gateNode,
  listFindings,
  promoteFindings,
  resolveFinding,
  startRun,
} from "./index.js";
import { installGraphFixture, root } from "./graph-test-fixtures.js";

installGraphFixture();

describe("graph gates", () => {
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

  it("rejects lifecycle records that reference missing nodes", async () => {
    await expect(startRun(root, "missing", "audit")).rejects.toThrow(/Node not found/);
    await expect(
      addFinding(root, "missing", {
        severity: "P1",
        title: "Bad node",
        evidence: "The node does not exist.",
      }),
    ).rejects.toThrow(/Node not found/);
    await expect(addNodeNote(root, "missing", "No node")).rejects.toThrow(/Node not found/);
  });

  it("blocks the gate while an audit run is still running", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });

    const run = await startRun(root, "a", "audit", { auditKind: "acceptance" });
    const blocked = await gateNode(root, "a");

    expect(blocked.ok).toBe(false);
    expect(blocked.runningAudits.map((item) => item.id)).toEqual([run.id]);

    await finishRun(root, run.id, { status: "passed", summary: "audit passed" });
    expect((await gateNode(root, "a")).ok).toBe(true);
  });

  it("explains explicit node blockers and incomplete dependency blockers", async () => {
    await addNode(root, {
      id: "manual-gate",
      title: "Manual gate",
      status: "blocked",
      blockedBy: "manual",
      blockedReason: "Requires owner console access.",
      spec: "Wait for owner action",
      acceptance: "Owner action is complete",
    });
    const manualGate = await gateNode(root, "manual-gate");
    expect(manualGate.ok).toBe(false);
    expect(manualGate.explanations.map((item) => item.code)).toEqual(["nodeBlocked"]);
    expect(manualGate.explanations[0]?.message).toContain("Requires owner console access.");

    await addNode(root, {
      id: "dependency",
      title: "Dependency",
      spec: "Do dependency",
      acceptance: "Dependency is done",
    });
    await addNode(root, {
      id: "blocked-by-dependency",
      title: "Blocked by dependency",
      spec: "Do dependent work",
      acceptance: "Dependent work is done",
    });
    await addEdge(root, "dependency", "blocked-by-dependency");
    const dependencyGate = await gateNode(root, "blocked-by-dependency");
    expect(dependencyGate.ok).toBe(false);
    expect(dependencyGate.blockedDependencies.map((node) => node.id)).toEqual(["dependency"]);
    expect(dependencyGate.explanations.map((item) => item.code)).toEqual(["blockedDependency"]);
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

  it("refuses promotion while blocking findings are still open with actionable context", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    const blocking = await addFinding(root, "a", {
      severity: "P1",
      title: "Blocking defect",
      evidence: "The implementation is not safe to merge.",
    });
    await addFinding(root, "a", {
      severity: "P2",
      title: "Follow-up cleanup",
      evidence: "The implementation could be cleaner later.",
    });

    await expect(promoteFindings(root, "a")).rejects.toThrow(
      new RegExp(`P1 ${blocking.id}: Blocking defect`),
    );
    expect(await listFindings(root, { nodeId: "a", status: "open" })).toHaveLength(2);
  });
});
