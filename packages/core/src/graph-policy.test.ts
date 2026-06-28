import { describe, expect, it } from "vite-plus/test";
import {
  addFinding,
  addNode,
  claimNode,
  ciFail,
  ciPass,
  disposeFinding,
  finishRun,
  getRun,
  latestRun,
  listFindings,
  listNodeNotes,
  listRuns,
  markMerged,
  policyReport,
  recordCiResult,
  recordCheckResult,
  startRun,
} from "./index.js";
import { installGraphFixture, passAudit, root } from "./graph-test-fixtures.js";

installGraphFixture();

describe("graph policy lifecycle", () => {
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

  it("filters runs by node, kind, and status and preserves run metadata", async () => {
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

    const audit = await startRun(root, "a", "audit", {
      agent: "external:auditor",
      auditKind: "security",
      command: "audit-tool",
      provider: "local",
      gitSha: "abc123",
      externalId: "run-1",
      url: "https://example.test/run-1",
      reportPath: "reports/audit.json",
      worktreePath: "/tmp/audit",
      summary: "audit started",
    });
    await startRun(root, "a", "check", { summary: "check started" });
    await startRun(root, "b", "audit", { summary: "other audit" });

    const finished = await finishRun(root, audit.id, {
      status: "superseded",
      summary: "newer audit exists",
      rationale: "rerun on updated branch",
      supersededBy: "next-run",
      exitCode: 124,
    });

    expect(await getRun(root, audit.id)).toMatchObject({
      kind: "audit",
      status: "superseded",
      command: "audit-tool",
      provider: "local",
      git_sha: "abc123",
      external_id: "run-1",
      url: "https://example.test/run-1",
      report_path: "reports/audit.json",
      audit_kind: "security",
      worktree_path: "/tmp/audit",
      agent: "external:auditor",
      rationale: "rerun on updated branch",
      superseded_by: "next-run",
      exit_code: 124,
    });
    expect(finished.summary).toBe("newer audit exists");
    expect(await listRuns(root, { nodeId: "a", kind: "audit", status: "superseded" })).toHaveLength(
      1,
    );
    expect(await listRuns(root, { nodeId: "a", status: "running" })).toHaveLength(1);
  });

  it("records P2/P3 finding disposition with a typed audit trail note", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    const finding = await addFinding(root, "a", {
      severity: "P2",
      title: "Follow-up",
      evidence: "Needs a later cleanup.",
    });

    const disposed = await disposeFinding(root, finding.id, {
      status: "dismissed",
      rationale: "Accepted risk for alpha.",
    });
    const notes = await listNodeNotes(root, "a", { kinds: ["audit-disposition"] });

    expect(disposed.status).toBe("dismissed");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toContain("Accepted risk for alpha");
  });

  it("requires a passed CI run before merge", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });

    await expect(markMerged(root, "a", "squash")).rejects.toThrow(/status ready/);
    await passAudit("a");
    await ciPass(root, "a");
    await expect(markMerged(root, "a", "squash")).rejects.toThrow(/use-existing-commit/);
    const merged = await markMerged(root, "a", "squash", { commitSha: "abc1234" });

    expect(merged.status).toBe("done");
  });

  it("reports policy violations for missing audit and verification evidence", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
      verification: [{ type: "manual", value: "fixture review" }],
    });

    const blocked = await policyReport(root, "a", "ci");
    expect(blocked.ok).toBe(false);
    expect(blocked.violations.map((violation) => violation.code).sort()).toEqual([
      "auditRequired",
      "verificationRequired",
    ]);

    await passAudit("a");
    const run = await startRun(root, "a", "verification", {
      provider: "sign-off",
      command: "manual:fixture review",
    });
    await finishRun(root, run.id, { status: "passed", summary: "fixture checked" });

    expect(await policyReport(root, "a", "ci")).toMatchObject({ ok: true });
  });

  it("reports latest failed audit and CI evidence in policy violations", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    const audit = await startRun(root, "a", "audit", { auditKind: "security" });
    await finishRun(root, audit.id, { status: "failed", summary: "security issue remains" });
    await ciFail(root, "a", "pipeline failed");

    const ciPolicy = await policyReport(root, "a", "ci");
    const mergePolicy = await policyReport(root, "a", "merge");

    expect(ciPolicy.violations).toMatchObject([
      {
        code: "auditRequired",
        evidence: { latestAudit: { id: audit.id, status: "failed" } },
      },
    ]);
    expect(mergePolicy.violations).toMatchObject([
      {
        code: "auditRequired",
        evidence: { latestAudit: { id: audit.id, status: "failed" } },
      },
      {
        code: "ciRequired",
        evidence: { latestCi: { status: "failed", summary: "pipeline failed" } },
      },
    ]);
  });

  it("blocks merge policy on undisposed P2/P3 findings and missing CI", async () => {
    await addNode(root, {
      id: "a",
      title: "Build A",
      spec: "Do A",
      acceptance: "A works",
    });
    await passAudit("a");
    await addFinding(root, "a", {
      severity: "P2",
      title: "Later cleanup",
      evidence: "Cleanup should be tracked.",
    });

    const beforeCi = await policyReport(root, "a", "merge");
    expect(beforeCi.ok).toBe(false);
    expect(beforeCi.violations.map((violation) => violation.code).sort()).toEqual([
      "ciRequired",
      "followupDispositionRequired",
    ]);

    const [finding] = await listFindings(root, { nodeId: "a", status: "open" });
    expect(finding).toBeDefined();
    await disposeFinding(root, finding!.id, {
      status: "dismissed",
      rationale: "Tracked outside this release.",
    });
    await ciPass(root, "a");

    expect(await policyReport(root, "a", "merge")).toMatchObject({ ok: true });
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

  it("keeps generated ids stable across more than two duplicate titles", async () => {
    const first = await addNode(root, {
      title: "Duplicate title",
      spec: "Do first",
      acceptance: "First works",
    });
    const second = await addNode(root, {
      title: "Duplicate title",
      spec: "Do second",
      acceptance: "Second works",
    });
    const third = await addNode(root, {
      title: "Duplicate title",
      spec: "Do third",
      acceptance: "Third works",
    });

    expect([first.id, second.id, third.id]).toEqual([
      "duplicate-title",
      "duplicate-title-2",
      "duplicate-title-3",
    ]);
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
});
