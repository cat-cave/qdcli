import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  expectQdFailure,
  installCliFixture,
  qd,
  qdJson,
  qdJsonAllowExit,
  root,
} from "./cli-e2e-fixtures.js";

installCliFixture();

function auditReport(
  nodeId: string,
  findings: Array<Record<string, unknown>> = [],
  realWorldValidation: Record<string, unknown> = {
    required: false,
    status: "not_required",
    evidence: "No external integration in this fixture.",
  },
): string {
  return `${JSON.stringify({
    nodeId,
    acceptanceReviewed: [
      {
        criterion: "Audit workflows are durable.",
        status: "passed",
        evidence: "reports/audit-acceptance.md",
      },
    ],
    verificationEvidence: {
      diffReviewed: true,
      completionReportReviewed: true,
      verificationEvidenceReviewed: true,
    },
    realWorldValidation,
    findings,
  })}\n`;
}

function auditFinding(
  severity: string,
  title: string,
  evidence: string,
  expected = "The audited behavior satisfies the spec.",
): Record<string, unknown> {
  return {
    severity,
    title,
    evidence,
    observed: evidence,
    expected,
    classification: "implementation",
  };
}

describe("qd CLI audit command hardening", () => {
  it("exercises finding add, list, dispose, resolve, and promote branches", async () => {
    await qd("setup", "--no-hooks");
    await qd("method", "acknowledge", "--agent", "test");
    await qd(
      "node",
      "add",
      "--id",
      "audit-node",
      "--title",
      "Audit node",
      "--spec",
      "Implement audited behavior.",
      "--acceptance",
      "Audit workflows are durable.",
    );
    await qd(
      "node",
      "add",
      "--id",
      "target-node",
      "--title",
      "Target node",
      "--spec",
      "Receive promoted findings.",
      "--acceptance",
      "Promoted findings leave notes.",
    );

    const blocking = await qdJson(
      "finding",
      "add",
      "audit-node",
      "--severity",
      "P1",
      "--title",
      "Blocking bug",
      "--evidence",
      "Breaks the gate.",
      "--path",
      "src/a.ts",
      "--line",
      "3",
      "--expected",
      "Gate stays blocked.",
      "--suggested-fix",
      "Fix the blocker.",
      "--json",
    );
    expect(blocking).toMatchObject({
      node_id: "audit-node",
      severity: "P1",
      title: "Blocking bug",
      line: 3,
    });
    await expectQdFailure(/P0\/P1 findings must be resolved/, "finding", "promote", blocking.id);
    expect((await qdJson("finding", "resolve", blocking.id, "--json")).status).toBe("resolved");

    const dismissed = await qdJson(
      "finding",
      "add",
      "audit-node",
      "--severity",
      "P3",
      "--title",
      "Accepted risk",
      "--evidence",
      "Low risk edge.",
      "--json",
    );
    expect(
      (
        await qdJson(
          "finding",
          "dispose",
          dismissed.id,
          "--disposition",
          "accepted-risk",
          "--rationale",
          "Documented risk.",
          "--json",
        )
      ).status,
    ).toBe("dismissed");

    const promotedToTarget = await qdJson(
      "finding",
      "add",
      "audit-node",
      "--severity",
      "P2",
      "--title",
      "Promote to note",
      "--evidence",
      "Needs follow-up note.",
      "--json",
    );
    expect(
      (
        await qdJson(
          "finding",
          "promote",
          promotedToTarget.id,
          "--node",
          "target-node",
          "--rationale",
          "Tracked by target.",
          "--json",
        )
      ).finding.status,
    ).toBe("promoted");

    const promotedToNode = await qdJson(
      "finding",
      "add",
      "audit-node",
      "--severity",
      "P3",
      "--title",
      "Promote to node",
      "--evidence",
      "Needs a small follow-up.",
      "--expected",
      "Follow-up is complete.",
      "--path",
      "src/b.ts",
      "--line",
      "8",
      "--json",
    );
    const created = await qdJson(
      "finding",
      "promote",
      promotedToNode.id,
      "--title",
      "Created follow-up",
      "--verification",
      "type=manual,value=owner review",
      "--json",
    );
    expect(created.node).toMatchObject({
      title: "Created follow-up",
      kind: "audit-fix",
      priority: "P3",
      risk: "low",
      acceptance: "Follow-up is complete.",
      context: "src/b.ts:8",
    });

    expect(await qdJson("finding", "list", "--open", "--json")).toEqual([]);
    await expectQdFailure(
      /Use either --open or --status/,
      "finding",
      "list",
      "--open",
      "--status",
      "open",
    );
    await expectQdFailure(
      /--disposition must be/,
      "finding",
      "dispose",
      promotedToNode.id,
      "--disposition",
      "ignored",
      "--rationale",
      "nope",
    );
  });

  it("exercises audit start, validate, list, pass, fail, and terminal statuses", async () => {
    await qd("setup", "--no-hooks");
    await qd("method", "acknowledge", "--agent", "test");
    await qd(
      "node",
      "add",
      "--id",
      "audit-node",
      "--title",
      "Audit node",
      "--spec",
      "Implement audited behavior.",
      "--acceptance",
      "Audit workflows are durable.",
    );

    const legacyStart = await qdJson("audit", "audit-node", "--json");
    expect(legacyStart).toMatchObject({ node_id: "audit-node", kind: "audit" });
    const started = await qdJson(
      "audit",
      "start",
      "audit-node",
      "--kind",
      "security",
      "--auditor",
      "reviewer",
      "--summary",
      "Manual audit.",
      "--json",
    );
    expect(started).toMatchObject({
      node_id: "audit-node",
      kind: "audit",
      audit_kind: "security",
      agent: "reviewer",
      summary: "Manual audit.",
    });
    expect(
      (await qdJson("audit", "list", "--node", "audit-node", "--status", "running", "--json"))
        .length,
    ).toBe(2);

    await writeFile(path.join(root, "audit-clean.json"), auditReport("audit-node"));
    expect(
      (await qdJson("audit", "validate", "--file", "audit-clean.json", "--json")).findings,
    ).toBe(0);
    await expectQdFailure(
      /Multiple running audits/,
      "audit",
      "pass",
      "audit-node",
      "--from-report",
      "audit-clean.json",
    );
    expect(
      (
        await qdJson(
          "audit",
          "cancel",
          "audit-node",
          "--run-id",
          legacyStart.id,
          "--rationale",
          "covered multiple-running branch",
          "--json",
        )
      ).status,
    ).toBe("cancelled");
    expect(
      (
        await qdJson(
          "audit",
          "pass",
          "audit-node",
          "--run-id",
          started.id,
          "--from-report",
          "audit-clean.json",
          "--json",
        )
      ).ok,
    ).toBe(true);

    const failingRun = await qdJson("audit", "start", "audit-node", "--json");
    await writeFile(
      path.join(root, "audit-failed.json"),
      auditReport("audit-node", [auditFinding("P2", "Follow up", "Needs repair.")]),
    );
    const failed = await qdJson(
      "audit",
      "fail",
      "audit-node",
      "--run-id",
      failingRun.id,
      "--from-report",
      "audit-failed.json",
      "--summary",
      "Audit failed with follow-up.",
      "--json",
    );
    expect(failed).toMatchObject({
      ok: false,
      imported: { importedFindings: 1 },
      run: { status: "failed", summary: "Audit failed with follow-up." },
    });

    for (const [action, expected] of [
      ["dispose", "cancelled"],
      ["cancel", "cancelled"],
      ["supersede", "superseded"],
    ] as const) {
      const run = await qdJson("audit", "start", "audit-node", "--json");
      expect(
        (
          await qdJson(
            "audit",
            action,
            "audit-node",
            "--run-id",
            run.id,
            "--rationale",
            `${action} rationale`,
            "--json",
          )
        ).status,
      ).toBe(expected);
    }

    const blockedRun = await qdJson("audit", "start", "audit-node", "--json");
    await writeFile(
      path.join(root, "audit-blocking.json"),
      auditReport("audit-node", [auditFinding("P1", "Blocker", "Still broken.")]),
    );
    const blocked = await qdJsonAllowExit(
      "audit",
      "pass",
      "audit-node",
      "--run-id",
      blockedRun.id,
      "--from-report",
      "audit-blocking.json",
      "--json",
    );
    expect(blocked.exitCode).toBe(1);
    expect(blocked.json).toMatchObject({ ok: false, code: "auditNotClean", remaining: 1 });
  });
});
