import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  addFinding,
  addNode,
  defaultConfig,
  setupProject,
  writeConfig,
} from "@cat-cave/qdcli-core";
import {
  commandForCheck,
  executeConfiguredCheck,
  recorderStatusForRunStatus,
  runConfiguredCheck,
  runStatusFromExecution,
  shouldRunHook,
  timeoutOptionsForCheck,
} from "./checks.js";
import {
  diffFormatFromOptions,
  diffToolFromOptions,
  inspectRange,
  isDiffFormat,
  isDiffTool,
  missingDiffToolMessage,
  rangeDiffInvocation,
  semRangeEndpoints,
  validateDiffModeOptions,
  workingDiffInvocation,
} from "./diff.js";
import {
  escapeRegExp,
  isBranchListed,
  maybeWriteWorktreeEnv,
  parseEnvAssignment,
  parseGitWorktreePorcelain,
  quoteEnvValue,
  shouldWriteWorktreeEnv,
  validateWorktreeCreateTarget,
  validateWorktreeEnvFileName,
  writeWorktreeEnv,
  worktreeAddArgs,
  worktreeBaseSummary,
  worktreeDirtySummary,
} from "./worktree.js";

let root = "";
let previousExitCode: string | number | null | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "qdcli-runtime-"));
  await setupProject(root);
  previousExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(async () => {
  process.exitCode = previousExitCode;
  await rm(root, { recursive: true, force: true });
});

