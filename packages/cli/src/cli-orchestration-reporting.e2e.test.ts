import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  configureStrictDoctorCommands,
  expectQdFailure,
  installCliFixture,
  qd,
  qdJson,
  root,
} from "./cli-e2e-fixtures.js";

installCliFixture();

describe("qd CLI orchestration reporting surfaces", () => {
  it("exercises assignment, audit, verification, prompt, and export commands", async () => {
    await qd("setup", "--no-hooks");
    await qd("method", "acknowledge", "--agent", "test");
    await configureStrictDoctorCommands();
    await qd("group", "register", "--name", "runtime");
    await qd("project", "register", "--name", "app");
    await qd("milestone", "register", "--name", "baseline", "--rank", "10");

    await writeFile(
      path.join(root, "bulk.json"),
      `${JSON.stringify({
        nodes: [
          {
            id: "dependency",
            title: "Dependency",
            groupName: "runtime",
            projects: ["app"],
            milestone: "baseline",
            spec: "Complete dependency work.",
            acceptance: "Dependency work is done.",
          },
          {
            id: "feature",
            title: "Feature",
            groupName: "runtime",
            projects: ["app"],
            milestone: "baseline",
            priority: "P1",
            verification: [{ type: "command", value: 'node -e "process.exit(0)"' }],
            auditFocus: ["regression risk"],
            spec: "Complete feature work.",
            acceptance: "Feature work is done.",
          },
        ],
        edges: [{ from: "dependency", to: "feature", type: "requires" }],
      })}\n`,
      "utf8",
    );
    const bulk = await qdJson("nodes", "add-bulk", "--from-json", "bulk.json", "--json");
    expect(bulk.nodes.map((node: any) => node.id)).toEqual(["dependency", "feature"]);

    const assignment = await qdJson(
      "assignment",
      "add",
      "dependency",
      "--role",
      "worker",
      "--owner",
      "agent:worker",
      "--branch",
      "spec/dependency",
      "--worktree",
      "/tmp/qdcli-e2e-dependency",
      "--scope",
      "dependency",
      "--json",
    );
    expect(assignment.status).toBe("open");
    await writeFile(
      path.join(root, "assignment-report.json"),
      `${JSON.stringify({
        summary: "Assignment completed.",
        commits: ["abc123"],
        evidence: ["reports/dependency.md"],
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(root, "assignment-input.json"),
      `${JSON.stringify({
        nodeId: "dependency",
        role: "worker",
        owner: "agent:worker",
        branch: "spec/dependency",
      })}\n`,
      "utf8",
    );
    expect((await qdJson("assignment", "validate", "assignment-input.json", "--json")).ok).toBe(
      true,
    );
    expect(
      (
        await qdJson(
          "assignment",
          "complete",
          assignment.id,
          "--from-json",
          "assignment-report.json",
          "--json",
        )
      ).status,
    ).toBe("complete");

    const wave = await qdJson(
      "wave",
      "start",
      "--kind",
      "implementation",
      "--summary",
      "wave",
      "--json",
    );
    await qd("wave", "add-node", wave.id, "dependency", "--json");
    await qd("wave", "add-assignment", wave.id, assignment.id, "--json");
    expect((await qdJson("wave", "status", "--json")).memberships).toHaveLength(2);
    expect((await qdJson("wave", "complete", wave.id, "--summary", "done", "--json")).status).toBe(
      "complete",
    );

    await writeFile(
      path.join(root, "audit-report.json"),
      `${JSON.stringify({
        nodeId: "feature",
        acceptanceReviewed: [
          {
            criterion: "Feature work is done.",
            status: "passed",
            evidence: "reports/feature-acceptance.md",
          },
        ],
        verificationEvidence: {
          diffReviewed: true,
          completionReportReviewed: true,
          verificationEvidenceReviewed: true,
        },
        realWorldValidation: {
          required: false,
          status: "not_required",
          evidence: "No external surface is required for this fixture node.",
        },
        findings: [],
      })}\n`,
      "utf8",
    );
    expect((await qdJson("audit", "validate", "audit-report.json", "--json")).ok).toBe(true);
    const runningAudit = await qdJson("audit", "start", "feature", "--kind", "security", "--json");
    expect((await qdJson("audit", "list", "--node", "feature", "--json")).length).toBeGreaterThan(
      0,
    );
    expect(
      (
        await qdJson(
          "audit",
          "fail",
          "feature",
          "--run-id",
          runningAudit.id,
          "--from-report",
          "audit-report.json",
          "--summary",
          "audit failed without findings",
          "--json",
        )
      ).ok,
    ).toBe(false);
    const cancelAudit = await qdJson("audit", "start", "feature", "--kind", "security", "--json");
    expect(
      (
        await qdJson(
          "audit",
          "cancel",
          "feature",
          "--run-id",
          cancelAudit.id,
          "--rationale",
          "branch changed",
          "--json",
        )
      ).status,
    ).toBe("cancelled");
    const supersedeAudit = await qdJson(
      "audit",
      "start",
      "feature",
      "--kind",
      "security",
      "--json",
    );
    expect(
      (
        await qdJson(
          "audit",
          "supersede",
          "feature",
          "--run-id",
          supersedeAudit.id,
          "--rationale",
          "newer audit exists",
          "--json",
        )
      ).status,
    ).toBe("superseded");
    const implementRun = await qdJson("start", "dependency", "--json");
    expect((await qdJson("run", "show", implementRun.id, "--json")).id).toBe(implementRun.id);
    expect((await qdJson("run", "list", "--node", "dependency", "--json")).length).toBeGreaterThan(
      0,
    );
    expect(
      (
        await qdJson(
          "run",
          "cancel",
          implementRun.id,
          "--rationale",
          "cancelled by orchestrator",
          "--json",
        )
      ).status,
    ).toBe("cancelled");
    const supersededRun = await qdJson("start", "dependency", "--json");
    expect(
      (
        await qdJson(
          "run",
          "supersede",
          supersededRun.id,
          "--by",
          "new-run",
          "--rationale",
          "newer attempt",
          "--json",
        )
      ).status,
    ).toBe("superseded");
    await writeFile(
      path.join(root, "verification-report.json"),
      `${JSON.stringify({
        nodeId: "feature",
        status: "passed",
        command: "external",
        summary: "external verification passed",
        evidence: "reports/verification.md",
      })}\n`,
      "utf8",
    );
    expect(
      (await qdJson("verification", "validate", "verification-report.json", "--json")).ok,
    ).toBe(true);
    expect(
      (await qdJson("verification", "record", "--from-json", "verification-report.json", "--json"))
        .status,
    ).toBe("passed");
    expect((await qdJson("verification", "list", "feature", "--json")).verification).toHaveLength(
      1,
    );
    expect((await qdJson("verification", "run", "feature", "--json")).ok).toBe(true);

    expect((await qdJson("schema", "print", "assignment", "--json")).type).toBe("object");
    expect(
      (await qdJson("prompt", "implement", "feature", "--json")).gate.explanations[0].code,
    ).toBe("blockedDependency");
    expect((await qdJson("prompt", "audit", "feature", "--json")).auditDiffCommand).toContain(
      "qd diff",
    );
    expect(await qd("prompt", "plan")).toContain("Perform product/integration research");
    expect(await qd("prompt", "research")).toContain("Research before building");
    expect(await qd("prompt", "reality-check")).toContain("Run a qd DAG reality check");
    expect(await qd("prompt", "repo-audit")).toContain("Audit the whole codebase");
    expect(await qd("prompt", "dag-review")).toContain("Review and revise the qd DAG");
    expect(await qd("prompt", "implement", "feature")).toContain("Do not invent APIs");
    expect(await qd("prompt", "audit", "feature")).toContain("CI is a separate gate");
    expect(await qd("prompt", "resolve", "feature")).toContain("Resolve only open P0/P1");

    await qd("export", "--deterministic", "--out", "roadmap/spec-dag.json");
    expect(
      (await qdJson("state", "diff", "--against-export", "roadmap/spec-dag.json", "--json")).ok,
    ).toBe(true);
    expect(
      (await qdJson("state", "rebuild", "--from-export", "roadmap/spec-dag.json", "--json")).ok,
    ).toBe(true);
    expect((await qdJson("export", "--fields", "id,status", "--json")).length).toBeGreaterThan(0);
    expect(await qdJson("export", "--status", "ready,review", "--json")).toHaveProperty("nodes");
    await expectQdFailure(/--status must contain one of/, "export", "--status", "ready,wat");
    expect((await qdJson("validate", "--json")).ok).toBe(true);
  });
});
