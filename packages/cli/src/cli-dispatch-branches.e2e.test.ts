import { describe, expect, it } from "vite-plus/test";
import {
  expectQdFailure,
  installCliFixture,
  qd,
  qdJson,
  qdJsonAllowExit,
} from "./cli-e2e-fixtures.js";

installCliFixture();

describe("qd CLI dispatcher branches", () => {
  it("routes registry, milestone, plan, policy, analytics, and alias commands", async () => {
    expect(await qd("--version")).toMatch(/\d+\.\d+\.\d+/);
    expect(await qd("-v")).toMatch(/\d+\.\d+\.\d+/);
    expect(await qd("help", "policies")).toContain("qd policies");
    expect(await qd("node", "--help")).toContain("qd node");

    await qd("setup", "--no-hooks");
    await qd("config", "set", "check_command", 'node -e "process.exit(0)"');
    await qd("config", "set", "ci_command", 'node -e "process.exit(0)"');
    await qd("config", "set", "require_clean_worktree", "false");
    expect((await qdJson("group", "register", "--name", "runtime", "--json")).name).toBe("runtime");
    expect((await qdJson("project", "register", "--name", "app", "--json")).name).toBe("app");
    expect((await qdJson("group", "list", "--json"))[0].name).toBe("runtime");
    expect((await qdJson("project", "list", "--json"))[0].name).toBe("app");
    await expectQdFailure(/Unknown groups action/, "group", "delete");
    await expectQdFailure(/Unknown projects action/, "project", "delete");

    await qd("milestone", "register", "--name", "alpha", "--rank", "10");
    await qd("milestone", "register", "--name", "beta", "--rank", "20");
    await qd(
      "node",
      "add",
      "--id",
      "milestone-node",
      "--title",
      "Milestone Node",
      "--milestone",
      "alpha",
      "--spec",
      "Spec.",
      "--acceptance",
      "Acceptance.",
    );
    await qd(
      "node",
      "add",
      "--id",
      "next-node",
      "--title",
      "Next Node",
      "--milestone",
      "alpha",
      "--spec",
      "Spec.",
      "--acceptance",
      "Acceptance.",
    );
    await qd(
      "node",
      "add",
      "--id",
      "later-node",
      "--title",
      "Later Node",
      "--milestone",
      "alpha",
      "--spec",
      "Spec.",
      "--acceptance",
      "Acceptance.",
    );
    await qd(
      "node",
      "add",
      "--id",
      "done-node",
      "--title",
      "Done Node",
      "--milestone",
      "alpha",
      "--status",
      "done",
      "--spec",
      "Spec.",
      "--acceptance",
      "Acceptance.",
    );
    await qd(
      "node",
      "add",
      "--id",
      "blocked-node",
      "--title",
      "Blocked Node",
      "--milestone",
      "alpha",
      "--status",
      "blocked",
      "--blocked-by",
      "manual",
      "--blocked-reason",
      "Requires owner action.",
      "--spec",
      "Spec.",
      "--acceptance",
      "Acceptance.",
    );
    await qd(
      "node",
      "add",
      "--id",
      "beta-node",
      "--title",
      "Beta Node",
      "--milestone",
      "beta",
      "--spec",
      "Spec.",
      "--acceptance",
      "Acceptance.",
    );
    await qd(
      "finding",
      "add",
      "milestone-node",
      "--severity",
      "P1",
      "--title",
      "Blocker",
      "--evidence",
      "Blocks milestone.",
    );
    await qd(
      "finding",
      "add",
      "milestone-node",
      "--severity",
      "P2",
      "--title",
      "Follow up",
      "--evidence",
      "Nonblocking.",
    );
    await qd(
      "finding",
      "add",
      "beta-node",
      "--severity",
      "P1",
      "--title",
      "Beta blocker",
      "--evidence",
      "Other milestone.",
    );
    await qd("audit", "start", "milestone-node", "--kind", "acceptance");
    expect((await qdJson("milestone", "list", "--json"))[0].name).toBe("alpha");
    expect(await qdJson("milestone", "status", "alpha", "--json")).toHaveProperty("stats");
    expect(
      (await qdJson("milestone", "remaining", "alpha", "--json")).map(
        (node: { id: string }) => node.id,
      ),
    ).toEqual(["milestone-node", "next-node", "later-node", "blocked-node"]);
    const blockers = await qdJson("milestone", "blockers", "alpha", "--json");
    expect(blockers.findings.map((finding: { title: string }) => finding.title)).toEqual([
      "Blocker",
    ]);
    expect(blockers.runningAudits.map((run: { node_id: string }) => run.node_id)).toEqual([
      "milestone-node",
    ]);
    expect(blockers.blockedNodes.map((node: { id: string }) => node.id)).toEqual(["blocked-node"]);
    expect((await qdJson("milestone", "critical-path", "alpha", "--json")).milestone).toBe("alpha");
    expect(await qdJson("milestone", "next", "alpha", "--limit", "1", "--json")).toHaveLength(1);
    expect((await qdJson("milestone", "next", "alpha", "--limit", "1", "--json"))[0].id).toBe(
      "next-node",
    );
    await expectQdFailure(/Unknown milestone action/, "milestone", "delete", "alpha");

    expect((await qdJson("plan", "export", "--json")).nodes).toHaveLength(6);
    await expectQdFailure(/reserved/, "plan", "import");
    await expectQdFailure(/Unknown plan action/, "plan", "delete");
    const policy = await qdJsonAllowExit(
      "policy",
      "check",
      "milestone-node",
      "--phase",
      "ci",
      "--json",
    );
    expect(policy.exitCode).toBe(1);
    expect(policy.json.ok).toBe(false);
    await expectQdFailure(/Unknown policy action/, "policy", "unknown", "milestone-node");
    expect((await qdJson("velocity", "--json")).windowDays).toBe(7);
    expect((await qdJson("critical-path", "--milestone", "alpha", "--json")).milestone).toBe(
      "alpha",
    );
    expect((await qdJson("eta", "--milestone", "alpha", "--json")).milestone).toBe("alpha");
    expect(await qdJson("stats", "--milestone", "alpha", "--json")).toHaveProperty("stats");
    const gate = await qdJsonAllowExit("gate", "milestone-node", "--phase", "ci", "--json");
    expect(gate.exitCode).toBe(1);
    expect(gate.json.phase).toBe("ci");
    await expectQdFailure(
      /ci_provider is none/,
      "ci",
      "wait",
      "milestone-node",
      "--provider",
      "none",
    );
  });
});
