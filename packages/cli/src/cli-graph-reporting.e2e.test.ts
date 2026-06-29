import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { expectQdFailure, installCliFixture, qd, qdJson, root } from "./cli-e2e-fixtures.js";

installCliFixture();

async function writeCompletionReport(id: string): Promise<string> {
  const reportPath = path.join(root, `${id}-completion.json`);
  await writeFile(
    reportPath,
    `${JSON.stringify({
      nodeId: id,
      summary: "ready for review",
      changedFiles: [`src/${id}.ts`],
      acceptanceEvidence: [
        { criterion: "Acceptance is proven.", status: "passed", evidence: "reports/acceptance.md" },
      ],
      commandsRun: [{ command: "just check", status: "passed", evidence: "logs/check.log" }],
      evidence: ["reports/completion.md"],
      realWorldValidation: {
        required: false,
        status: "not_required",
        evidence: "graph reporting fixture",
      },
      unverifiedItems: [],
      dagChangesNeeded: [],
    })}\n`,
    "utf8",
  );
  return reportPath;
}

describe("qd CLI graph reporting surfaces", () => {
  it("applies graph command selectors and validates command-specific branches", async () => {
    await qd("setup", "--no-hooks");
    await qd("method", "acknowledge", "--agent", "test");
    await qd("group", "register", "--name", "runtime");
    await qd("project", "register", "--name", "viewer");
    await qd("milestone", "register", "--name", "m1", "--rank", "10");
    await qd(
      "node",
      "add",
      "--id",
      "alpha",
      "--title",
      "Alpha",
      "--kind",
      "fix",
      "--priority",
      "P0",
      "--estimate",
      "3",
      "--group",
      "runtime",
      "--project",
      "viewer",
      "--milestone",
      "m1",
      "--spec",
      "Fix alpha.",
      "--acceptance",
      "Alpha is fixed.",
    );
    await qd(
      "node",
      "add",
      "--id",
      "beta",
      "--title",
      "Beta",
      "--kind",
      "feature",
      "--priority",
      "P2",
      "--estimate",
      "1",
      "--spec",
      "Build beta.",
      "--acceptance",
      "Beta is built.",
    );
    await qd("complete", "alpha", "--from-report", await writeCompletionReport("alpha"));
    expect((await qdJson("node", "cancel", "beta", "--json")).status).toBe("cancelled");
    expect(
      (
        await qdJson(
          "node",
          "edit",
          "beta",
          "--title",
          "Beta edited",
          "--spec",
          "Edited beta.",
          "--acceptance",
          "Beta edit is accepted.",
          "--json",
        )
      ).title,
    ).toBe("Beta edited");

    const filtered = (await qdJson(
      "node",
      "list",
      "--status",
      "review",
      "--priority",
      "P0",
      "--kind",
      "fix",
      "--milestone",
      "m1",
      "--project",
      "viewer",
      "--group",
      "runtime",
      "--limit",
      "1",
      "--json",
    )) as any[];
    expect(filtered.map((node) => node.id)).toEqual(["alpha"]);
    expect(await qd("node", "list", "--fields", "id,priority", "--tsv")).toContain("alpha\tP0");

    await qd("node", "note", "alpha", "--text", "Graph note", "--evidence", "ticket-1");
    await qd("note", "add", "alpha", "--text", "Risk accepted", "--kind", "risk-acceptance");
    expect(
      await qdJson("node", "note", "alpha", "--mode", "list", "--kind", "note", "--json"),
    ).toEqual([
      expect.objectContaining({
        text: "Graph note",
        evidence: "ticket-1",
      }),
    ]);
    expect(
      (await qdJson("note", "list", "alpha", "--kind", "risk-acceptance", "--json"))[0].kind,
    ).toBe("risk-acceptance");
    await qd(
      "finding",
      "add",
      "alpha",
      "--severity",
      "P2",
      "--title",
      "Alpha finding",
      "--evidence",
      "alpha evidence",
    );
    await qd(
      "finding",
      "add",
      "beta",
      "--severity",
      "P2",
      "--title",
      "Beta finding",
      "--evidence",
      "beta evidence",
    );
    await qd("audit", "start", "alpha", "--kind", "acceptance");
    const included = await qdJson(
      "node",
      "show",
      "alpha",
      "--include",
      " findings , notes ",
      "--json",
    );
    expect(included).toHaveProperty("node.id", "alpha");
    expect(included.findings.map((item: any) => item.node_id)).toEqual(["alpha"]);
    expect(included.notes.map((item: any) => item.kind)).toEqual(["note", "risk-acceptance"]);
    expect(included).not.toHaveProperty("runs");
    const auditOnly = await qdJson("node", "show", "alpha", "--include", "audits", "--json");
    expect(auditOnly.audits.map((item: any) => item.kind)).toEqual(["audit"]);
    expect(auditOnly).not.toHaveProperty("runs");
    expect(await qdJson("node", "show", "alpha", "--no-big-text", "--json")).not.toHaveProperty(
      "spec",
    );
    expect(await qdJson("node", "show", "alpha", "--json")).toHaveProperty("spec", "Fix alpha.");

    await writeFile(
      path.join(root, "array-nodes.json"),
      `${JSON.stringify([
        {
          id: "array-node",
          title: "Array Node",
          spec: "Import an array node.",
          acceptance: "Array import succeeds.",
        },
      ])}\n`,
      "utf8",
    );
    expect(
      (await qdJson("nodes", "add-bulk", "--from-json", "array-nodes.json", "--json")).nodes,
    ).toHaveLength(1);
    await qd(
      "node",
      "add",
      "--id",
      "no-hook-node",
      "--title",
      "No Hook Node",
      "--spec",
      "Claim without hooks.",
      "--acceptance",
      "The no-hooks flag skips configured hooks.",
    );

    await writeFile(
      path.join(root, "bad-bulk.json"),
      `${JSON.stringify({ nodes: [], edges: {} })}\n`,
      "utf8",
    );
    await expectQdFailure(
      /edges must be an array/,
      "nodes",
      "add-bulk",
      "--from-json",
      "bad-bulk.json",
    );
    expect((await qdJson("edge", "add", "alpha", "array-node", "--json")).type).toBe("requires");
    expect(await qdJson("edge", "remove", "alpha", "array-node", "--json")).toEqual({ ok: true });
    expect((await qdJson("edge", "--json")).map((item: any) => item.from_node)).not.toContain(
      "alpha",
    );

    await qd(
      "config",
      "set",
      "hooks_pre_claim",
      "printf 'pre:%s:%s\\n' {node} {root} >> hooks.log",
    );
    await qd(
      "config",
      "set",
      "hooks_post_claim",
      "printf 'post:%s:%s\\n' {node} {branch} >> hooks.log",
    );
    await qd("claim", "array-node", "--agent", "worker", "--branch", "work/array-node", "--json");
    expect(await readFile(path.join(root, "hooks.log"), "utf8")).toMatch(
      /pre:array-node:.+\npost:array-node:work\/array-node\n/,
    );
    await qd("config", "set", "hooks_pre_claim", "exit 3");
    await qd("claim", "no-hook-node", "--agent", "worker", "--no-hooks", "--json");

    await expectQdFailure(/Unknown nodes action/, "nodes", "remove");
    await expectQdFailure(/Unknown node action/, "node", "missing-action");
    await expectQdFailure(/Unknown note action/, "note", "remove", "alpha");
    await expectQdFailure(/Unknown edge action/, "edge", "missing-action");
  });
});
