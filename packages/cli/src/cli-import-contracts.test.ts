import { describe, expect, it } from "vite-plus/test";
import type { ImportReport, PlannedImportEdge } from "./import-mapping.js";
import {
  defaultImportMapping,
  droppedTopLevelKeys,
  findImportCycle,
  mapImportNode,
  planImportEdge,
  usedNodeMappingKeys,
  validateNodeEdgesMapping,
} from "./import-mapping.js";

describe("CLI import mapping contracts", () => {
  it("maps imported nodes with strict defaults, folds, and typed fields", () => {
    const report = emptyImportReport();
    const node = mapImportNode(
      {
        key: "A-1",
        name: "Alpha",
        kind: "fix",
        state: "planned",
        priority: "P1",
        points: "3",
        risk: "high",
        group: "runtime",
        projects: ["app"],
        summary: "Implement alpha.",
        deliverables: ["CLI", "docs"],
        acceptanceCriteria: ["tests pass", "docs updated"],
        verification: [{ type: "manual", value: "owner sign-off" }],
        auditFocus: ["regressions"],
        context: "existing roadmap",
        statusReason: "imported",
        blockedBy: "manual",
        blockedReason: "owner action",
        blockedOwner: "trevor",
      },
      0,
      {
        id: "key",
        title: "name",
        status: "state",
        statusMap: { planned: "ready" },
        estimate: "points",
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
        blockedBy: "blockedBy",
        blockedReason: "blockedReason",
        blockedOwner: "blockedOwner",
      },
      report,
      false,
    );

    expect(node.input).toMatchObject({
      id: "A-1",
      title: "Alpha",
      kind: "fix",
      status: "ready",
      priority: "P1",
      estimatePoints: 3,
      risk: "high",
      groupName: "runtime",
      projects: ["app"],
      spec: "Implement alpha.\nDeliverables:\n- CLI\n- docs",
      acceptance: "- tests pass\n- docs updated",
      verification: [{ type: "manual", value: "owner sign-off" }],
      auditFocus: ["regressions"],
      context: "existing roadmap",
      statusReason: "imported",
      blockedBy: "manual",
      blockedReason: "owner action",
      blockedOwner: "trevor",
    });
    expect(report.defaults).toEqual([]);
  });

  it("fails import mapping mistakes before mutating the graph", () => {
    expect(() => mapImportNode({}, 0, defaultImportMapping, emptyImportReport(), false)).toThrow(
      /missing required id/,
    );
    expect(() =>
      mapImportNode(
        { id: "a", spec: "spec", acceptance: "acceptance", status: "unknown" },
        0,
        defaultImportMapping,
        emptyImportReport(),
        false,
      ),
    ).toThrow(/add statusMap/);
    expect(() =>
      mapImportNode(
        { id: "a", spec: "spec", acceptance: "acceptance", status: "planned" },
        0,
        { ...defaultImportMapping, statusMap: { planned: "bad" as never } },
        emptyImportReport(),
        false,
      ),
    ).toThrow(/statusMap\.planned/);
    expect(() =>
      mapImportNode(
        { id: "a", spec: ["not", "scalar"], acceptance: "acceptance" },
        0,
        defaultImportMapping,
        emptyImportReport(),
        false,
      ),
    ).toThrow(/must be a string/);
    expect(() =>
      mapImportNode(
        { id: "a", summary: { bad: true }, acceptance: "acceptance" },
        0,
        { ...defaultImportMapping, spec: { concat: ["summary"] } },
        emptyImportReport(),
        false,
      ),
    ).toThrow(/string or string array/);
    expect(() =>
      mapImportNode(
        { id: "a", spec: "spec", acceptance: "acceptance", estimate_points: 0 },
        0,
        defaultImportMapping,
        emptyImportReport(),
        false,
      ),
    ).toThrow(/positive integer/);
  });

  it("tracks import edges, cycles, used keys, and dropped fields deterministically", () => {
    const report = emptyImportReport();
    const planned: PlannedImportEdge[] = [];
    const seen = new Set<string>();
    planImportEdge(
      { from: "a", to: "b", type: "requires", source: "edge[0]" },
      planned,
      report,
      seen,
    );
    planImportEdge(
      { from: "a", to: "b", type: "requires", source: "edge[1]" },
      planned,
      report,
      seen,
    );
    planImportEdge(
      { from: "b", to: "b", type: "related", source: "edge[2]" },
      planned,
      report,
      seen,
    );
    expect(planned).toEqual([{ from: "a", to: "b", type: "requires", source: "edge[0]" }]);
    expect(report.edges).toEqual(planned);
    expect(report.warnings).toEqual(["duplicate edge skipped: a -> b (requires) from edge[1]"]);
    expect(report.errors).toEqual(["edge b -> b from edge[2] points to itself"]);

    expect(
      findImportCycle([
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ]),
    ).toBeNull();
    expect(
      findImportCycle([
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ]),
    ).toEqual(["a", "b", "a"]);
    expect(() =>
      validateNodeEdgesMapping({ path: "", edgeDirection: "deps-block-this-node" }),
    ).toThrow(/path/);
    expect(() =>
      validateNodeEdgesMapping({ path: "deps", edgeDirection: "backwards" as never }),
    ).toThrow(/edgeDirection/);

    const used = usedNodeMappingKeys({
      ...defaultImportMapping,
      spec: { concat: ["summary", "details.items"] },
      acceptance: "checks.acceptance",
      nodeEdges: { path: "deps.requires", edgeDirection: "deps-block-this-node" },
    });
    expect([...used].sort()).toContain("summary");
    expect([...used].sort()).toContain("details");
    expect([...used].sort()).toContain("checks");
    expect([...used].sort()).toContain("deps");
    expect(droppedTopLevelKeys({ id: "a", summary: "s", extra: true }, used)).toEqual(["extra"]);
    expect(droppedTopLevelKeys(null, used)).toEqual([]);
  });
});

function emptyImportReport(): ImportReport {
  return {
    ok: true,
    dryRun: false,
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
