import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  expectQdFailure,
  installCliFixture,
  qd,
  qdJson,
  qdJsonAllowExit,
  qdRaw,
  root,
} from "./cli-e2e-fixtures.js";

installCliFixture();

async function addLifecycleNode(id: string, extraArgs: string[] = []): Promise<void> {
  await qd(
    "node",
    "add",
    "--id",
    id,
    "--title",
    id,
    "--spec",
    `${id} spec.`,
    "--acceptance",
    `${id} acceptance.`,
    ...extraArgs,
  );
}

describe("qd CLI lifecycle branch behavior", () => {
  it("records and runs verification with explicit failure behavior", async () => {
    await qd("init");
    await addLifecycleNode("verify-record");
    const reportPath = path.join(root, "verification.json");
    await writeFile(
      reportPath,
      JSON.stringify({
        nodeId: "verify-record",
        status: "passed",
        command: "external review",
        provider: "human",
        summary: "manual review passed",
        evidence: "reports/verification.md",
        exitCode: 0,
      }),
      "utf8",
    );
    const recorded = await qdJson("verification", "record", "--from-json", reportPath, "--json");
    expect(recorded).toMatchObject({
      kind: "verification",
      status: "passed",
      provider: "human",
      summary: "manual review passed",
      report_path: "reports/verification.md",
    });

    await writeFile(
      reportPath,
      JSON.stringify({ nodeId: "verify-record", status: "unknown" }),
      "utf8",
    );
    await expectQdFailure(
      /status must be passed or failed/,
      "verification",
      "record",
      "--from-json",
      reportPath,
    );

    await expectQdFailure(
      /Node has no command verification entries/,
      "verification",
      "run",
      "verify-record",
    );
    await addLifecycleNode("verify-run", [
      "--verify",
      'type=command,value=node -e "process.exit(2)"',
    ]);
    await expectQdFailure(
      /No matching command verification/,
      "verification",
      "run",
      "verify-run",
      "--only",
      "missing",
    );
    const failedRun = await qdJsonAllowExit("verification", "run", "verify-run", "--json");
    expect(failedRun.exitCode).toBe(1);
    expect(failedRun.json).toMatchObject({ ok: false });
    expect(failedRun.json.runs[0]).toMatchObject({
      kind: "verification",
      status: "failed",
      exit_code: 2,
    });
  });

  it("stops advance at gate, check, policy, CI, and merge evidence boundaries", async () => {
    await qd("init");
    await qd("config", "set", "require_clean_worktree", "false");

    await addLifecycleNode("empty-ci");
    const emptyCi = await qdRaw(["advance", "empty-ci", "--summary", "done", "--json"]);
    expect(emptyCi.exitCode).toBe(1);
    expect(emptyCi.stderr).toMatch(/ci_command is empty/);

    await addLifecycleNode("gate-stop");
    await qd(
      "finding",
      "add",
      "gate-stop",
      "--severity",
      "P1",
      "--title",
      "blocking",
      "--evidence",
      "blocks advance",
    );
    const gateStop = await qdJsonAllowExit(
      "advance",
      "gate-stop",
      "--summary",
      "done",
      "--skip-ci",
      "--json",
    );
    expect(gateStop.exitCode).toBe(1);
    expect(gateStop.json).toMatchObject({ ok: false, stoppedAt: "gate" });

    await qd("config", "set", "check_command", 'node -e "process.exit(7)"');
    await addLifecycleNode("check-stop");
    const checkStop = await qdJsonAllowExit(
      "advance",
      "check-stop",
      "--summary",
      "done",
      "--skip-ci",
      "--json",
    );
    expect(checkStop.exitCode).toBe(7);
    expect(checkStop.json).toMatchObject({ ok: false, stoppedAt: "check" });

    await qd("config", "set", "check_command", 'node -e "process.exit(0)"');
    await qd("config", "set", "ci_command", 'node -e "process.exit(0)"');
    await addLifecycleNode("policy-stop");
    const policyStop = await qdJsonAllowExit(
      "advance",
      "policy-stop",
      "--summary",
      "done",
      "--json",
    );
    expect(policyStop.exitCode).toBe(1);
    expect(policyStop.json).toMatchObject({ ok: false, stoppedAt: "policy:ci" });

    await qd("config", "set", "policy_require_audit_before_ci", "false");
    await qd("config", "set", "policy_require_verification_before_ci", "false");
    await qd("config", "set", "ci_command", 'node -e "process.exit(5)"');
    await addLifecycleNode("ci-stop");
    const ciStop = await qdJsonAllowExit("advance", "ci-stop", "--summary", "done", "--json");
    expect(ciStop.exitCode).toBe(5);
    expect(ciStop.json).toMatchObject({ ok: false, stoppedAt: "ci" });

    await qd("config", "set", "ci_command", 'node -e "process.exit(0)"');
    await addLifecycleNode("merge-stop");
    const mergeReady = await qdJson("advance", "merge-stop", "--summary", "done", "--json");
    expect(mergeReady.nextAction).toMatch(/Perform the real git\/GitHub merge/);
    await expectQdFailure(/requires --use-existing-commit/, "advance", "merge-stop", "--merge");
    const merged = await qdJson(
      "advance",
      "merge-stop",
      "--merge",
      "--use-existing-commit",
      "abcdef123",
      "--json",
    );
    expect(merged).toMatchObject({ ok: true, stoppedAt: "done" });
    expect(merged.steps.map((step: { step: string }) => step.step)).toContain("merge");
  });
});
