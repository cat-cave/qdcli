import { describe, expect, it } from "vite-plus/test";
import { defaultConfig, type GraphSnapshot, type QdConfig } from "@cat-cave/qdcli-core";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { __testing } from "./index.js";

describe("CLI internals", () => {
  it("recognizes symlinked package-manager bin entrypoints", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qdcli-entrypoint-"));
    try {
      const realBin = path.join(root, "dist", "index.mjs");
      const linkedBin = path.join(root, "node_modules", ".bin", "qd");
      await mkdir(path.dirname(realBin), { recursive: true });
      await mkdir(path.dirname(linkedBin), { recursive: true });
      await writeFile(realBin, "#!/usr/bin/env node\n");
      await symlink(realBin, linkedBin);

      expect(__testing.isCliEntrypoint(linkedBin, realBin)).toBe(true);
      expect(__testing.isCliEntrypoint(undefined, realBin)).toBe(false);
      expect(__testing.isCliEntrypoint(path.join(root, "missing"), realBin)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("parses command arguments, inline values, booleans, and repeatable options strictly", () => {
    expect(
      __testing.parseArgs([
        "node",
        "add",
        "--id=alpha",
        "--project",
        "app",
        "--project=cli",
        "--json",
        "--verify",
        "type=command,value=just check",
      ]),
    ).toEqual({
      command: ["node", "add"],
      options: {
        id: "alpha",
        project: ["app", "cli"],
        json: true,
        verify: ["type=command,value=just check"],
      },
    });

    expect(() => __testing.parseArgs(["node", "add", "--title", "A", "--title", "B"])).toThrow(
      /cannot be repeated/,
    );
    expect(() => __testing.parseArgs(["--"])).toThrow(/option name is required/);
  });

  it("sets and gets config aliases without silent coercion", () => {
    const base = defaultConfig;
    const cases: Array<[string, string, keyof QdConfig, unknown]> = [
      ["check-command", "just check", "checkCommand", "just check"],
      ["ci_command", "just ci", "ciCommand", "just ci"],
      ["ci-repo", "cat-cave/qdcli", "ciRepo", "cat-cave/qdcli"],
      ["ci_workflow", "ci.yml", "ciWorkflow", "ci.yml"],
      ["skills-dir", ".qd/custom-skills", "skillsDir", ".qd/custom-skills"],
      ["merge-strategy", "rebase", "mergeStrategy", "rebase"],
      ["require-clean-worktree", "false", "requireCleanWorktree", false],
      ["require_gate_before_ci", "false", "requireGateBeforeCi", false],
      ["require-ci-before-merge", "false", "requireCiBeforeMerge", false],
      ["export-default-out", "roadmap/qd.json", "exportDefaultOut", "roadmap/qd.json"],
      ["export_canonicalize_command", "just fmt", "exportCanonicalizeCommand", "just fmt"],
      ["check-timeout-seconds", "30", "checkTimeoutSeconds", 30],
      ["check_no_output_timeout_seconds", "31", "checkNoOutputTimeoutSeconds", 31],
      ["ci-timeout-seconds", "32", "ciTimeoutSeconds", 32],
      ["ci_no_output_timeout_seconds", "33", "ciNoOutputTimeoutSeconds", 33],
    ];

    for (const [key, value, field, expected] of cases) {
      const next = __testing.setConfigValue(base, key, value);
      expect(next[field]).toEqual(expected);
      expect(__testing.getConfigValue(next, key)).toEqual(expected);
    }

    const cleanExcept = __testing.setConfigValue(base, "clean-worktree-except", ".qd/, roadmap/ ,");
    expect(cleanExcept.cleanWorktreeExcept).toEqual([".qd/", "roadmap/"]);
    expect(__testing.getConfigValue(cleanExcept, "clean_worktree_except")).toEqual([
      ".qd/",
      "roadmap/",
    ]);

    const hookConfig = __testing.setConfigValue(base, "hooks-post-export", "just qd-export");
    expect(hookConfig.hooks.postExport).toBe("just qd-export");
    expect(__testing.getConfigValue(hookConfig, "hooks_post_export")).toBe("just qd-export");

    const policyConfig = __testing.setConfigValue(
      base,
      "policy-require-p2-p3-disposition-before-merge",
      "false",
    );
    expect(policyConfig.policy.requireP2P3DispositionBeforeMerge).toBe(false);
    expect(
      __testing.getConfigValue(policyConfig, "policy_require_p2_p3_disposition_before_merge"),
    ).toBe(false);

    const worktreeConfig = __testing.setConfigValue(base, "worktree-env-file", ".env.worker");
    expect(worktreeConfig.worktree.envFile).toBe(".env.worker");
    expect(__testing.getConfigValue(worktreeConfig, "worktree_env_file")).toBe(".env.worker");

    expect(() => __testing.setConfigValue(base, "merge-strategy", "fast-forward")).toThrow(
      /merge_strategy/,
    );
    expect(() => __testing.setConfigValue(base, "require-clean-worktree", "maybe")).toThrow(
      /true or false/,
    );
    expect(() => __testing.setConfigValue(base, "check-timeout-seconds", "0")).toThrow(
      /positive integer/,
    );
    expect(() => __testing.setConfigValue(base, "ci-auth", "token")).toThrow(/ci_auth/);
    expect(() => __testing.setConfigValue(base, "hooks-magic", "no")).toThrow(/Unknown config key/);
    expect(() => __testing.getConfigValue(base, "missing")).toThrow(/Unknown config key/);
  });

  it("sets GitHub CI provider config explicitly", () => {
    expect(
      __testing.setCiProviderConfig(defaultConfig, "github", {
        repo: "cat-cave/qdcli",
        workflow: "ci.yml",
        auth: "gh-cli",
      }),
    ).toMatchObject({
      ciProvider: "github",
      ciRepo: "cat-cave/qdcli",
      ciWorkflow: "ci.yml",
      ciAuth: "gh-cli",
    });

    expect(__testing.setCiProviderConfig(defaultConfig, "none", {})).toMatchObject({
      ciProvider: "none",
      ciRepo: "",
      ciWorkflow: "",
      ciAuth: "gh-cli",
    });
    expect(() => __testing.setCiProviderConfig(defaultConfig, "github", {})).toThrow(/--repo/);
    expect(() =>
      __testing.setCiProviderConfig(defaultConfig, "github", {
        repo: "cat-cave/qdcli",
        workflow: "ci.yml",
        auth: "token",
      }),
    ).toThrow(/--auth/);
    expect(() => __testing.setCiProviderConfig(defaultConfig, "jenkins", {})).toThrow(
      /ci_provider/,
    );
  });

  it("parses scalar helpers strictly", () => {
    expect(__testing.parseBoolean("true", "flag")).toBe(true);
    expect(__testing.parseBoolean("false", "flag")).toBe(false);
    expect(() => __testing.parseBoolean("yes", "flag")).toThrow(/true or false/);
    expect(__testing.parsePositiveInteger("7", "limit")).toBe(7);
    expect(() => __testing.parsePositiveInteger("1.5", "limit")).toThrow(/positive integer/);
  });

  it("parses list and verification helpers strictly", () => {
    expect(__testing.parseSeverityList("P0,P2")).toEqual(["P0", "P2"]);
    expect(__testing.parseSeverityList(["P1", "P3"])).toEqual(["P1", "P3"]);
    expect(__testing.parseSeverityList(undefined)).toBeUndefined();
    expect(() => __testing.parseSeverityList("P4")).toThrow(/--severity/);

    expect(__testing.parseStatusList("ready,review")).toEqual(["ready", "review"]);
    expect(__testing.parseStatusList(["blocked", "done"])).toEqual(["blocked", "done"]);
    expect(__testing.parseStatusList(undefined)).toBeUndefined();
    expect(() => __testing.parseStatusList("waiting")).toThrow(/--status/);

    expect(__testing.parseNoteKindList("note,risk-acceptance")).toEqual([
      "note",
      "risk-acceptance",
    ]);
    expect(__testing.parseNoteKindList(undefined)).toBeUndefined();
    expect(() => __testing.parseNoteKindList("memo")).toThrow(/--kind/);

    expect(__testing.parseVerification("type=command,value=just ci")).toEqual({
      type: "command",
      value: "just ci",
    });
    expect(__testing.parseVerification("owner review")).toEqual({
      type: "manual",
      value: "owner review",
    });
    expect(() => __testing.parseVerification("type=magic,value=x")).toThrow(
      /Unknown verification type/,
    );
  });

  it("reads import mapping paths and typed arrays without coercion", () => {
    const source = {
      node: {
        title: "Alpha",
        points: "3",
        tags: ["app", "runtime"],
        empty: "   ",
        verification: ["type=command,value=just test", { type: "manual", value: "owner sign-off" }],
      },
    };

    expect(__testing.strictArrayAtPath(source, "node.tags", true)).toEqual(["app", "runtime"]);
    expect(__testing.strictArrayAtPath(source, "node.missing", false)).toEqual([]);
    expect(() => __testing.strictArrayAtPath(source, "node.title", true)).toThrow(/array/);
    expect(() => __testing.strictArrayAtPath(source, "node.missing", true)).toThrow(/array/);

    expect(__testing.stringAt(source, "node.title")).toBe("Alpha");
    expect(__testing.stringAt(source, "node.points")).toBe("3");
    expect(__testing.numberAt(source, "node.points")).toBe(3);
    expect(__testing.numberAt({ value: "nope" }, "value")).toBeUndefined();
    expect(__testing.strictStringArrayAt(source, "node.tags", "projects")).toEqual([
      "app",
      "runtime",
    ]);
    expect(__testing.strictStringArrayAt(source, "node.empty", "projects")).toEqual([]);
    expect(() => __testing.strictStringArrayAt({ tags: [1] }, "tags", "projects")).toThrow(
      /tags\[0\]/,
    );
    expect(
      __testing.strictVerificationArrayAt(source, "node.verification", "verification"),
    ).toEqual([
      { type: "command", value: "just test" },
      { type: "manual", value: "owner sign-off" },
    ]);
    expect(() =>
      __testing.strictVerificationArrayAt(
        { verification: [{ type: "manual" }] },
        "verification",
        "verification",
      ),
    ).toThrow(/value is required/);
  });

  it("formats rows, cells, and next actions predictably", () => {
    const rows = [
      {
        id: "b",
        title: "B",
        status: "review",
        priority: "P1",
        milestone: "alpha",
        nested: { ok: true },
      },
      { id: "a", title: "A", status: "ready", priority: "P2", milestone: null, nested: null },
    ];
    expect(__testing.formatRows(rows, { fields: "id,status", tsv: true })).toBe(
      "id\tstatus\nb\treview\na\tready",
    );
    expect(__testing.formatRows(rows, { compact: true })).toEqual([
      { id: "b", title: "B", status: "review", priority: "P1", milestone: "alpha" },
      { id: "a", title: "A", status: "ready", priority: "P2", milestone: null },
    ]);
    expect(__testing.formatRows(rows, { fields: "id,missing" })).toEqual([
      { id: "b", missing: null },
      { id: "a", missing: null },
    ]);
    expect(__testing.formatCell(null)).toBe("");
    expect(__testing.formatCell(true)).toBe("true");
    expect(__testing.formatCell({ ok: true })).toBe('{"ok":true}');

    const [node] = snapshotFixture([
      { id: "action", status: "blocked", milestone: "alpha", title: "Action" },
    ]).nodes;
    const cleanGate = {
      ok: true,
      blocking: [],
      runningAudits: [],
      blockedDependencies: [],
      explanations: [],
    } as any;
    expect(
      __testing.nextStepForNode(
        node!,
        { ...cleanGate, blocking: [{ id: "finding-1" }] } as any,
        null,
        null,
      ),
    ).toBe("qd finding resolve finding-1");
    expect(
      __testing.nextStepForNode(
        node!,
        { ...cleanGate, runningAudits: [{ id: "run-1" }] } as any,
        null,
        null,
      ),
    ).toBe("qd audit pass action --run-id run-1 --from-report <audit-report.json>");
    expect(
      __testing.nextStepForNode(node!, cleanGate, { id: "check-1", status: "passed" } as any, null),
    ).toBe('qd unblock action --from-run check-1 --summary "<why it is unblocked>"');
    expect(
      __testing.nextStepForNode({ ...node!, status: "mergeable" }, cleanGate, null, {
        id: "ci-1",
        status: "passed",
      } as any),
    ).toBeNull();
  });

  it("filters snapshots and reports deterministic node diffs", () => {
    const live = snapshotFixture([
      { id: "a", status: "ready", milestone: "alpha", title: "A" },
      { id: "b", status: "review", milestone: "alpha", title: "B" },
      { id: "c", status: "done", milestone: "beta", title: "C" },
    ]);
    live.edges.push({
      from_node: "a",
      to_node: "b",
      type: "requires",
      created_at: "2026-06-20T00:00:00.000Z",
    });
    live.assignments.push({
      id: "assignment-1",
      node_id: "b",
      role: "worker",
      owner: "agent",
      branch: null,
      worktree_path: null,
      scope: null,
      status: "open",
      commits_json: "[]",
      evidence_json: "[]",
      summary: null,
      started_at: "2026-06-20T00:00:00.000Z",
      finished_at: null,
    });
    live.wave_memberships.push({
      wave_id: "wave-1",
      node_id: null,
      assignment_id: "assignment-1",
      created_at: "2026-06-20T00:00:00.000Z",
    });

    const filtered = __testing.filterSnapshot(live, {
      statuses: ["review"],
      milestone: "alpha",
    });
    expect(filtered.nodes.map((node) => node.id)).toEqual(["b"]);
    expect(filtered.edges).toEqual([]);
    expect(filtered.assignments.map((assignment) => assignment.id)).toEqual(["assignment-1"]);
    expect(filtered.wave_memberships).toHaveLength(1);

    expect(__testing.filterSnapshot(live, {})).toBe(live);

    const exported = snapshotFixture([
      { id: "b", status: "review", milestone: "alpha", title: "B changed" },
      { id: "d", status: "ready", milestone: "alpha", title: "D" },
    ]);
    expect(__testing.snapshotDiff(live, exported)).toEqual({
      ok: false,
      liveOnlyNodes: ["a", "c"],
      exportOnlyNodes: ["d"],
      changedNodes: ["b"],
      liveNodeCount: 3,
      exportNodeCount: 2,
    });
  });
});

function snapshotFixture(
  nodes: Array<{
    id: string;
    title: string;
    status: GraphSnapshot["nodes"][number]["status"];
    milestone: string;
  }>,
): GraphSnapshot {
  return {
    schema_version: 1,
    exported_at: "2026-06-20T00:00:00.000Z",
    registries: {
      groups: [],
      projects: [],
      milestones: [
        { name: "alpha", rank: 10, created_at: "2026-06-20T00:00:00.000Z" },
        { name: "beta", rank: 20, created_at: "2026-06-20T00:00:00.000Z" },
      ],
    },
    nodes: nodes.map((node) => ({
      id: node.id,
      title: node.title,
      kind: "feature",
      milestone: node.milestone,
      group_name: null,
      projects: [],
      status: node.status,
      priority: "P2",
      estimate_points: 1,
      risk: "medium",
      owner: null,
      branch: null,
      spec: `Spec ${node.id}`,
      acceptance: `Acceptance ${node.id}`,
      validation: null,
      verification: [],
      audit_focus: [],
      context: null,
      status_reason: null,
      check_command: null,
      ci_command: null,
      blocked_by: null,
      blocked_reason: null,
      blocked_owner: null,
      created_at: "2026-06-20T00:00:00.000Z",
      updated_at: "2026-06-20T00:00:00.000Z",
      claimed_at: null,
      done_at: null,
    })),
    edges: [],
    findings: [],
    runs: [],
    node_notes: [],
    assignments: [],
    waves: [
      {
        id: "wave-1",
        kind: "implementation",
        status: "open",
        summary: "wave",
        started_at: "2026-06-20T00:00:00.000Z",
        finished_at: null,
      },
    ],
    wave_memberships: [],
  };
}
