import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { openDatabase, run } from "@cat-cave/qdcli-core";
import {
  expectQdFailure,
  installCliFixture,
  qd,
  qdAt,
  qdJson,
  qdRaw,
  root,
} from "./cli-e2e-fixtures.js";

installCliFixture();

describe("qd CLI config and lifecycle surfaces", () => {
  it("exercises help, config, policy, CI, env, and advance command surfaces", async () => {
    expect(await qd()).toContain("Quick DAG CLI");
    expect(await qd("--help")).toContain("Core:");
    expect(await qd("complete", "--help")).toContain("qd complete");
    expect(await qd("init", "--help")).toContain("applies current DB migrations");
    expect(await qd("import", "--help")).toContain("--schema-mapping");
    expect(await qd("sync", "--help")).toContain("--expect-clean");
    expect(await qd("migrate", "--help")).toContain("pending qd DB schema migrations");
    expect(await qd("advance", "--help")).toContain("qd advance");
    expect(await qd("check", "--help")).toContain("qd check run");
    expect(await qd("ci", "--help")).toContain("qd ci");
    expect(await qd("merge", "--help")).toContain("qd merge");
    expect(await qd("audit", "--help")).toContain("qd audit");
    expect(await qd("assignment", "--help")).toContain("qd assignment");
    expect(await qd("wave", "--help")).toContain("qd wave");
    expect(await qd("policy", "--help")).toContain("qd policy");
    expect(await qd("diff", "--help")).toContain("qd diff");
    expect(await qd("worktree", "--help")).toContain("qd worktree");
    expect(await qd("help", "worktrees")).toContain("qd worktrees");
    expect(await qd("help", "diffs")).toContain("qd diffs");
    expect(await qd("help", "policies")).toContain("qd policies");
    expect(await qd("help", "method")).toContain("one strict roadmap model");
    expect(await qd("help", "reality")).toContain("never invent APIs");
    expect(await qd("help", "specs")).toContain("Unknown integrations require research");
    expect(await qd("help", "milestones")).toContain("externally meaningful capability phases");
    expect(await qd("help", "audits")).toContain("CI is not an audit");
    expect(await qd("help", "blockers")).toContain("structured escape hatches");
    expect(await qd("help", "evidence")).toContain("artifacts");

    expect((await qdJson("init", "--json")).ok).toBe(true);
    expect(await qd("setup", "--print-agent-url")).toContain("docs/llms.md");
    await qd("setup", "--no-hooks");
    await qd("method", "acknowledge", "--agent", "test");
    await expectQdFailure(/Unknown command/, "unknown-command");
    await qd("config", "set", "check_command", 'node -e "process.exit(0)"');
    await qd("config", "set", "ci_command", 'node -e "process.exit(0)"');
    await qd("config", "set", "skills_dir", ".qd/skills");
    await qd("config", "set", "merge_strategy", "merge");
    await qd("config", "set", "require_clean_worktree", "false");
    await qd("config", "set", "clean_worktree_except", ".qd/,roadmap/");
    await qd("config", "set", "require_gate_before_ci", "false");
    await qd("config", "set", "require_ci_before_merge", "true");
    await qd("config", "set", "export_default_out", "roadmap/spec-dag.json");
    await qd("config", "set", "export_canonicalize_command", "true");
    await qd("config", "set", "hooks_pre_gate", "true");
    await qd("config", "set", "hooks_pre_claim", "true");
    await qd("config", "set", "hooks_post_claim", "true");
    await qd("config", "set", "hooks_pre_check", "true");
    await qd("config", "set", "hooks_post_check", "true");
    await qd("config", "set", "hooks_pre_merge", "true");
    await qd("config", "set", "hooks_post_merge", "true");
    await qd("config", "set", "ci_repo", "--value", "cat-cave/qdcli");
    await qd("config", "set", "check_timeout_seconds", "10");
    await qd("config", "set", "check_no_output_timeout_seconds", "10");
    await qd("config", "set", "ci_timeout_seconds", "10");
    await qd("config", "set", "ci_no_output_timeout_seconds", "10");
    await qd("config", "set", "policy_require_audit_before_ci", "false");
    await qd("config", "set", "policy_require_verification_before_ci", "false");
    await qd("config", "set", "policy_require_p2_p3_disposition_before_merge", "false");
    await qd("config", "set", "policy_require_merge_commit", "false");
    await qd("config", "set", "worktree_base_dir", ".qd/worktrees");
    await qd("config", "set", "worktree_env_template", ".env.example");
    await qd("config", "set", "worktree_env_file", ".env");
    await qd(
      "config",
      "set",
      "ci-provider",
      "github",
      "--repo",
      "cat-cave/qdcli",
      "--workflow",
      "ci.yml",
    );
    expect((await qdJson("config", "get", "ci_provider", "--json")).value).toBe("github");
    expect((await qdJson("config", "show", "--json")).ciRepo).toBe("cat-cave/qdcli");
    for (const key of [
      "check_command",
      "ci_command",
      "ci_repo",
      "ci_workflow",
      "ci_auth",
      "skills_dir",
      "merge_strategy",
      "require_clean_worktree",
      "clean_worktree_except",
      "require_gate_before_ci",
      "require_ci_before_merge",
      "export_default_out",
      "export_canonicalize_command",
      "hooks",
      "hooks_pre_claim",
      "hooks_post_claim",
      "hooks_pre_check",
      "hooks_post_check",
      "hooks_pre_gate",
      "hooks_post_export",
      "hooks_pre_merge",
      "hooks_post_merge",
      "check_timeout_seconds",
      "check_no_output_timeout_seconds",
      "ci_timeout_seconds",
      "ci_no_output_timeout_seconds",
      "policy",
      "policy_require_audit_before_ci",
      "policy_require_verification_before_ci",
      "policy_require_p2_p3_disposition_before_merge",
      "policy_require_merge_commit",
      "worktree",
      "worktree_base_dir",
      "worktree_env_template",
      "worktree_env_file",
    ]) {
      expect(await qdJson("config", "get", key, "--json")).toHaveProperty("value");
    }
    await expectQdFailure(/merge_strategy must be/, "config", "set", "merge_strategy", "bad");
    await expectQdFailure(/Unknown config key/, "config", "set", "unknown_key", "value");
    await expectQdFailure(
      /must be a positive integer/,
      "config",
      "set",
      "check_timeout_seconds",
      "0",
    );
    await expectQdFailure(
      /must be true or false/,
      "config",
      "set",
      "require_clean_worktree",
      "maybe",
    );
    await expectQdFailure(
      /--kind must be one of/,
      "node",
      "add",
      "--title",
      "Bad kind",
      "--spec",
      "Bad kind spec.",
      "--acceptance",
      "Bad kind acceptance.",
      "--kind",
      "bogus",
    );
    await expectQdFailure(
      /--risk must be one of/,
      "node",
      "add",
      "--title",
      "Bad risk",
      "--spec",
      "Bad risk spec.",
      "--acceptance",
      "Bad risk acceptance.",
      "--risk",
      "weird",
    );
    await expectQdFailure(/--status must be one of/, "assignment", "list", "--status", "stale");

    await qd(
      "node",
      "add",
      "--id",
      "advance-node",
      "--title",
      "Advance node",
      "--spec",
      "Advance through checks.",
      "--acceptance",
      "The node advances.",
    );
    await qd("claim", "advance-node", "--agent", "worker", "--branch", "spec/advance-node");
    await writeFile(
      path.join(root, "advance-completion-report.json"),
      `${JSON.stringify({
        nodeId: "advance-node",
        summary: "Advance node implementation completed with evidence.",
        changedFiles: ["src/advance-node.ts"],
        acceptanceEvidence: [
          {
            criterion: "The node advances.",
            status: "passed",
            evidence: "reports/advance-node-acceptance.md",
          },
        ],
        commandsRun: [
          {
            command: 'node -e "process.exit(0)"',
            status: "passed",
            evidence: "reports/advance-node-command.log",
          },
        ],
        evidence: ["reports/advance-node-acceptance.md"],
        realWorldValidation: {
          required: false,
          status: "not_required",
          evidence: "No external service is required for this fixture node.",
        },
        unverifiedItems: [],
        dagChangesNeeded: [],
      })}\n`,
      "utf8",
    );
    const advanced = await qdJson(
      "advance",
      "advance-node",
      "--from-report",
      "advance-completion-report.json",
      "--skip-ci",
      "--json",
    );
    expect(advanced.ok).toBe(true);
    expect((await qdJson("completion-ready", "advance-node", "--json")).ok).toBe(true);
    expect(
      (
        await qdJson(
          "ci",
          "record-pass",
          "advance-node",
          "--summary",
          "external",
          "--url",
          "https://example.test/ci",
          "--json",
        )
      ).status,
    ).toBe("mergeable");
    expect((await qdJson("merge-ready", "advance-node", "--json")).ok).toBe(true);
    expect(
      (await qdJson("policy", "evaluate", "advance-node", "--phase", "merge", "--json")).ok,
    ).toBe(true);
    expect((await qdJson("merge", "advance-node", "--json")).status).toBe("done");

    await qd(
      "node",
      "add",
      "--id",
      "ci-failure",
      "--title",
      "CI failure",
      "--spec",
      "Record a CI failure.",
      "--acceptance",
      "The failure is visible.",
    );
    expect((await qdJson("ci", "start", "ci-failure", "--cmd", "external ci", "--json")).kind).toBe(
      "ci",
    );
    expect(
      (await qdJson("ci", "fail", "ci-failure", "--summary", "failed externally", "--json")).status,
    ).toBe("blocked");
    const ciFailureRuns = (await qdJson("node", "show", "ci-failure", "--full", "--json")).runs;
    await expectQdFailure(
      /is not passed/,
      "unblock",
      "ci-failure",
      "--from-run",
      ciFailureRuns[0].id,
      "--summary",
      "operator recovered",
      "--json",
    );
    await expectQdFailure(
      /No commit SHA found/,
      "ci",
      "poll",
      "ci-failure",
      "--provider",
      "github",
      "--timeout",
      "1",
      "--interval",
      "1",
      "--json",
    );
    await expectQdFailure(
      /ci_provider is none/,
      "ci",
      "poll",
      "ci-failure",
      "--provider",
      "none",
      "--json",
    );
    await qd(
      "node",
      "add",
      "--id",
      "poll-node",
      "--title",
      "Poll node",
      "--spec",
      "Poll CI through an adapter.",
      "--acceptance",
      "The adapter records CI evidence.",
    );
    const fakeBin = path.join(root, "bin");
    await mkdir(fakeBin, { recursive: true });
    const fakeGh = path.join(fakeBin, "gh");
    await writeFile(
      fakeGh,
      `#!/usr/bin/env sh\nprintf '%s\\n' '[{"databaseId":123,"status":"completed","conclusion":"success","url":"https://example.test/run","headSha":"abcdef1"}]'\n`,
      "utf8",
    );
    await chmod(fakeGh, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${previousPath ?? ""}`;
    try {
      const polled = await qdJson(
        "ci",
        "poll",
        "poll-node",
        "--sha",
        "abcdef1",
        "--repo",
        "cat-cave/qdcli",
        "--workflow",
        "ci.yml",
        "--timeout",
        "1",
        "--interval",
        "1",
        "--json",
      );
      expect(polled.ok).toBe(true);
      expect(polled.node.status).toBe("mergeable");
    } finally {
      process.env.PATH = previousPath;
    }
    await expectQdFailure(/Unknown policy action/, "policy", "bogus", "ci-failure");

    const envOk = await qdJson("env", "check", "--required", "PATH", "--mask", "--json");
    expect(envOk.ok).toBe(true);
    expect(Object.keys(await qdJson("status", "--json"))).toContain("nodes");
    expect((await qdJson("schema", "list", "--json")).includes("assignment")).toBe(true);
    await expectQdFailure(/Unknown schema/, "schema", "print", "missing");
    await expectQdFailure(/reserved/, "plan", "import");
    await expectQdFailure(/Unknown config action/, "config", "bogus");
    expect(
      (await qdJson("agent", "install", "skills-sh", "--target", "custom/SKILL.md", "--json")).ok,
    ).toBe(true);
    expect((await qdJson("agent", "doctor", "--json")).ok).toBe(true);
    await expectQdFailure(/agent install target must be skills-sh/, "agent", "install", "codex");
    expect((await qdJson("plan", "export", "--json")).nodes.length).toBeGreaterThan(0);
    const badDoctorRoot = await mkdtemp(path.join(os.tmpdir(), "qdcli-e2e-bad-doctor-"));
    try {
      await qdAt(badDoctorRoot, "setup", "--no-hooks");
      const configPath = path.join(badDoctorRoot, ".qd/config.toml");
      const badConfig = (await readFile(configPath, "utf8")).replace(
        'ci_provider = "none"',
        'ci_provider = "github"',
      );
      await writeFile(configPath, badConfig, "utf8");
      const doctor = await qdRaw(["--root", badDoctorRoot, "doctor", "--strict", "--json"]);
      expect(doctor.exitCode).toBe(1);
      expect(JSON.parse(doctor.stdout).ok).toBe(false);
    } finally {
      await rm(badDoctorRoot, { recursive: true, force: true });
    }

    const staleRoot = await mkdtemp(path.join(os.tmpdir(), "qdcli-e2e-stale-schema-"));
    try {
      await qdAt(staleRoot, "setup", "--no-hooks");
      const db = await openDatabase(staleRoot, { skipSchemaCheck: true });
      await run(db, "delete from schema_migrations where id = ?", ["007_orchestration_state"]);
      const doctor = await qdRaw(["--root", staleRoot, "doctor", "--json"]);
      expect(doctor.exitCode).toBe(1);
      const payload = JSON.parse(doctor.stdout) as {
        ok: boolean;
        checks: { schema: boolean };
        errors: string[];
      };
      expect(payload.ok).toBe(false);
      expect(payload.checks.schema).toBe(false);
      expect(payload.errors.join("\n")).toContain("Run qd migrate");
      await expect(
        qdRaw(["--root", staleRoot, "status", "--json"]).then((result) => result.stderr),
      ).resolves.toContain("Run qd migrate");
    } finally {
      await rm(staleRoot, { recursive: true, force: true });
    }
  });
});
