import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addNode, initProject, startRun, type AddNodeInput } from "@cat-cave/qdcli-core";
import { describe, expect, it } from "vite-plus/test";
import {
  auditTerminalStatus,
  findingStatusFromDisposition,
  importFindingsFromReport,
  selectedAuditRun,
} from "./audit.js";

describe("CLI audit hardening", () => {
  it("maps audit disposition and terminal action vocabulary exactly", () => {
    expect(findingStatusFromDisposition("accepted-risk")).toBe("dismissed");
    expect(findingStatusFromDisposition("dismissed")).toBe("dismissed");
    expect(findingStatusFromDisposition("resolved")).toBe("resolved");
    expect(findingStatusFromDisposition("follow-up-node")).toBe("promoted");
    expect(findingStatusFromDisposition("promoted")).toBe("promoted");
    expect(findingStatusFromDisposition("ignored")).toBeNull();

    expect(auditTerminalStatus("dispose")).toBe("cancelled");
    expect(auditTerminalStatus("cancel")).toBe("cancelled");
    expect(auditTerminalStatus("supersede")).toBe("superseded");
  });

  it("selects audit runs strictly and imports report findings with aliases", async () => {
    await withProject(async (root) => {
      await addNode(root, nodeInput("audit-node"));
      await addNode(root, nodeInput("other-node"));

      await expect(selectedAuditRun(root, "audit-node", {})).rejects.toThrow(/No running audit/);
      const run = await startRun(root, "audit-node", "audit");
      const implementRun = await startRun(root, "audit-node", "implement");
      await expect(selectedAuditRun(root, "other-node", { "run-id": run.id })).rejects.toThrow(
        /does not belong/,
      );
      await expect(
        selectedAuditRun(root, "audit-node", { "run-id": implementRun.id }),
      ).rejects.toThrow(/is not an audit run/);
      await expect(
        selectedAuditRun(root, "audit-node", { "run-id": run.id }),
      ).resolves.toMatchObject({ id: run.id });

      await startRun(root, "audit-node", "audit");
      await expect(selectedAuditRun(root, "audit-node", {})).rejects.toThrow(/Multiple running/);

      await writeFile(
        path.join(root, "audit-report.json"),
        `${JSON.stringify({
          node_id: "audit-node",
          findings: [
            {
              severity: "P2",
              title: "Alias finding",
              body: "Evidence from body.",
              path: "src/a.ts",
              line: "12",
              suggestedFix: "Tighten the branch.",
            },
          ],
        })}\n`,
      );
      await expect(
        importFindingsFromReport(root, "audit-report.json", undefined),
      ).resolves.toMatchObject({
        nodeId: "audit-node",
        importedFindings: 1,
        findings: [
          {
            severity: "P2",
            title: "Alias finding",
            evidence: "Evidence from body.",
            path: "src/a.ts",
            line: 12,
            suggested_fix: "Tighten the branch.",
          },
        ],
      });

      await writeFile(
        path.join(root, "empty-report.json"),
        '{"nodeId":"audit-node","findings":[]}',
      );
      await expect(importFindingsFromReport(root, "empty-report.json")).rejects.toThrow(
        /non-empty findings array/,
      );
      await expect(
        importFindingsFromReport(root, "empty-report.json", undefined, { allowEmpty: true }),
      ).resolves.toMatchObject({ importedFindings: 0 });
    });
  });
});

async function withProject(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "qdcli-audit-contracts-"));
  try {
    await initProject(root);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function nodeInput(id: string): AddNodeInput {
  return {
    id,
    title: `Node ${id}`,
    spec: `Spec ${id}`,
    acceptance: `Acceptance ${id}`,
  };
}
