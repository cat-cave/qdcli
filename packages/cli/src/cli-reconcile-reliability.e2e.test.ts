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
import {
  initializeGitRepository,
  reconciliationReport,
  setupAcknowledgedProject,
  writeCompletionReport,
  writeNodeInput,
  writeReconciliationReport,
} from "./cli-reconcile-fixtures.js";

installCliFixture();

describe("qd reconciliation and reliability surfaces", () => {
  it("reconciles an integrated commit through every evidence gate", async () => {
    const commit = await initializeGitRepository();
    await setupAcknowledgedProject();
    await writeNodeInput("landed", [
      { type: "command", value: "just ci" },
      { type: "manual", value: "owner smoke" },
    ]);
    await qd("node", "add", "--from-json", "landed-node.json");
    await writeReconciliationReport("landed", commit);

    const result = await qdJson(
      "reconcile",
      "landed",
      "--commit",
      commit,
      "--from-report",
      "landed-reconciliation.json",
      "--json",
    );
    expect(result).toMatchObject({ ok: true, stoppedAt: "done", commit });
    expect(result.node.status).toBe("done");
    expect(result.runs.find((runRow: any) => runRow.kind === "ci")).toMatchObject({
      git_sha: commit,
      url: "https://example.test/ci/landed",
    });
    const doctor = await qdJson("doctor", "landed", "--json");
    expect(doctor).toMatchObject({
      ok: true,
      nodeId: "landed",
      status: "done",
      reasons: [],
      nextActions: [],
      verification: [
        { index: 1, type: "command", value: "just ci", signed: true },
        { index: 2, type: "manual", value: "owner smoke", signed: true },
      ],
      latest: {
        audit: { kind: "audit", status: "passed", agent: "independent-auditor" },
        check: null,
        ci: { kind: "ci", status: "passed", git_sha: commit },
        merge: { kind: "merge", status: "recorded", git_sha: commit },
      },
      openFindings: [],
      gate: { ok: true, explanations: [] },
      policy: { ci: { ok: true }, merge: { ok: true } },
      pullRequest: null,
    });

    const rerun = await qdJson(
      "reconcile",
      "landed",
      "--commit",
      commit,
      "--from-report",
      "landed-reconciliation.json",
      "--json",
    );
    expect(rerun.idempotent).toBe(true);

    await writeFile(
      path.join(root, "other-reconciliation.json"),
      `${JSON.stringify(reconciliationReport("other", commit))}\n`,
      "utf8",
    );
    await expectQdFailure(
      /report nodeId other does not match landed/,
      "reconcile",
      "landed",
      "--commit",
      commit,
      "--from-report",
      "other-reconciliation.json",
    );
    const wrongCi = reconciliationReport("landed", commit);
    wrongCi.ci.gitSha = "deadbee";
    await writeFile(
      path.join(root, "wrong-ci-reconciliation.json"),
      `${JSON.stringify(wrongCi)}\n`,
      "utf8",
    );
    await expectQdFailure(
      /CI gitSha deadbee does not match --commit/,
      "reconcile",
      "landed",
      "--commit",
      commit,
      "--from-report",
      "wrong-ci-reconciliation.json",
    );
  });

  it("supports indexed and report-backed verification without silent mismatches", async () => {
    await setupAcknowledgedProject();
    await writeNodeInput("verified", [
      { type: "command", value: "node --version" },
      { type: "manual", value: "owner review" },
    ]);
    await qd("node", "add", "--from-json", "verified-node.json");
    await expectQdFailure(
      /no command verification entry matching/,
      "verification",
      "sign-off",
      "verified",
      "--type",
      "command",
      "--value",
      "node  --version",
      "--note",
      "mismatch",
    );
    const indexed = await qdJson(
      "verification",
      "sign-off",
      "verified",
      "--index",
      "2",
      "--note",
      "Owner reviewed the behavior.",
      "--evidence",
      "reports/owner-review.md",
      "--json",
    );
    expect(indexed).toMatchObject({
      ok: true,
      nodeId: "verified",
      type: "manual",
      value: "owner review",
      note: "Owner reviewed the behavior.",
      evidence: "reports/owner-review.md",
      noteRecord: { kind: "note" },
      run: {
        kind: "verification",
        status: "passed",
        command: "manual:owner review",
        provider: "sign-off",
        report_path: "reports/owner-review.md",
        summary: "Owner reviewed the behavior.",
      },
    });
    const afterIndex = await qdJson("verification", "list", "verified", "--json");
    expect(afterIndex).toEqual({
      nodeId: "verified",
      verification: [
        { index: 1, type: "command", value: "node --version", signed: false },
        { index: 2, type: "manual", value: "owner review", signed: true },
      ],
    });

    await writeFile(
      path.join(root, "verification-signoff.json"),
      `${JSON.stringify({
        nodeId: "verified",
        entries: [
          {
            index: 1,
            type: "command",
            value: "node --version",
            status: "passed",
            summary: "The declared command passed.",
            evidence: "logs/node-version.log",
          },
          {
            index: 2,
            type: "manual",
            value: "owner review",
            status: "passed",
            summary: "The owner review passed.",
            evidence: "reports/owner-review.md",
          },
        ],
      })}\n`,
      "utf8",
    );
    const batch = await qdJson(
      "verification",
      "sign-off",
      "verified",
      "--all",
      "--from-report",
      "verification-signoff.json",
      "--json",
    );
    expect(batch).toMatchObject({
      ok: true,
      nodeId: "verified",
      signed: 2,
      runs: [
        {
          command: "node --version",
          provider: "report-sign-off",
          report_path: "logs/node-version.log",
          status: "passed",
        },
        {
          command: "manual:owner review",
          provider: "report-sign-off",
          report_path: "reports/owner-review.md",
          status: "passed",
        },
      ],
    });
    const afterAll = await qdJson("verification", "list", "verified", "--json");
    expect(afterAll.verification.map((entry: any) => entry.signed)).toEqual([true, true]);
    const detail = await qdJson("node", "show", "verified", "--full", "--json");
    expect(detail.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "note",
          text: "Signed off all 2 declared verifications.",
          evidence: "verification-signoff.json",
        }),
      ]),
    );

    for (const [option, value] of [
      ["--index", "1"],
      ["--type", "command"],
      ["--value", "node --version"],
      ["--note", "note"],
      ["--evidence", "evidence.md"],
    ]) {
      await expectQdFailure(
        /--all cannot be combined/,
        "verification",
        "sign-off",
        "verified",
        "--all",
        "--from-report",
        "verification-signoff.json",
        option!,
        value!,
      );
    }
    await writeFile(
      path.join(root, "wrong-node-verification.json"),
      `${JSON.stringify({
        nodeId: "other",
        entries: [
          {
            index: 1,
            type: "command",
            value: "node --version",
            status: "passed",
            summary: "passed",
            evidence: "logs/node-version.log",
          },
          {
            index: 2,
            type: "manual",
            value: "owner review",
            status: "passed",
            summary: "passed",
            evidence: "reports/owner-review.md",
          },
        ],
      })}\n`,
      "utf8",
    );
    await expectQdFailure(
      /verification report nodeId other does not match verified/,
      "verification",
      "sign-off",
      "verified",
      "--all",
      "--from-report",
      "wrong-node-verification.json",
    );
    await expectQdFailure(
      /Unknown verification action: mystery/,
      "verification",
      "mystery",
      "verified",
    );

    await writeNodeInput("verification-run", [
      { type: "command", value: 'node -e "process.exit(0)"' },
      { type: "command", value: 'node -e "process.exit(7)"' },
      { type: "manual", value: "not executable" },
    ]);
    await qd("node", "add", "--from-json", "verification-run-node.json");
    const run = await qdJsonAllowExit("verification", "run", "verification-run", "--json");
    expect(run.exitCode).toBe(1);
    expect(run.json.ok).toBe(false);
    expect(run.json.runs.map((item: any) => [item.command, item.status, item.exit_code])).toEqual([
      ['node -e "process.exit(0)"', "passed", 0],
      ['node -e "process.exit(7)"', "failed", 7],
    ]);
    const runDoctor = await qdJsonAllowExit("doctor", "verification-run", "--json");
    expect(runDoctor.exitCode).toBe(1);
    expect(runDoctor.json).toMatchObject({
      status: "ready",
      verification: [
        { index: 1, type: "command", value: 'node -e "process.exit(0)"', signed: true },
        { index: 2, type: "command", value: 'node -e "process.exit(7)"', signed: false },
        { index: 3, type: "manual", value: "not executable", signed: false },
      ],
      latest: { audit: null, check: null, ci: null, merge: null },
    });
  });

  it("records a failed reconciliation audit without requiring downstream CI evidence", async () => {
    const commit = await initializeGitRepository();
    await setupAcknowledgedProject();
    await writeNodeInput("failed-reconcile", []);
    await qd("node", "add", "--from-json", "failed-reconcile-node.json");
    const report = reconciliationReport("failed-reconcile", commit);
    report.audit.realWorldValidation = {
      required: true,
      status: "failed",
      evidence: "reports/live-failure.md",
    };
    report.audit.findings = [
      {
        severity: "P1",
        title: "Acceptance failed",
        evidence: "reports/live-failure.md",
        observed: "The live smoke failed.",
        expected: "The live smoke passes.",
        classification: "implementation",
        path: "src/failure.ts",
        line: 7,
        suggestedFix: "Repair the live path.",
      },
    ];
    delete (report as Partial<typeof report>).verification;
    delete (report as Partial<typeof report>).ci;
    await writeFile(
      path.join(root, "failed-reconcile-reconciliation.json"),
      `${JSON.stringify(report)}\n`,
      "utf8",
    );

    const result = await qdJsonAllowExit(
      "reconcile",
      "failed-reconcile",
      "--commit",
      commit,
      "--from-report",
      "failed-reconcile-reconciliation.json",
      "--json",
    );
    expect(result.exitCode).toBe(1);
    expect(result.json).toMatchObject({
      ok: false,
      stoppedAt: "review",
      commit,
      operation: "ledger-reconciliation",
      gitIntegrated: true,
      node: { status: "review" },
      findings: [
        {
          severity: "P1",
          title: "Acceptance failed",
          path: "src/failure.ts",
          line: 7,
          suggested_fix: "Repair the live path.",
        },
      ],
      nextActions: [
        "Resolve or promote the recorded findings for failed-reconcile.",
        expect.stringContaining("Rerun qd reconcile failed-reconcile"),
      ],
    });
  });

  it("keeps JSON parseable when successful checks emit stderr and explains review stops", async () => {
    await setupAcknowledgedProject();
    await qd("config", "set", "require_clean_worktree", "false");
    await qd(
      "config",
      "set",
      "check_command",
      "node -e \"process.stderr.write('probe stderr\\n')\"",
    );
    await writeNodeInput("advance-json", []);
    await qd("node", "add", "--from-json", "advance-json-node.json");
    await writeCompletionReport("advance-json");

    const advanced = await qdJson(
      "advance",
      "advance-json",
      "--from-report",
      "advance-json-completion.json",
      "--skip-ci",
      "--json",
    );
    expect(advanced).toMatchObject({ ok: true, stoppedAt: "review" });
    expect(advanced.steps.find((step: any) => step.step === "check").ok).toBe(true);
    const diagnosed = await qdJsonAllowExit("doctor", "advance-json", "--json");
    expect(diagnosed.exitCode).toBe(1);
    expect(diagnosed.json.reasons.map((reason: any) => reason.code)).toContain("auditRequired");
    expect(diagnosed.json).toMatchObject({
      ok: false,
      nodeId: "advance-json",
      status: "review",
      verification: [],
      latest: {
        audit: null,
        check: { kind: "check", status: "passed" },
        ci: null,
        merge: null,
      },
      openFindings: [],
      pullRequest: null,
    });
    expect(diagnosed.json.nextActions).toEqual([
      "qd audit start advance-json",
      "qd audit pass advance-json --from-report <audit-report.json>",
    ]);
  });
});
