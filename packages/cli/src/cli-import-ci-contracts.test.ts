import { describe, expect, it } from "vite-plus/test";
import { addNode, setupProject, startRun } from "@cat-cave/qdcli-core";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ciEvidence,
  ciProviderError,
  githubCiPollingOptions,
  githubCiTerminalResult,
  githubRunListArgs,
  latestMergeCommitSha,
  parseGitHubRunList,
} from "./ci.js";
import {
  defaultImportMapping,
  droppedTopLevelKeys,
  findImportCycle,
  mapImportNode,
  planImportEdge,
  usedNodeMappingKeys,
  validateNodeEdgesMapping,
  type ImportReport,
  type PlannedImportEdge,
} from "./import-mapping.js";

function report(): ImportReport {
  return {
    ok: true,
    dryRun: true,
    nodesFound: 0,
    edgesFound: 0,
    importedNodes: 0,
    importedEdges: 0,
    defaults: [],
    droppedFields: [],
    warnings: [],
    errors: [],
    nodes: [],
    edges: [],
  };
}

describe("import mapping and CI helper contracts", () => {
  it("maps node fields, defaults, status maps, folds, and typed failures", () => {
    const base = {
      id: "node-a",
      spec: "Spec.",
      acceptance: "Acceptance.",
      summary: "Summary.",
      deliverables: ["One", "Two", " "],
      acceptanceCriteria: ["Done"],
      status: "planned",
      priority: "P1",
      risk: "high",
      estimate_points: "3",
      projects: ["cli"],
    };
    const mappedReport = report();
    const mapped = mapImportNode(
      base,
      0,
      {
        ...defaultImportMapping,
        title: "missing_title",
        spec: {
          concat: ["summary", "deliverables"],
          separator: "\n- ",
          preamble: { deliverables: "\nDeliverables:\n- " },
        },
        acceptance: {
          concat: ["acceptanceCriteria"],
          separator: "\n- ",
          preamble: { acceptanceCriteria: "- " },
        },
        statusMap: { planned: "ready" },
      },
      mappedReport,
      false,
    );
    expect(mapped.input).toMatchObject({
      id: "node-a",
      title: "node-a",
      status: "ready",
      priority: "P1",
      risk: "high",
      estimatePoints: 3,
      projects: ["cli"],
      spec: "Summary.\nDeliverables:\n- One\n- Two",
      acceptance: "- Done",
    });
    expect(mappedReport.defaults).toContainEqual({
      nodeId: "node-a",
      field: "title",
      value: "node-a",
      reason: "missing missing_title",
    });

    expect(() =>
      mapImportNode({ ...base, id: "" }, 1, defaultImportMapping, report(), false),
    ).toThrow(/missing required id/);
    expect(() =>
      mapImportNode({ ...base, status: "custom" }, 1, defaultImportMapping, report(), false),
    ).toThrow(/unknown status/);
    expect(() =>
      mapImportNode(
        { ...base, status: "custom" },
        1,
        { ...defaultImportMapping, statusMap: { custom: "bad" as never } },
        report(),
        false,
      ),
    ).toThrow(/statusMap.custom/);
    expect(() =>
      mapImportNode(
        { ...base, status: "ready", kind: "bad" },
        1,
        defaultImportMapping,
        report(),
        false,
      ),
    ).toThrow(/kind "bad"/);
    expect(() =>
      mapImportNode(
        { ...base, status: "ready", estimate_points: "0" },
        1,
        defaultImportMapping,
        report(),
        false,
      ),
    ).toThrow(/positive integer/);
    expect(() =>
      mapImportNode(
        { ...base, status: "ready", spec: ["bad"] },
        1,
        { ...defaultImportMapping, spec: "spec" },
        report(),
        false,
      ),
    ).toThrow(/must be a string or use a fold descriptor/);
    expect(() =>
      mapImportNode(
        { ...base, status: "ready", spec: { nested: true } },
        1,
        { ...defaultImportMapping, spec: { concat: ["spec"] } },
        report(),
        false,
      ),
    ).toThrow(/spec must be a string or string array/);
    expect(() =>
      mapImportNode(
        { ...base, status: "ready" },
        1,
        { ...defaultImportMapping, spec: { concat: [] } },
        report(),
        false,
      ),
    ).toThrow(/non-empty concat/);
    expect(() =>
      mapImportNode(
        { ...base, status: "ready", acceptance: " " },
        1,
        defaultImportMapping,
        report(),
        false,
      ),
    ).toThrow(/mapped acceptance is required/);
    expect(() =>
      mapImportNode(
        { ...base, status: "ready", summary: " ", deliverables: [" "] },
        1,
        { ...defaultImportMapping, spec: { concat: ["summary", "deliverables"] } },
        report(),
        false,
      ),
    ).toThrow(/mapped spec is required/);
  });

  it("tracks import mapping keys, duplicate edges, cycles, and node-edge validation", () => {
    expect(() =>
      validateNodeEdgesMapping({ path: "", edgeDirection: "deps-block-this-node" }),
    ).toThrow(/path is required/);
    expect(() => validateNodeEdgesMapping({ path: "deps", edgeDirection: "bad" as never })).toThrow(
      /edgeDirection/,
    );
    expect(
      Array.from(
        usedNodeMappingKeys({
          ...defaultImportMapping,
          spec: { concat: ["summary", "details.items"] },
          acceptance: "acceptance.text",
          projects: "areas.names",
          nodeEdges: { path: "deps.ids", edgeDirection: "deps-block-this-node" },
        }),
      ).sort(),
    ).toContain("details");
    expect(
      Array.from(
        usedNodeMappingKeys({
          ...defaultImportMapping,
          projects: "areas.names",
        }),
      ),
    ).toContain("areas");
    expect(droppedTopLevelKeys({ z: 1, a: 2, b: 3 }, new Set(["b"]))).toEqual(["a", "z"]);
    expect(droppedTopLevelKeys(null, new Set())).toEqual([]);

    const edges: PlannedImportEdge[] = [];
    const warningsReport = report();
    const seen = new Set<string>();
    planImportEdge(
      { from: "a", to: "a", type: "requires", source: "self" },
      edges,
      warningsReport,
      seen,
    );
    planImportEdge(
      { from: "a", to: "b", type: "requires", source: "one" },
      edges,
      warningsReport,
      seen,
    );
    planImportEdge(
      { from: "a", to: "b", type: "requires", source: "two" },
      edges,
      warningsReport,
      seen,
    );
    expect(edges).toEqual([{ from: "a", to: "b", type: "requires", source: "one" }]);
    expect(warningsReport.errors).toEqual(["edge a -> a from self points to itself"]);
    expect(warningsReport.warnings).toEqual(["duplicate edge skipped: a -> b (requires) from two"]);
    expect(
      findImportCycle([
        { from: "x", to: "y" },
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ]),
    ).toEqual(["a", "b", "c", "a"]);
    expect(
      findImportCycle([
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ]),
    ).toBeNull();
  });

  it("validates GitHub CI polling configuration and run payloads", () => {
    expect(ciProviderError("github")).toBeNull();
    expect(ciProviderError("none")).toMatch(/ci_provider is none/);
    expect(ciProviderError("gitlab")).toBe("Unsupported CI provider: gitlab");
    expect(
      githubCiPollingOptions(
        { ciRepo: " cat-cave/qdcli ", ciWorkflow: " ci.yml ", ciAuth: "gh-cli" },
        { interval: "2", timeout: "9" },
      ),
    ).toEqual({
      repo: "cat-cave/qdcli",
      workflow: "ci.yml",
      auth: "gh-cli",
      intervalSeconds: 2,
      timeoutSeconds: 9,
    });
    expect(() =>
      githubCiPollingOptions({ ciRepo: " ", ciWorkflow: "ci.yml", ciAuth: "gh-cli" }, {}),
    ).toThrow(/--repo/);
    expect(() =>
      githubCiPollingOptions({ ciRepo: "cat-cave/qdcli", ciWorkflow: " ", ciAuth: "gh-cli" }, {}),
    ).toThrow(/--workflow/);
    expect(() =>
      githubCiPollingOptions(
        { ciRepo: "cat-cave/qdcli", ciWorkflow: "ci.yml", ciAuth: "gh-cli" },
        { auth: "token" },
      ),
    ).toThrow(/--auth gh-cli/);
    expect(() =>
      githubCiPollingOptions(
        { ciRepo: "cat-cave/qdcli", ciWorkflow: "ci.yml", ciAuth: "gh-cli" },
        { interval: "0" },
      ),
    ).toThrow(/--interval/);
    expect(() =>
      githubCiPollingOptions(
        { ciRepo: "cat-cave/qdcli", ciWorkflow: "ci.yml", ciAuth: "gh-cli" },
        { timeout: "0" },
      ),
    ).toThrow(/--timeout/);

    expect(githubRunListArgs("cat-cave/qdcli", "ci.yml", "abc1234")).toEqual([
      "run",
      "list",
      "--repo",
      "cat-cave/qdcli",
      "--workflow",
      "ci.yml",
      "--commit",
      "abc1234",
      "--limit",
      "1",
      "--json",
      "databaseId,status,conclusion,url,headSha,name,displayTitle",
    ]);
    expect(parseGitHubRunList("")).toBeNull();
    expect(parseGitHubRunList('[{"databaseId":12,"status":"completed"}]')).toEqual({
      databaseId: 12,
      status: "completed",
    });
    expect(() => parseGitHubRunList('{"databaseId":12}')).toThrow(/non-array/);
    expect(githubCiTerminalResult(null, "abc1234")).toBeNull();
    expect(githubCiTerminalResult({ status: "in_progress" }, "abc1234")).toBeNull();
    expect(
      githubCiTerminalResult(
        { status: "completed", conclusion: "success", url: "https://ci.test/run" },
        "abc1234",
      ),
    ).toEqual({ ok: true, summary: "GitHub CI passed: https://ci.test/run" });
    expect(githubCiTerminalResult({ conclusion: "failure", databaseId: 99 }, "abc1234")).toEqual({
      ok: false,
      summary: "GitHub CI failed (failure): 99",
    });
    expect(githubCiTerminalResult({ status: "completed" }, "abc1234")).toEqual({
      ok: false,
      summary: "GitHub CI completed without a conclusion for abc1234",
    });
  });

  it("requires CI evidence and can read recorded merge commit SHAs", async () => {
    expect(() => ciEvidence({})).toThrow(/requires --log-path/);
    expect(ciEvidence({ "log-path": "logs/ci.log" })).toEqual({
      summary: "Evidence: log_path=logs/ci.log",
      logPath: "logs/ci.log",
    });
    expect(ciEvidence({ url: "https://ci.test/run", "external-id": "run-1" })).toEqual({
      summary: "Evidence: url=https://ci.test/run, external_id=run-1",
      logPath: undefined,
    });

    const root = await mkdtemp(path.join(os.tmpdir(), "qdcli-ci-contracts-"));
    try {
      await setupProject(root);
      await addNode(root, {
        id: "ci-node",
        title: "CI node",
        spec: "Spec.",
        acceptance: "Acceptance.",
      });
      expect(await latestMergeCommitSha(root, "ci-node")).toBeNull();
      await startRun(root, "ci-node", "merge", { summary: "Recorded merge abc1234def5678" });
      expect(await latestMergeCommitSha(root, "ci-node")).toBe("abc1234def5678");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