describe("CLI runtime helpers", () => {
  it("selects diff tools and formats strictly", () => {
    expect(diffToolFromOptions({})).toBe("git");
    expect(diffToolFromOptions({ semantic: true })).toBe("sem");
    expect(diffToolFromOptions({ inspect: true })).toBe("inspect");
    expect(diffToolFromOptions({ tool: "sem" })).toBe("sem");
    expect(() => diffToolFromOptions({ tool: "bad" })).toThrow(/--tool/);

    expect(diffFormatFromOptions({}, "git")).toBe("patch");
    expect(diffFormatFromOptions({}, "sem")).toBe("markdown");
    expect(diffFormatFromOptions({ format: "json" }, "inspect")).toBe("json");
    expect(diffFormatFromOptions({ format: "plain" }, "sem")).toBe("plain");
    expect(() => diffFormatFromOptions({ format: "plain" }, "git")).toThrow(/--format/);
    expect(() => diffFormatFromOptions({ format: "xml" }, "sem")).toThrow(/--format/);

    for (const value of ["git", "sem", "inspect"]) expect(isDiffTool(value)).toBe(true);
    for (const value of ["patch", "plain", "json", "markdown"])
      expect(isDiffFormat(value)).toBe(true);
    expect(isDiffTool("delta")).toBe(false);
    expect(isDiffFormat("html")).toBe(false);
  });

  it("plans diff invocations and rejects invalid mode combinations", () => {
    expect(() => validateDiffModeOptions({ "name-only": true }, "sem")).toThrow(/name-only/);
    expect(() => validateDiffModeOptions({ working: true, "self-only": true }, "git")).toThrow(
      /separate diff modes/,
    );
    expect(() => validateDiffModeOptions({ working: true }, "inspect")).toThrow(/committed/);
    expect(validateDiffModeOptions({ working: true, staged: true }, "sem")).toBeUndefined();

    expect(workingDiffInvocation("git", "patch", { staged: true, "name-only": true })).toEqual({
      command: "git",
      args: ["diff", "--name-only", "--staged"],
    });
    expect(workingDiffInvocation("sem", "json", { staged: true })).toEqual({
      command: "sem",
      args: ["diff", "--format", "json", "--staged"],
    });

    expect(semRangeEndpoints("main...spec/a", "main", "spec/a", null)).toEqual(["main", "spec/a"]);
    expect(semRangeEndpoints("abc123..spec/a", "main", "spec/a", "abc123")).toEqual([
      "abc123",
      "spec/a",
    ]);
    expect(inspectRange("main...spec/a", "main", "spec/a")).toBe("main..spec/a");
    expect(inspectRange("abc123..spec/a", "main", "spec/a")).toBe("abc123..spec/a");

    expect(
      rangeDiffInvocation(
        "git",
        "patch",
        { "name-only": true },
        "main",
        "spec/a",
        "main...spec/a",
        null,
      ),
    ).toEqual({ command: "git", args: ["diff", "--name-only", "main...spec/a"] });
    expect(
      rangeDiffInvocation("sem", "markdown", {}, "main", "spec/a", "abc123..spec/a", "abc123"),
    ).toEqual({
      command: "sem",
      args: ["diff", "--from", "abc123", "--to", "spec/a", "--format", "markdown"],
    });
    expect(
      rangeDiffInvocation("inspect", "plain", {}, "main", "spec/a", "main...spec/a", null),
    ).toEqual({
      command: "inspect",
      args: ["diff", "main..spec/a", "--format", "plain"],
    });
    expect(missingDiffToolMessage("sem")).toMatch(/sem is not installed/);
    expect(missingDiffToolMessage("inspect")).toMatch(/inspect is not installed/);
    expect(missingDiffToolMessage("git")).toBeNull();
  });

  it("parses and quotes worktree env assignments strictly", () => {
    expect(parseEnvAssignment("FOO=bar=baz")).toEqual(["FOO", "bar=baz"]);
    expect(parseEnvAssignment("_A1=value")).toEqual(["_A1", "value"]);
    expect(() => parseEnvAssignment("=value")).toThrow(/KEY=value/);
    expect(() => parseEnvAssignment("NOVALUE")).toThrow(/KEY=value/);
    expect(() => parseEnvAssignment("1BAD=value")).toThrow(/Invalid env var name/);
    expect(() => parseEnvAssignment("BAD-NAME=value")).toThrow(/Invalid env var name/);
    expect(quoteEnvValue('a"b\nc')).toBe(JSON.stringify('a"b\nc'));
    expect(new RegExp(escapeRegExp("a.b[1]")).test("a.b[1]")).toBe(true);
  });

  it("parses worktree porcelain, dirty summaries, and base summaries deterministically", () => {
    expect(
      parseGitWorktreePorcelain(
        [
          "worktree /repo",
          "HEAD abc123",
          "branch refs/heads/main",
          "",
          "worktree /repo/.qd/worktrees/a",
          "HEAD def456",
          "branch refs/heads/spec/a",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { path: "/repo", head: "abc123", branch: "main" },
      { path: "/repo/.qd/worktrees/a", head: "def456", branch: "spec/a" },
    ]);
    expect(parseGitWorktreePorcelain("worktree /detached\nHEAD abc123\n")).toEqual([
      { path: "/detached", head: "abc123", branch: null },
    ]);
    expect(worktreeDirtySummary(1, " M file.ts\n")).toEqual({
      dirty: null,
      changedFiles: null,
    });
    expect(worktreeDirtySummary(0, " M file.ts\n\n?? new.ts\n")).toEqual({
      dirty: true,
      changedFiles: 2,
    });
    expect(worktreeDirtySummary(0, "  \n")).toEqual({ dirty: false, changedFiles: 0 });
    expect(worktreeBaseSummary("main", " abc123 \n", "2 3\n")).toEqual({
      ref: "main",
      mergeBase: "abc123",
      behind: 2,
      ahead: 3,
    });
    expect(worktreeBaseSummary("main", "abc123", "")).toMatchObject({ behind: 0, ahead: 0 });
  });

  it("plans worktree creation and cleanup decisions strictly", () => {
    const existing = [
      { path: path.join(root, ".qd/worktrees/one"), branch: "spec/one", head: "abc" },
      { path: path.join(root, ".qd/worktrees/two"), branch: "spec/two", head: "def" },
    ];
    expect(() =>
      validateWorktreeCreateTarget(existing, "spec/one", path.join(root, ".qd/worktrees/three")),
    ).toThrow(/already checked out/);
    expect(() =>
      validateWorktreeCreateTarget(existing, "spec/three", path.join(root, ".qd/worktrees/two")),
    ).toThrow(/path is already in use/);
    expect(
      validateWorktreeCreateTarget(existing, "spec/three", path.join(root, ".qd/worktrees/three")),
    ).toBeUndefined();
    expect(worktreeAddArgs(true, "/repo/.qd/worktrees/a", "spec/a")).toEqual([
      "worktree",
      "add",
      "/repo/.qd/worktrees/a",
      "spec/a",
    ]);
    expect(worktreeAddArgs(false, "/repo/.qd/worktrees/a", "spec/a")).toEqual([
      "worktree",
      "add",
      "-b",
      "spec/a",
      "/repo/.qd/worktrees/a",
      "HEAD",
    ]);
    expect(isBranchListed("main\nspec/a\n", "spec/a")).toBe(true);
    expect(isBranchListed("main\nfeature/spec/a-extra\n", "spec/a")).toBe(false);
  });

  it("decides env injection and env file names explicitly", () => {
    expect(shouldWriteWorktreeEnv({}, defaultConfig)).toBe(false);
    expect(shouldWriteWorktreeEnv({ env: ["A=b"] }, defaultConfig)).toBe(true);
    expect(shouldWriteWorktreeEnv({ "env-template": "template.env" }, defaultConfig)).toBe(true);
    expect(
      shouldWriteWorktreeEnv(
        {},
        {
          ...defaultConfig,
          worktree: { ...defaultConfig.worktree, envTemplate: "template.env" },
        },
      ),
    ).toBe(true);
    expect(validateWorktreeEnvFileName(".env")).toBeUndefined();
    expect(validateWorktreeEnvFileName("nested/.env")).toBeUndefined();
    expect(() => validateWorktreeEnvFileName("../.env")).toThrow(/relative file name/);
    expect(() => validateWorktreeEnvFileName(path.resolve(root, ".env"))).toThrow(/relative/);
  });

  it("writes and replaces qd worktree env context without clobbering templates", async () => {
    const worktreePath = path.join(root, "worktree");
    await writeFile(path.join(root, "template.env"), "KEEP=1\n", "utf8");
    const config = {
      ...defaultConfig,
      worktree: { baseDir: ".qd/worktrees", envTemplate: "template.env", envFile: ".env" },
    };

    expect(
      await maybeWriteWorktreeEnv(root, worktreePath, "node-a", "spec/node-a", {}, defaultConfig),
    ).toBeNull();
    expect(
      await writeWorktreeEnv(
        root,
        worktreePath,
        "node-a",
        "spec/node-a",
        { env: ["EXTRA=yes"] },
        config,
      ),
    ).toBe(path.join("worktree", ".env"));
    expect(await readFile(path.join(worktreePath, ".env"), "utf8")).toBe(
      [
        "KEEP=1",
        "",
        "# qd worktree context begin",
        `QD_ROOT=${JSON.stringify(root)}`,
        `QD_NODE_ID=${JSON.stringify("node-a")}`,
        `QD_BRANCH=${JSON.stringify("spec/node-a")}`,
        `QD_WORKTREE=${JSON.stringify(worktreePath)}`,
        `EXTRA=${JSON.stringify("yes")}`,
        "# qd worktree context end",
        "",
      ].join("\n"),
    );

    await writeWorktreeEnv(
      root,
      worktreePath,
      "node-a",
      "spec/node-a",
      { env: ["EXTRA=no"] },
      config,
    );
    const replaced = await readFile(path.join(worktreePath, ".env"), "utf8");
    expect(replaced.match(/qd worktree context begin/g)).toHaveLength(1);
    expect(replaced).toContain(`EXTRA=${JSON.stringify("no")}`);
    expect(replaced).not.toContain(`EXTRA=${JSON.stringify("yes")}`);
    await expect(
      writeWorktreeEnv(root, worktreePath, "node-a", "branch", { "env-file": "../bad" }, config),
    ).rejects.toThrow(/relative file name/);
    await expect(
      writeWorktreeEnv(root, worktreePath, "node-a", "branch", { env: ["BAD-NAME=x"] }, config),
    ).rejects.toThrow(/Invalid env var name/);
  });

  it("executes configured checks with node overrides, policy gates, and exit codes", async () => {
    await addNode(root, {
      id: "check-node",
      title: "Check node",
      spec: "Run checks.",
      acceptance: "Checks are recorded.",
      checkCommand: 'node -e "process.exit(0)"',
      ciCommand: 'node -e "process.exit(0)"',
    });
    await writeConfig(root, {
      ...defaultConfig,
      requireGateBeforeCi: false,
      requireCleanWorktree: false,
      policy: {
        ...defaultConfig.policy,
        requireAuditBeforeCi: false,
        requireVerificationBeforeCi: false,
      },
      checkCommand: 'node -e "process.exit(1)"',
      ciCommand: 'node -e "process.exit(1)"',
      checkTimeoutSeconds: 11,
      checkNoOutputTimeoutSeconds: 12,
      ciTimeoutSeconds: 13,
      ciNoOutputTimeoutSeconds: 14,
    });

    const check = await executeConfiguredCheck(root, "check-node", "check", {});
    expect(check.ok).toBe(true);
    expect(check.command).toBe('node -e "process.exit(0)"');
    expect(check.logPath).toContain("check-check-node-");

    const ci = await executeConfiguredCheck(root, "check-node", "ci", {
      cmd: 'node -e "process.exit(0)"',
    });
    expect(ci.ok).toBe(true);
    expect(ci.command).toBe('node -e "process.exit(0)"');
    expect(ci.logPath).toContain("ci-check-node-");

    const failed = await executeConfiguredCheck(root, "check-node", "check", {
      cmd: 'node -e "process.exit(7)"',
    });
    expect(failed.ok).toBe(false);
    expect(failed.exitCode).toBe(7);

    await runConfiguredCheck(
      root,
      "check-node",
      "check",
      { cmd: 'node -e "process.exit(9)"' },
      true,
    );
    expect(process.exitCode).toBe(9);
  });

  it("selects check commands, timeouts, hooks, and recorded statuses explicitly", () => {
    const config = {
      ...defaultConfig,
      checkCommand: "just check",
      ciCommand: "just ci",
      checkTimeoutSeconds: 11,
      checkNoOutputTimeoutSeconds: 12,
      ciTimeoutSeconds: 13,
      ciNoOutputTimeoutSeconds: 14,
    };
    expect(
      commandForCheck("check", { check_command: "node check", ci_command: "node ci" }, config, {}),
    ).toBe("node check");
    expect(
      commandForCheck("ci", { check_command: "node check", ci_command: "node ci" }, config, {}),
    ).toBe("node ci");
    expect(
      commandForCheck("check", { check_command: null, ci_command: null }, config, {
        cmd: "custom",
      }),
    ).toBe("custom");
    expect(commandForCheck("check", { check_command: null, ci_command: null }, config, {})).toBe(
      "just check",
    );
    expect(commandForCheck("ci", { check_command: null, ci_command: null }, config, {})).toBe(
      "just ci",
    );
    expect(timeoutOptionsForCheck("check", config)).toEqual({
      timeoutSeconds: 11,
      noOutputTimeoutSeconds: 12,
    });
    expect(timeoutOptionsForCheck("ci", config)).toEqual({
      timeoutSeconds: 13,
      noOutputTimeoutSeconds: 14,
    });
    expect(shouldRunHook({}, "just hook")).toBe(true);
    expect(shouldRunHook({ "no-hooks": true }, "just hook")).toBe(false);
    expect(shouldRunHook({}, "   ")).toBe(false);
    expect(runStatusFromExecution({ exitCode: 0 })).toBe("passed");
    expect(runStatusFromExecution({ exitCode: 124, timedOut: true })).toBe("timed_out");
    expect(runStatusFromExecution({ exitCode: 1 })).toBe("failed");
    expect(recorderStatusForRunStatus("passed")).toBe("passed");
    expect(recorderStatusForRunStatus("timed_out")).toBe("failed");
    expect(recorderStatusForRunStatus("failed")).toBe("failed");
  });

  it("refuses checks with dirty worktrees, blocked gates, and empty commands", async () => {
    await addNode(root, {
      id: "blocked",
      title: "Blocked",
      spec: "Blocked node.",
      acceptance: "Blocked node is gated.",
    });
    await writeConfig(root, {
      ...defaultConfig,
      requireGateBeforeCi: true,
      requireCleanWorktree: false,
      checkCommand: 'node -e "process.exit(0)"',
    });
    await addFinding(root, "blocked", {
      severity: "P1",
      title: "Blocking finding",
      evidence: "This should prevent checks.",
    });
    const blocked = await executeConfiguredCheck(root, "blocked", "check", {});
    expect(blocked).toMatchObject({ ok: false, exitCode: 1, command: null, logPath: null });

    await writeConfig(root, {
      ...defaultConfig,
      requireGateBeforeCi: false,
      requireCleanWorktree: false,
      checkCommand: "",
    });
    await expect(executeConfiguredCheck(root, "blocked", "check", {})).rejects.toThrow(
      /check_command is empty/,
    );
  });
});
