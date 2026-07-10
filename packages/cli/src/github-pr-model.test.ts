import { describe, expect, it } from "vite-plus/test";
import {
  aggregateGitHubChecks,
  monitorGlyph,
  parseGitHubPrChecks,
  parseGitHubPullRequest,
  prChecksArgs,
  prCompareArgs,
  prMergeArgs,
  prUpdateBranchArgs,
  prViewArgs,
} from "./github-pr-model.js";

describe("GitHub PR model", () => {
  it("builds explicit gh CLI arguments", () => {
    expect(prViewArgs("17", "owner/repo")).toEqual([
      "pr",
      "view",
      "17",
      "--repo",
      "owner/repo",
      "--json",
      "number,url,headRefName,headRefOid,baseRefName,baseRefOid,mergeable,mergeStateStatus,isDraft,state,mergedAt,mergeCommit",
    ]);
    expect(prChecksArgs("17", "owner/repo", true)).toEqual([
      "pr",
      "checks",
      "17",
      "--repo",
      "owner/repo",
      "--required",
      "--json",
      "bucket,name,state,link,workflow",
    ]);
    expect(prChecksArgs("17", "owner/repo", false)).toEqual([
      "pr",
      "checks",
      "17",
      "--repo",
      "owner/repo",
      "--json",
      "bucket,name,state,link,workflow",
    ]);
    expect(prCompareArgs("owner/repo", "base", "head")).toEqual([
      "api",
      "repos/owner/repo/compare/base...head",
      "--jq",
      ".behind_by",
    ]);
    expect(prMergeArgs("17", "owner/repo", "squash", "abc")).toEqual([
      "pr",
      "merge",
      "17",
      "--repo",
      "owner/repo",
      "--squash",
      "--match-head-commit",
      "abc",
    ]);
    expect(prUpdateBranchArgs("17", "owner/repo", true)).toEqual([
      "pr",
      "update-branch",
      "17",
      "--repo",
      "owner/repo",
      "--rebase",
    ]);
    expect(prUpdateBranchArgs("17", "owner/repo", false)).toEqual([
      "pr",
      "update-branch",
      "17",
      "--repo",
      "owner/repo",
    ]);
  });

  it("parses PR identity and aggregate required-check states", () => {
    const pr = parseGitHubPullRequest(
      JSON.stringify({
        number: 17,
        url: "https://github.com/owner/repo/pull/17",
        headRefName: "spec/a",
        headRefOid: "abc",
        baseRefName: "main",
        baseRefOid: "def",
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
        isDraft: false,
        state: "OPEN",
        mergedAt: null,
        mergeCommit: null,
      }),
    );
    expect(pr).toEqual({
      number: 17,
      url: "https://github.com/owner/repo/pull/17",
      headRefName: "spec/a",
      headRefOid: "abc",
      baseRefName: "main",
      baseRefOid: "def",
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      isDraft: false,
      state: "OPEN",
      mergedAt: null,
      mergeCommit: null,
    });
    const pass = parseGitHubPrChecks(
      JSON.stringify([
        { bucket: "pass", name: "ci", state: "SUCCESS", link: "ci-url", workflow: "CI" },
        {
          bucket: "skipping",
          name: "optional",
          state: "SKIPPED",
          link: "",
          workflow: "CI",
        },
      ]),
    );
    expect(aggregateGitHubChecks(pass)).toBe("pass");
    expect(
      aggregateGitHubChecks([
        { bucket: "pending", name: "ci", state: "QUEUED", link: "", workflow: "CI" },
      ]),
    ).toBe("queued");
    expect(
      aggregateGitHubChecks([
        { bucket: "pending", name: "ci", state: "IN_PROGRESS", link: "", workflow: "CI" },
      ]),
    ).toBe("pending");
    expect(
      aggregateGitHubChecks([
        { bucket: "fail", name: "ci", state: "FAILURE", link: "", workflow: "CI" },
      ]),
    ).toBe("fail");
    expect(aggregateGitHubChecks([])).toBe("no_checks");
    expect(monitorGlyph("pass")).toBe("✓");
    expect(monitorGlyph("fail")).toBe("✗");
    expect(monitorGlyph("queued")).toBe("⧗");
    expect(monitorGlyph("pending")).toBe("⏳");
    expect(monitorGlyph("no_checks")).toBe("?");
  });

  it("rejects malformed PR identity and supplies explicit optional defaults", () => {
    const required = {
      number: 17,
      url: "https://github.com/owner/repo/pull/17",
      headRefName: "spec/a",
      headRefOid: "abc",
      baseRefName: "main",
      baseRefOid: "def",
    };
    expect(parseGitHubPullRequest(JSON.stringify(required))).toEqual({
      ...required,
      mergeable: "UNKNOWN",
      mergeStateStatus: "UNKNOWN",
      isDraft: false,
      state: "UNKNOWN",
      mergedAt: null,
      mergeCommit: null,
    });
    expect(
      parseGitHubPullRequest(
        JSON.stringify({
          ...required,
          isDraft: true,
          mergedAt: "2026-07-10T00:00:00Z",
          mergeCommit: { oid: "merged" },
        }),
      ),
    ).toMatchObject({
      isDraft: true,
      mergedAt: "2026-07-10T00:00:00Z",
      mergeCommit: { oid: "merged" },
    });
    for (const number of [0, -1, 1.5, "17", null]) {
      expect(() => parseGitHubPullRequest(JSON.stringify({ ...required, number }))).toThrow(
        "invalid pull request number",
      );
    }
    for (const field of [
      "url",
      "headRefName",
      "headRefOid",
      "baseRefName",
      "baseRefOid",
    ] as const) {
      expect(() => parseGitHubPullRequest(JSON.stringify({ ...required, [field]: "" }))).toThrow(
        `invalid ${field}`,
      );
      expect(() => parseGitHubPullRequest(JSON.stringify({ ...required, [field]: 1 }))).toThrow(
        `invalid ${field}`,
      );
    }
  });

  it("validates and normalizes every check field", () => {
    expect(parseGitHubPrChecks("")).toEqual([]);
    expect(() => parseGitHubPrChecks("{}")).toThrow("non-array JSON");
    expect(() => parseGitHubPrChecks("[null]")).toThrow("checks[0] is invalid");
    expect(() => parseGitHubPrChecks('[{"bucket":"mystery"}]')).toThrow(
      "checks[0].bucket is invalid",
    );
    expect(
      parseGitHubPrChecks(
        JSON.stringify([
          { bucket: "pass" },
          { bucket: "cancel", name: 7, state: 8, link: 9, workflow: 10 },
        ]),
      ),
    ).toEqual([
      { bucket: "pass", name: "check-1", state: "UNKNOWN", link: "", workflow: "" },
      { bucket: "cancel", name: "check-2", state: "UNKNOWN", link: "", workflow: "" },
    ]);
  });

  it("gives failure precedence and distinguishes queued from running checks", () => {
    const check = (bucket: "pass" | "fail" | "pending" | "skipping" | "cancel", state: string) => ({
      bucket,
      name: "ci",
      state,
      link: "",
      workflow: "CI",
    });
    expect(aggregateGitHubChecks([check("pending", "QUEUED"), check("fail", "FAILURE")])).toBe(
      "fail",
    );
    expect(aggregateGitHubChecks([check("cancel", "CANCELLED")])).toBe("fail");
    expect(aggregateGitHubChecks([check("pending", "EXPECTED")])).toBe("queued");
    expect(aggregateGitHubChecks([check("pending", "WAITING")])).toBe("queued");
    expect(aggregateGitHubChecks([check("pending", "QUEUED"), check("pending", "RUNNING")])).toBe(
      "pending",
    );
    expect(aggregateGitHubChecks([check("skipping", "SKIPPED")])).toBe("pass");
  });
});
