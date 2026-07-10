import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  addEdge,
  addFinding,
  addNode,
  getNode,
  listFindings,
  listRuns,
  openDatabase,
  reconcileNode,
  run,
  setNodeStatus,
  setupProject,
  startRun,
} from "./index.js";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "qd-reconcile-"));
  await setupProject(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("reconcileNode", () => {
  it("records clean reconciliation evidence atomically and is idempotent", async () => {
    await addNode(root, {
      id: "landed",
      title: "Landed node",
      spec: "Reconcile an integrated change.",
      acceptance: "The node reaches done with evidence.",
      verification: [
        { type: "command", value: "just ci" },
        { type: "manual", value: "owner smoke" },
      ],
    });
    const input = cleanInput();
    const result = await reconcileNode(root, "landed", input);

    expect(result).toMatchObject({ ok: true, idempotent: false, stoppedAt: "done" });
    expect(result.node.status).toBe("done");
    expect(result.runs.map((runRow) => [runRow.kind, runRow.status])).toEqual([
      ["implement", "completed"],
      ["audit", "passed"],
      ["verification", "passed"],
      ["verification", "passed"],
      ["ci", "passed"],
      ["merge", "recorded"],
    ]);
    expect(result.runs.find((runRow) => runRow.kind === "ci")).toMatchObject({
      provider: "github",
      git_sha: "abc1234",
      external_id: null,
      url: "https://example.test/ci/1",
      summary: "Trusted CI passed.",
    });
    expect(result.runs.find((runRow) => runRow.kind === "merge")).toMatchObject({
      provider: "reconciliation",
      git_sha: "abc1234",
      report_path: "reports/reconciliation.json",
      summary: "Merge recorded from reconciliation at commit abc1234",
    });

    const rerun = await reconcileNode(root, "landed", input);
    expect(rerun).toMatchObject({ ok: true, idempotent: true, stoppedAt: "done", runs: [] });
    expect(await listRuns(root, { nodeId: "landed" })).toHaveLength(6);
  });

  it("rolls back invalid verification evidence before recording lifecycle state", async () => {
    await addNode(root, {
      id: "invalid",
      title: "Invalid reconciliation",
      spec: "Reject mismatched evidence.",
      acceptance: "No partial lifecycle state is recorded.",
      verification: [{ type: "command", value: "just ci" }],
    });
    await expect(
      reconcileNode(root, "invalid", {
        ...cleanInput(),
        verification: [{ command: "just test", summary: "wrong", evidence: "wrong.log" }],
      }),
    ).rejects.toThrow(/does not match the declared verification set/);
    expect((await getNode(root, "invalid")).status).toBe("ready");
    expect(await listRuns(root, { nodeId: "invalid" })).toEqual([]);
  });

  it("records an honest failed audit and stops before verification, CI, and merge", async () => {
    await addNode(root, {
      id: "audit-failed",
      title: "Audit failed reconciliation",
      spec: "Preserve failed audit evidence.",
      acceptance: "The node remains in review.",
    });
    const result = await reconcileNode(root, "audit-failed", {
      ...cleanInput(),
      auditPassed: false,
      findings: [
        {
          severity: "P1",
          title: "Acceptance failed",
          evidence: "reports/failure.md",
          path: "src/a.ts",
          line: 12,
          expected: "Acceptance should pass.",
          suggestedFix: "Repair acceptance.",
        },
      ],
      verification: [],
      ci: undefined,
    });

    expect(result).toMatchObject({ ok: false, stoppedAt: "review" });
    expect(result.runs.map((runRow) => runRow.kind)).toEqual(["implement", "audit"]);
    expect((await getNode(root, "audit-failed")).status).toBe("review");
    expect(await listFindings(root, { nodeId: "audit-failed" })).toEqual([
      expect.objectContaining({
        severity: "P1",
        status: "open",
        title: "Acceptance failed",
        path: "src/a.ts",
        line: 12,
        evidence: "reports/failure.md",
        expected: "Acceptance should pass.",
        suggested_fix: "Repair acceptance.",
      }),
    ]);
  });

  it("rejects missing nodes and lifecycle states that cannot be reconciled", async () => {
    await expect(reconcileNode(root, "missing", cleanInput())).rejects.toThrow(
      "Node not found: missing",
    );
    for (const status of ["draft", "blocked", "cancelled", "regressed"] as const) {
      const id = `status-${status}`;
      await addNode(root, {
        id,
        title: status,
        spec: "Forbidden reconciliation state.",
        acceptance: "Reconciliation is rejected.",
        status,
        blockedBy: status === "blocked" ? "manual" : undefined,
        blockedReason: status === "blocked" ? "waiting" : undefined,
      });
      await expect(reconcileNode(root, id, { ...cleanInput(), verification: [] })).rejects.toThrow(
        `Cannot reconcile node with status ${status}`,
      );
      expect(await listRuns(root, { nodeId: id })).toEqual([]);
    }
  });

  it("rejects incomplete dependencies, open findings, and running audits", async () => {
    await addNode(root, {
      id: "dependency",
      title: "Dependency",
      spec: "Dependency.",
      acceptance: "Done.",
    });
    await addNode(root, {
      id: "dependent",
      title: "Dependent",
      spec: "Dependent.",
      acceptance: "Done.",
    });
    await addEdge(root, "dependency", "dependent", "requires");
    await expect(
      reconcileNode(root, "dependent", { ...cleanInput(), verification: [] }),
    ).rejects.toThrow("dependencies are incomplete: dependency (ready)");

    await addNode(root, {
      id: "finding-gate",
      title: "Finding gate",
      spec: "Finding gate.",
      acceptance: "No open findings.",
    });
    const finding = await addFinding(root, "finding-gate", {
      severity: "P1",
      title: "Existing finding",
      evidence: "reports/finding.md",
    });
    await expect(
      reconcileNode(root, "finding-gate", { ...cleanInput(), verification: [] }),
    ).rejects.toThrow(`existing open findings: ${finding.id}`);

    await addNode(root, {
      id: "running-audit",
      title: "Running audit",
      spec: "Audit gate.",
      acceptance: "No active audit.",
    });
    const audit = await startRun(root, "running-audit", "audit");
    await expect(
      reconcileNode(root, "running-audit", { ...cleanInput(), verification: [] }),
    ).rejects.toThrow(`audit runs are active: ${audit.id}`);
  });

  it("requires CI for a passed audit and exact ordered verification coverage", async () => {
    await addNode(root, {
      id: "ci-required",
      title: "CI required",
      spec: "Require CI.",
      acceptance: "CI evidence exists.",
    });
    await expect(
      reconcileNode(root, "ci-required", { ...cleanInput(), verification: [], ci: undefined }),
    ).rejects.toThrow("passed reconciliation requires CI evidence");
    expect(await listRuns(root, { nodeId: "ci-required" })).toEqual([]);

    await addNode(root, {
      id: "ordered-verification",
      title: "Ordered verification",
      spec: "Match declared verification.",
      acceptance: "Evidence is exact.",
      verification: [
        { type: "manual", value: "first" },
        { type: "url", value: "https://example.test" },
      ],
    });
    await expect(
      reconcileNode(root, "ordered-verification", {
        ...cleanInput(),
        verification: [
          { command: "url:https://example.test", summary: "second", evidence: "2" },
          { command: "manual:first", summary: "first", evidence: "1" },
        ],
      }),
    ).rejects.toThrow("does not match the declared verification set");
    await expect(
      reconcileNode(root, "ordered-verification", {
        ...cleanInput(),
        verification: [{ command: "manual:first", summary: "first", evidence: "1" }],
      }),
    ).rejects.toThrow("does not match the declared verification set");
  });

  it("does not duplicate implementation evidence when starting at review or mergeable", async () => {
    for (const status of ["review", "mergeable"] as const) {
      const id = `start-${status}`;
      await addNode(root, {
        id,
        title: status,
        spec: "Resume reconciliation.",
        acceptance: "No duplicate implementation run.",
        status,
      });
      const result = await reconcileNode(root, id, { ...cleanInput(), verification: [] });
      expect(result.runs.map((runRow) => runRow.kind)).toEqual(["audit", "ci", "merge"]);
    }
  });

  it("recognizes legacy merge summaries and refuses a different or unknown done commit", async () => {
    for (const [id, summary, expected] of [
      ["legacy", "Merge recorded at abc1234", true],
      ["different", "Merge recorded at def5678", false],
      ["unknown", "Legacy merge without sha", false],
    ] as const) {
      await addNode(root, {
        id,
        title: id,
        spec: "Already done.",
        acceptance: "Reconciliation is idempotent only at the same commit.",
      });
      await setNodeStatus(root, id, "done");
      const db = await openDatabase(root);
      const now = new Date().toISOString();
      await run(
        db,
        "insert into runs (id, node_id, kind, status, started_at, finished_at, summary) values (?, ?, 'merge', 'recorded', ?, ?, ?)",
        [`merge-${id}`, id, now, now, summary],
      );
      await db.close();
      if (expected) {
        await expect(
          reconcileNode(root, id, { ...cleanInput(), verification: [] }),
        ).resolves.toMatchObject({ idempotent: true });
      } else {
        await expect(
          reconcileNode(root, id, { ...cleanInput(), verification: [] }),
        ).rejects.toThrow(
          id === "unknown"
            ? "already done at an unknown commit"
            : "already done at def5678; refusing to reconcile abc1234",
        );
      }
    }
  });
});

function cleanInput() {
  return {
    commitSha: "abc1234",
    completionSummary: "Implementation completed with evidence.",
    reportPath: "reports/reconciliation.json",
    auditSummary: "Independent audit passed.",
    auditPassed: true,
    auditor: "auditor",
    findings: [],
    verification: [
      { command: "just ci", summary: "command passed", evidence: "logs/ci.log" },
      { command: "manual:owner smoke", summary: "smoke passed", evidence: "reports/smoke.md" },
    ],
    ci: {
      summary: "Trusted CI passed.",
      provider: "github",
      gitSha: "abc1234",
      url: "https://example.test/ci/1",
    },
  };
}
