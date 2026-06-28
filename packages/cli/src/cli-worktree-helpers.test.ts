import { describe, expect, it } from "vite-plus/test";
import { defaultConfig } from "@cat-cave/qdcli-core";
import {
  aheadBehindArgs,
  branchExistsArgs,
  findWorktreeByBranch,
  gitStatusArgs,
  gitWorktreeListArgs,
  hasSubstantiveTemplate,
  isFileAlreadyExistsError,
  mergeBaseArgs,
  mergedBranchesArgs,
  worktreeRemoveArgs,
} from "./worktree.js";

describe("worktree command helpers", () => {
  it("builds git worktree command arguments explicitly", () => {
    expect(gitWorktreeListArgs()).toEqual(["worktree", "list", "--porcelain"]);
    expect(branchExistsArgs("spec/a")).toEqual(["rev-parse", "--verify", "spec/a"]);
    expect(gitStatusArgs("/repo/wt")).toEqual(["-C", "/repo/wt", "status", "--porcelain"]);
    expect(mergeBaseArgs("main", "spec/a")).toEqual(["merge-base", "main", "spec/a"]);
    expect(aheadBehindArgs("/repo/wt", "main", "spec/a")).toEqual([
      "-C",
      "/repo/wt",
      "rev-list",
      "--left-right",
      "--count",
      "main...spec/a",
    ]);
    expect(mergedBranchesArgs("main")).toEqual([
      "branch",
      "--merged",
      "main",
      "--format",
      "%(refname:short)",
    ]);
    expect(worktreeRemoveArgs("/repo/wt")).toEqual(["worktree", "remove", "/repo/wt"]);
  });

  it("finds worktrees by exact branch and treats missing branches as null", () => {
    const worktrees = [
      { path: "/repo", branch: "main", head: "abc" },
      { path: "/repo/wt", branch: "spec/a", head: "def" },
      { path: "/repo/detached", branch: null, head: "fed" },
    ];
    expect(findWorktreeByBranch(worktrees, "spec/a")).toEqual(worktrees[1]);
    expect(findWorktreeByBranch(worktrees, "spec")).toBeNull();
    expect(findWorktreeByBranch(worktrees, "main")).toEqual(worktrees[0]);
  });

  it("recognizes substantive env templates and EEXIST errors only", () => {
    expect(hasSubstantiveTemplate(defaultConfig)).toBe(false);
    expect(
      hasSubstantiveTemplate({
        ...defaultConfig,
        worktree: { ...defaultConfig.worktree, envTemplate: "  template.env  " },
      }),
    ).toBe(true);
    expect(
      hasSubstantiveTemplate({
        ...defaultConfig,
        worktree: { ...defaultConfig.worktree, envTemplate: " \n\t " },
      }),
    ).toBe(false);

    expect(isFileAlreadyExistsError(Object.assign(new Error("exists"), { code: "EEXIST" }))).toBe(
      true,
    );
    expect(isFileAlreadyExistsError(Object.assign(new Error("denied"), { code: "EACCES" }))).toBe(
      false,
    );
    expect(isFileAlreadyExistsError(null)).toBe(false);
    expect(isFileAlreadyExistsError("EEXIST")).toBe(false);
  });
});
