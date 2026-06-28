import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  configureStrictDoctorCommands,
  expectQdFailure,
  installCliFixture,
  qd,
  qdJson,
  qdJsonAllowExit,
  qdRaw,
  root,
} from "./cli-e2e-fixtures.js";

installCliFixture();

describe("qd CLI reporting workflow surfaces", () => {
  it("exercises broad DAG, registry, reporting, and orchestration commands", async () => {
    expect(await qd("version")).toMatch(/\d+\.\d+\.\d+/);
    expect(await qd("help", "audits")).toContain("qd audits");
    const viewCheck = await qdRaw(["view", "--check", "--json"]);
    expect(`${viewCheck.stdout}\n${viewCheck.stderr}`).toMatch(/ok|viewer|assets/i);

    await qd("setup", "--no-hooks");
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

    expect((await qdJson("ready", "--json")).map((node: any) => node.id)).toEqual(["dependency"]);
    expect(await qd("node", "list", "--fields", "id,status", "--tsv")).toContain("dependency");
    expect((await qdJson("node", "show", "feature", "--summary", "--json")).blocked_by).toBeNull();
    expect((await qdJson("node", "show", "feature", "--full", "--json")).node.id).toBe("feature");
    await expectQdFailure(/unknown section/, "node", "show", "feature", "--include", "bogus");
    expect((await qdJson("graph", "--format", "json")).nodes).toHaveLength(2);
    expect(await qd("graph", "--format", "mermaid")).toContain("flowchart TD");
    expect(await qd("graph", "--format", "dot")).toContain("digraph qd");

    await qd(
      "node",
      "note",
      "feature",
      "--text",
      "Needs careful audit",
      "--kind",
      "operator-instruction",
    );
    await qd("note", "list", "feature", "--kind", "operator-instruction", "--json");
    await qd("edge", "list", "--json");
    await qd("edge", "remove", "dependency", "feature", "--json");
    expect((await qdJson("gate", "feature", "--json")).ok).toBe(true);
    await qd("edge", "add", "dependency", "feature", "--type", "requires", "--json");
    await qd(
      "finding",
      "add",
      "feature",
      "--severity",
      "P2",
      "--title",
      "Add follow-up",
      "--evidence",
      "Coverage can be expanded.",
      "--expected",
      "Follow-up coverage exists.",
      "--suggested-fix",
      "Mint a follow-up node.",
    );
    const blockingFinding = await qdJson(
      "finding",
      "add",
      "feature",
      "--severity",
      "P1",
      "--title",
      "Blocking issue",
      "--evidence",
      "A required behavior is missing.",
      "--json",
    );
    await expectQdFailure(
      /P0\/P1 findings must be resolved/,
      "finding",
      "promote",
      blockingFinding.id,
    );
    expect((await qdJson("finding", "resolve", blockingFinding.id, "--json")).status).toBe(
      "resolved",
    );
    expect((await qdJson("finding", "list", "--open", "--severity", "P2", "--json"))[0].title).toBe(
      "Add follow-up",
    );
    await qd(
      "finding",
      "add",
      "feature",
      "--severity",
      "P3",
      "--title",
      "Dismissible polish",
      "--evidence",
      "Minor polish exists.",
      "--json",
    );
    const dismissible = (
      await qdJson("finding", "list", "--open", "--severity", "P3", "--json")
    )[0];
    expect(
      (
        await qdJson(
          "finding",
          "dispose",
          dismissible.id,
          "--disposition",
          "accepted-risk",
          "--rationale",
          "acceptable for now",
          "--json",
        )
      ).status,
    ).toBe("dismissed");
    const promoted = await qdJson(
      "finding",
      "promote",
      (await qdJson("finding", "list", "--open", "--severity", "P2", "--json"))[0].id,
      "--json",
    );
    expect(promoted.node.kind).toBe("audit-fix");
    await qd(
      "finding",
      "add",
      "feature",
      "--severity",
      "P2",
      "--title",
      "Attach to existing",
      "--evidence",
      "Attach this to dependency.",
      "--json",
    );
    const attachable = (await qdJson("finding", "list", "--open", "--severity", "P2", "--json"))[0];
    expect(
      (
        await qdJson(
          "finding",
          "promote",
          attachable.id,
          "--node",
          "dependency",
          "--rationale",
          "tracked on dependency",
          "--json",
        )
      ).node.id,
    ).toBe("dependency");
    await qd(
      "node",
      "add",
      "--id",
      "aggregate-promote",
      "--title",
      "Aggregate promote",
      "--spec",
      "Promote non-blocking findings through the aggregate command.",
      "--acceptance",
      "The aggregate command mints follow-up nodes.",
    );
    await qd(
      "finding",
      "add",
      "aggregate-promote",
      "--severity",
      "P2",
      "--title",
      "Promote all polish",
      "--evidence",
      "Promote through aggregate command.",
      "--json",
    );
    expect(
      (await qdJson("promote-findings", "aggregate-promote", "--json")).promoted.length,
    ).toBeGreaterThan(0);

    const gate = await qdJsonAllowExit("gate", "feature", "--json");
    expect(gate.exitCode).toBe(1);
    expect(gate.json.explanations[0].code).toBe("blockedDependency");
    await expectQdFailure(
      /requires --log-path, --url, or --external-id/,
      "ci",
      "record-pass",
      "feature",
      "--summary",
      "bad",
    );

    expect((await qdJson("snapshot", "--json")).ready.map((node: any) => node.id)).toContain(
      "dependency",
    );
    expect(Object.keys(await qdJson("stats", "--json")).length).toBeGreaterThan(0);
    expect((await qdJson("velocity", "--json")).windowDays).toBe(7);
    expect(Object.keys(await qdJson("critical-path", "--json")).length).toBeGreaterThan(0);
    expect(Object.keys(await qdJson("eta", "--json")).length).toBeGreaterThan(0);
    expect(
      Object.keys(await qdJson("milestone", "status", "baseline", "--json")).length,
    ).toBeGreaterThan(0);
    expect((await qdJson("milestone", "remaining", "baseline", "--json")).length).toBeGreaterThan(
      0,
    );
    expect((await qdJson("milestone", "blockers", "baseline", "--json")).milestone).toBe(
      "baseline",
    );
    expect(
      Object.keys(await qdJson("milestone", "critical-path", "baseline", "--json")).length,
    ).toBeGreaterThan(0);
    expect(
      (await qdJson("milestone", "next", "baseline", "--json")).map((node: any) => node.id),
    ).toEqual(["dependency"]);
  });
});
