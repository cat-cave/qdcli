import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vite-plus/test";
import {
  configureStrictDoctorCommands,
  expectQdFailure,
  installCliFixture,
  qd,
  qdAt,
  qdJson,
  qdJsonAllowExit,
  root,
} from "./cli-e2e-fixtures.js";

const execFileAsync = promisify(execFile);

installCliFixture();

describe("qd CLI import, workspace, and diff surfaces", () => {
  it("exercises import adapters, workspace rollups, env checks, and git diff helpers", async () => {
    await qd("setup", "--no-hooks");
    await configureStrictDoctorCommands();

    await writeFile(
      path.join(root, "source-dag.json"),
      `${JSON.stringify({
        items: [
          {
            key: "alpha",
            name: "Alpha",
            state: "planned",
            summary: "Implement alpha.",
            deliverables: ["alpha cli", "alpha docs"],
            acceptanceCriteria: ["alpha works"],
            deps: [],
            parallelGroup: "runtime",
            projects: ["app"],
            target: "baseline",
            auditFocus: ["state transitions"],
            verification: [{ type: "manual", value: "owner review" }],
          },
          {
            key: "beta",
            name: "Beta",
            state: "planned",
            summary: "Implement beta.",
            deliverables: ["beta cli"],
            acceptanceCriteria: ["beta works"],
            deps: ["alpha"],
            parallelGroup: "runtime",
            projects: ["app"],
            target: "baseline",
          },
        ],
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(root, "mapping.json"),
      `${JSON.stringify({
        nodesPath: "items",
        id: "key",
        title: "name",
        status: "state",
        statusMap: { planned: "ready" },
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
        group: "parallelGroup",
        projects: "projects",
        milestone: "target",
        verification: "verification",
        auditFocus: "auditFocus",
        nodeEdges: {
          path: "deps",
          edgeDirection: "deps-block-this-node",
          edgeType: "requires",
        },
      })}\n`,
      "utf8",
    );
    const importDryRun = await qdJson(
      "import",
      "--from",
      "source-dag.json",
      "--schema-mapping",
      "mapping.json",
      "--dry-run",
      "--verbose",
      "--json",
    );
    expect(importDryRun.nodesFound).toBe(2);
    expect(importDryRun.importedEdges).toBe(1);
    const imported = await qdJson(
      "import",
      "--from",
      "source-dag.json",
      "--schema-mapping",
      "mapping.json",
      "--allow-defaults",
      "--json",
    );
    expect(imported.importedNodes).toBe(2);
    expect((await qdJson("ready", "--json")).map((node: any) => node.id)).toEqual(["alpha"]);
    await writeFile(
      path.join(root, "merge-source.json"),
      `${JSON.stringify({
        nodes: [
          {
            id: "merged-alpha",
            title: "Merged alpha",
            kind: "feature",
            group_name: "runtime",
            projects: ["app"],
            milestone: "baseline",
            status: "ready",
            priority: "P2",
            estimate_points: 2,
            risk: "medium",
            spec: "Replace graph through import merge.",
            acceptance: "The replacement graph is durable.",
            verification: [{ type: "manual", value: "owner check" }],
            audit_focus: ["replacement semantics"],
          },
          {
            id: "merged-beta",
            title: "Merged beta",
            kind: "feature",
            group_name: "runtime",
            projects: ["app"],
            milestone: "baseline",
            status: "ready",
            priority: "P2",
            estimate_points: 1,
            risk: "medium",
            spec: "Depend on merged alpha.",
            acceptance: "The edge is preserved.",
          },
        ],
        edges: [{ from_node: "merged-alpha", to_node: "merged-beta", type: "requires" }],
      })}\n`,
      "utf8",
    );
    const mergedImport = await qdJson(
      "import",
      "--from",
      "merge-source.json",
      "--merge",
      "--allow-defaults",
      "--json",
    );
    expect(mergedImport.importedNodes).toBe(2);
    expect((await qdJson("ready", "--json")).map((node: any) => node.id)).toEqual(["merged-alpha"]);

    await writeFile(
      path.join(root, "roadmap.md"),
      "- [x] Alpha\n  - spec: Implement alpha\n  - acceptance: Alpha works\n- [ ] Gamma\n  - spec: Implement gamma\n  - acceptance: Gamma works\n  - depends on: Alpha\n",
      "utf8",
    );
    expect(
      (
        await qdJson(
          "import",
          "--from",
          "roadmap.md",
          "--adapter",
          "markdown-checklist",
          "--dry-run",
          "--json",
        )
      ).nodesFound,
    ).toBe(2);
    await writeFile(
      path.join(root, "roadmap.html"),
      '<section><h3 data-id="alpha">Alpha</h3><p>Implement alpha.</p><ul><li>Alpha works</li></ul></section><section><h3 data-id="delta">Delta</h3><p>Implement delta.</p><ul><li>Delta works</li></ul><span class="dep">alpha</span></section>',
      "utf8",
    );
    expect(
      (
        await qdJson(
          "import",
          "--from",
          "roadmap.html",
          "--adapter",
          "roadmap-html",
          "--dry-run",
          "--json",
        )
      ).nodesFound,
    ).toBe(2);
    await expectQdFailure(
      /cannot be combined/,
      "import",
      "--from",
      "roadmap.md",
      "--adapter",
      "markdown-checklist",
      "--schema-mapping",
      "mapping.json",
      "--dry-run",
    );
    await expectQdFailure(
      /--adapter must be one of/,
      "import",
      "--from",
      "roadmap.md",
      "--adapter",
      "bad",
    );

    await qd("export", "--deterministic", "--out", "roadmap/spec-dag.json");
    const importedRoot = await mkdtemp(path.join(os.tmpdir(), "qdcli-e2e-imported-"));
    try {
      await qdAt(importedRoot, "setup", "--no-hooks");
      await qdAt(importedRoot, "import", "--from", path.join(root, "roadmap/spec-dag.json"));
      await writeFile(
        path.join(root, "workspace.toml"),
        `repos = ["${root.replaceAll("\\", "\\\\")}", "${importedRoot.replaceAll("\\", "\\\\")}"]\n`,
        "utf8",
      );
      const workspaceConfig = path.join(root, "workspace.toml");
      expect(
        (await qdJson("workspace", "status", "--config", workspaceConfig, "--json")).repos,
      ).toHaveLength(2);
      expect(
        (await qdJson("workspace", "ready", "--config", workspaceConfig, "--json")).length,
      ).toBeGreaterThan(0);
      expect(
        (await qdJson("workspace", "graph", "--config", workspaceConfig, "--json")).repos,
      ).toHaveLength(2);
    } finally {
      await rm(importedRoot, { recursive: true, force: true });
    }

    const missingEnv = await qdJsonAllowExit(
      "env",
      "check",
      "--required",
      "QDCLI_E2E_MISSING",
      "--json",
    );
    expect(missingEnv.exitCode).toBe(1);
    expect(missingEnv.json.ok).toBe(false);

    await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "qd@example.test"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "qd test"], { cwd: root });
    await writeFile(path.join(root, "tracked.txt"), "base\n", "utf8");
    await execFileAsync("git", ["add", "tracked.txt"], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "base"], { cwd: root });
    await qd("claim", "merged-alpha", "--agent", "worker", "--branch", "spec/alpha");
    await execFileAsync("git", ["checkout", "-b", "spec/alpha"], { cwd: root });
    await writeFile(path.join(root, "tracked.txt"), "base\nalpha\n", "utf8");
    await execFileAsync("git", ["commit", "-am", "alpha"], { cwd: root });
    expect(
      (await qdJson("diff", "merged-alpha", "--base", "main", "--self-only", "--json")).diff,
    ).toContain("alpha");
    expect(
      (await qdJson("diff", "merged-alpha", "--base", "main", "--name-only", "--json")).diff,
    ).toContain("tracked.txt");
    await expectQdFailure(
      /format is only supported/,
      "diff",
      "merged-alpha",
      "--format",
      "markdown",
    );

    await execFileAsync("git", ["checkout", "main"], { cwd: root });
    await qd("config", "set", "worktree_base_dir", ".qd/worktrees");
    await qd(
      "worktree",
      "create",
      "merged-beta",
      "--branch",
      "spec/beta",
      "--env",
      "QD_CACHE=/tmp/cache",
      "--json",
    );
    expect(
      (await qdJson("worktree", "status", "merged-beta", "--base", "main", "--json"))[0].branch,
    ).toBe("spec/beta");
    expect((await qdJson("worktree", "list", "--base", "main", "--json")).length).toBeGreaterThan(
      0,
    );
    expect(
      (await qdJson("worktree", "env", "merged-beta", "--env", "QD_CACHE=/tmp/cache", "--json")).ok,
    ).toBe(true);
    const betaWorktree = path.join(root, ".qd/worktrees/merged-beta");
    await writeFile(path.join(betaWorktree, "tracked.txt"), "base\nworking\n", "utf8");
    expect(
      (await qdJson("diff", "merged-beta", "--working", "--name-only", "--json")).diff,
    ).toContain("tracked.txt");
    await execFileAsync("git", ["-C", betaWorktree, "add", "tracked.txt"]);
    expect(
      (await qdJson("diff", "merged-beta", "--working", "--staged", "--name-only", "--json")).diff,
    ).toContain("tracked.txt");
    await expectQdFailure(
      /Refusing to remove dirty worktree/,
      "worktree",
      "cleanup",
      "merged-beta",
      "--merged-only",
    );
    await expectQdFailure(/No worktree found/, "worktree", "env", "merged-alpha");

    await qd(
      "node",
      "add",
      "--id",
      "clean-node",
      "--title",
      "Clean node",
      "--spec",
      "Run a clean check.",
      "--acceptance",
      "The check is guarded.",
    );
    await qd("config", "set", "require_clean_worktree", "true");
    await qd(
      "config",
      "set",
      "clean_worktree_except",
      ".qd/,allowed.txt,mapping.json,merge-source.json,roadmap.html,roadmap.md,roadmap/,source-dag.json,workspace.toml",
    );
    await qd("config", "set", "check_command", "true");
    await writeFile(path.join(root, "allowed.txt"), "allowed dirty file\n", "utf8");
    await writeFile(path.join(root, "blocked.txt"), "blocked dirty file\n", "utf8");
    await expectQdFailure(/Worktree must be clean/, "check", "run", "clean-node");
    await rm(path.join(root, "blocked.txt"));
    expect((await qdJson("check", "run", "clean-node", "--json")).ok).toBe(true);
  });
});
