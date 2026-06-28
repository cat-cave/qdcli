import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addNode, initProject, type AddNodeInput } from "@cat-cave/qdcli-core";
import { describe, expect, it } from "vite-plus/test";
import {
  buildImportReport,
  enforceImportWritePreconditions,
  planEdges,
  planNodeEdges,
  planNodes,
  readNodeEdgeRefs,
  snapshotFromImportPlan,
  validateImportPlan,
} from "./import-command.js";
import {
  defaultImportMapping,
  type ImportMapping,
  type PlannedImportEdge,
} from "./import-mapping.js";
import {
  nodeInputFromOptions,
  nodeUpdateFromOptions,
  normalizeNodeInput,
  normalizeNodeUpdate,
  qdNodeFromInput,
  registriesFromNodes,
} from "./node-input.js";

describe("CLI import hardening", () => {
  it("plans nodes, edge arrays, nested node edges, and validation errors", () => {
    const mapping: ImportMapping = {
      ...defaultImportMapping,
      nodesPath: "items",
      id: "key",
      title: "name",
      spec: "summary",
      acceptance: "acceptance",
      nodeEdges: {
        path: "deps",
        edgeDirection: "deps-block-this-node",
        edgeType: "requires",
      },
      edgeFrom: "from",
      edgeTo: "to",
      edgeType: "type",
    };
    const report = buildImportReport(true, 2, 3);
    const plannedNodes = planNodes(
      [
        { key: "a", name: "Alpha", summary: "Spec A", acceptance: "Accept A", deps: ["b"] },
        { key: "b", name: "Beta", summary: "Spec B", acceptance: "Accept B", extra: true },
      ],
      mapping,
      report,
      false,
    );
    const plannedEdges: PlannedImportEdge[] = [];
    const seen = new Set<string>();
    planEdges(
      [
        { from: "a", to: "b", type: "related" },
        { from: "", to: "b" },
        { from: "a", to: "missing", type: "bad" },
      ],
      mapping,
      plannedEdges,
      report,
      seen,
    );
    planNodeEdges(plannedNodes, mapping, plannedEdges, report, seen);
    validateImportPlan(plannedNodes, plannedEdges, report);

    expect(report.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(report.droppedFields).toEqual([{ nodeId: "b", fields: ["extra"] }]);
    expect(report.edges).toContainEqual({
      from: "a",
      to: "b",
      type: "related",
      source: "edges",
    });
    expect(report.edges).toContainEqual({
      from: "b",
      to: "a",
      type: "requires",
      source: "nodeEdges:deps",
    });
    expect(report.errors).toEqual([
      "edges[1] must include from and to",
      "edge.type must be one of requires, unblocks, supersedes, related",
    ]);
  });

  it("detects duplicate ids, missing edge endpoints, cycles, and malformed node refs", () => {
    const report = buildImportReport(false, 0, 0);
    expect(report.errors).toEqual(["No nodes found at nodes"]);

    const validationReport = buildImportReport(false, 2, 2);
    validateImportPlan(
      [
        { sourceId: "a", input: nodeInput("a"), raw: { deps: ["b"] } },
        { sourceId: "a", input: nodeInput("a-duplicate"), raw: { deps: [] } },
      ],
      [
        { from: "a", to: "missing", type: "requires", source: "edges" },
        { from: "missing", to: "a", type: "requires", source: "edges" },
      ],
      validationReport,
    );
    expect(validationReport.errors).toEqual([
      "Import contains duplicate node ids",
      "edge references missing to node: missing",
      "edge references missing from node: missing",
      "requires edge cycle detected: a -> missing -> a",
    ]);

    const refsReport = buildImportReport(false, 1, 0);
    expect(
      readNodeEdgeRefs(
        { sourceId: "a", input: nodeInput("a"), raw: { deps: [" b ", 1] } },
        {
          ...defaultImportMapping,
          nodeEdges: { path: "deps", edgeDirection: "deps-block-this-node" },
        },
        refsReport,
      ),
    ).toEqual([]);
    expect(refsReport.errors).toEqual(["node a.nodeEdges must contain non-empty strings"]);
  });

  it("enforces import write preconditions and builds replacement snapshots", async () => {
    await withProject(async (root) => {
      const defaultsReport = buildImportReport(false, 1, 0);
      defaultsReport.defaults.push({
        nodeId: "a",
        field: "kind",
        value: "feature",
        reason: "missing kind",
      });
      await enforceImportWritePreconditions(root, defaultsReport, {
        dryRun: false,
        allowDefaults: false,
        merge: false,
      });
      expect(defaultsReport.errors).toEqual([
        "Import would use 1 defaulted field(s). Re-run with --allow-defaults if those defaults are intentional.",
      ]);

      await addNode(root, nodeInput("existing"));
      const nonEmptyReport = buildImportReport(false, 1, 0);
      await enforceImportWritePreconditions(root, nonEmptyReport, {
        dryRun: false,
        allowDefaults: true,
        merge: false,
      });
      expect(nonEmptyReport.errors).toEqual([
        "qd import requires an empty qd DAG. Run imports before creating nodes, use --merge for explicit sync semantics, or use --dry-run to inspect a mapping.",
      ]);

      const mergeReport = buildImportReport(false, 1, 0);
      await enforceImportWritePreconditions(root, mergeReport, {
        dryRun: false,
        allowDefaults: true,
        merge: true,
      });
      expect(mergeReport.errors).toEqual([]);
    });

    const snapshot = snapshotFromImportPlan(
      [{ sourceId: "runtime", input: nodeInput("runtime"), raw: {} }],
      [{ from: "runtime", to: "runtime-docs", type: "related", source: "edges" }],
    );
    expect(snapshot.nodes[0]).toMatchObject({ id: "runtime", status: "ready" });
    expect(snapshot.edges[0]).toMatchObject({
      from_node: "runtime",
      to_node: "runtime-docs",
      type: "related",
    });
    expect(snapshot.registries).toEqual({
      groups: [],
      projects: [],
      milestones: [],
    });
  });
});

describe("CLI node input hardening", () => {
  it("normalizes add inputs from camel and snake aliases with strict verification", () => {
    expect(
      normalizeNodeInput(
        {
          id: "alias-node",
          title: "Alias node",
          group_name: "runtime",
          estimate_points: 5,
          spec: "Spec",
          acceptance: "Acceptance",
          verification: ["type=command,value=just test", { type: "manual", value: "review" }],
          audit_focus: ["edges"],
          status_reason: "imported",
          check_command: "just check",
          ci_command: "just ci",
          blocked_by: "external",
          blocked_reason: "vendor",
          blocked_owner: "owner",
        },
        "node",
      ),
    ).toMatchObject({
      id: "alias-node",
      groupName: "runtime",
      estimatePoints: 5,
      verification: [
        { type: "command", value: "just test" },
        { type: "manual", value: "review" },
      ],
      auditFocus: ["edges"],
      statusReason: "imported",
      checkCommand: "just check",
      ciCommand: "just ci",
      blockedBy: "external",
      blockedReason: "vendor",
      blockedOwner: "owner",
    });

    expect(() =>
      normalizeNodeInput(
        { title: "Bad", spec: "Spec", acceptance: "Acceptance", verification: "manual" },
        "node",
      ),
    ).toThrow(/node.verification must be an array/);
    expect(() =>
      normalizeNodeInput(
        {
          title: "Bad",
          spec: "Spec",
          acceptance: "Acceptance",
          verification: [{ type: "script", value: "run" }],
        },
        "node",
      ),
    ).toThrow(/node.verification\[0\].type/);
  });

  it("normalizes updates without losing explicit nulls or blocker status defaults", () => {
    expect(
      normalizeNodeUpdate(
        {
          group: null,
          milestone: null,
          validation: null,
          verification: null,
          context: null,
          statusReason: null,
          checkCommand: null,
          ciCommand: null,
          branch: null,
          blockedBy: "manual",
          blockedReason: "needs owner",
          blockedOwner: null,
        },
        "patch",
      ),
    ).toMatchObject({
      group_name: null,
      milestone: null,
      validation: null,
      verification: [],
      context: null,
      status_reason: null,
      check_command: null,
      ci_command: null,
      branch: null,
      blocked_by: "manual",
      blocked_reason: "needs owner",
      blocked_owner: null,
      status: "blocked",
    });
    expect(() => normalizeNodeUpdate({ blocked_by: "policy" }, "patch")).toThrow(
      /blocked_reason is required/,
    );
  });

  it("builds node inputs and updates from files and CLI options", async () => {
    await withProject(async (root) => {
      await writeFile(path.join(root, "spec.md"), "Spec from file\n");
      await writeFile(path.join(root, "acceptance.md"), "Acceptance from file\n");
      await writeFile(
        path.join(root, "node.json"),
        `${JSON.stringify({
          title: "JSON node",
          spec: "JSON spec",
          acceptance: "JSON acceptance",
          projects: ["cli"],
        })}\n`,
      );
      await writeFile(
        path.join(root, "patch.json"),
        `${JSON.stringify({ title: "JSON patch", blocked_by: "manual", blocked_reason: "owner" })}\n`,
      );

      await expect(nodeInputFromOptions(root, { "from-json": "node.json" })).resolves.toMatchObject(
        {
          title: "JSON node",
          projects: ["cli"],
        },
      );
      await expect(
        nodeInputFromOptions(root, {
          id: "from-files",
          title: "From files",
          "spec-file": "spec.md",
          "acceptance-file": "acceptance.md",
          verify: ["type=url,value=https://example.test"],
          "audit-focus": ["imports"],
          "check-command": "just check",
          "ci-command": "just ci",
        }),
      ).resolves.toMatchObject({
        id: "from-files",
        spec: "Spec from file\n",
        acceptance: "Acceptance from file\n",
        verification: [{ type: "url", value: "https://example.test" }],
        auditFocus: ["imports"],
        checkCommand: "just check",
        ciCommand: "just ci",
      });

      await expect(
        nodeUpdateFromOptions(root, {
          "from-json": "patch.json",
          title: "CLI wins",
          project: ["core", "cli"],
          "clear-blocker": true,
        }),
      ).resolves.toMatchObject({
        title: "CLI wins",
        projects: ["core", "cli"],
        blocked_by: null,
        blocked_reason: null,
        blocked_owner: null,
      });
      await expect(nodeUpdateFromOptions(root, { "blocked-by": "manual" })).rejects.toThrow(
        /--blocked-reason is required/,
      );
    });
  });

  it("converts add input to snapshots and deterministic registries", () => {
    const now = "2026-06-28T00:00:00.000Z";
    const nodes = [
      qdNodeFromInput(
        {
          ...nodeInput("a"),
          groupName: "runtime",
          projects: ["cli", "core"],
          milestone: "m2",
        },
        "a",
        now,
      ),
      qdNodeFromInput(
        { ...nodeInput("b"), groupName: "runtime", projects: ["cli"], milestone: "m1" },
        "b",
        now,
      ),
    ];
    expect(nodes[0]).toMatchObject({
      id: "a",
      kind: "feature",
      priority: "P2",
      estimate_points: 1,
      risk: "medium",
      owner: null,
      blocked_by: null,
    });
    expect(registriesFromNodes(nodes, now)).toEqual({
      groups: [{ name: "runtime", created_at: now }],
      projects: [
        { name: "cli", created_at: now },
        { name: "core", created_at: now },
      ],
      milestones: [
        { name: "m1", rank: 1, created_at: now },
        { name: "m2", rank: 2, created_at: now },
      ],
    });
  });
});

async function withProject(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "qdcli-hardening-"));
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
