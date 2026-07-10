import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addNode,
  defaultConfig,
  getNode,
  setupProject,
  updateNode,
  writeConfig,
  type QdNode,
} from "@cat-cave/qdcli-core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  githubPrStatus,
  githubRepository,
  linkNodePullRequest,
  mergeGitHubPullRequest,
  tryAutoLinkPullRequest,
  updateGitHubPullRequestBranch,
} from "./github-pr.js";

let root = "";
let previousPath: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "qd-github-pr-"));
  previousPath = process.env.PATH;
  await setupProject(root);
  await writeConfig(root, {
    ...defaultConfig,
    ciProvider: "github",
    ciRepo: "owner/repo",
  });
  await installFakeGh();
  delete process.env.QD_FAKE_GH_MODE;
});

afterEach(async () => {
  process.env.PATH = previousPath;
  delete process.env.QD_FAKE_GH_MODE;
  await rm(root, { recursive: true, force: true });
});

async function node(id = "node-a", branch: string | null = "spec/node-a"): Promise<QdNode> {
  return addNode(root, {
    id,
    title: id,
    spec: "Exercise GitHub PR integration.",
    acceptance: "GitHub state is observed, not asserted.",
    status: "review",
    ...(branch ? {} : {}),
  }).then(async (created) => {
    if (branch === null) return created;
    return updateNode(root, id, { branch });
  });
}

describe("GitHub PR adapter", () => {
  it("validates repository configuration and honors an explicit override", () => {
    expect(githubRepository({ ...defaultConfig, ciRepo: "owner/repo" })).toBe("owner/repo");
    expect(githubRepository({ ...defaultConfig, ciRepo: "owner/repo" }, "other/project")).toBe(
      "other/project",
    );
    expect(() => githubRepository({ ...defaultConfig, ciRepo: "" })).toThrow(
      "require --repo or configured ci_repo",
    );
    for (const invalid of ["owner", "owner/repo/extra", "owner /repo", "/repo", "owner/"]) {
      expect(() => githubRepository(defaultConfig, invalid)).toThrow("owner/name format");
    }
  });

  it("resolves by branch, persists PR identity, and can perform a read-only lookup", async () => {
    const created = await node();
    const status = await githubPrStatus(root, created);
    expect(status).toEqual(
      expect.objectContaining({
        ok: true,
        nodeId: "node-a",
        ledgerStatus: "review",
        repository: "owner/repo",
        requiredChecksOnly: true,
        checkState: "pass",
        glyph: "✓",
        behind: 0,
        mergeable: true,
        readyToMerge: true,
        evidenceUrl: "https://github.com/owner/repo/pull/17/checks",
      }),
    );
    expect(await getNode(root, "node-a")).toMatchObject({
      pr_number: 17,
      pr_url: "https://github.com/owner/repo/pull/17",
    });

    const readOnly = await node("read-only");
    await githubPrStatus(root, readOnly, { persist: false });
    expect(await getNode(root, "read-only")).toMatchObject({ pr_number: null, pr_url: null });
  });

  it("falls back to all checks when no required check set exists", async () => {
    process.env.QD_FAKE_GH_MODE = "required-empty";
    const status = await githubPrStatus(root, await node());
    expect(status.requiredChecksOnly).toBe(false);
    expect(status.checks.map((check) => check.name)).toEqual(["all-ci"]);
    expect(status.checkState).toBe("pass");

    process.env.QD_FAKE_GH_MODE = "all-checks-error-output";
    const noChecks = await githubPrStatus(root, await node("all-error-output"));
    expect(noChecks).toMatchObject({
      ok: false,
      requiredChecksOnly: false,
      checks: [],
      checkState: "no_checks",
    });
  });

  it("surfaces check, compare, and PR lookup failures", async () => {
    for (const [mode, message] of [
      ["view-fail", "Unable to resolve GitHub PR"],
      ["checks-invalid", "non-array JSON"],
      ["all-checks-fail", "gh pr checks failed: checks unavailable"],
      ["compare-fail", "Unable to calculate PR drift: compare unavailable"],
      ["compare-invalid", "invalid behind count: no-number"],
      ["compare-negative", "invalid behind count: -1"],
    ]) {
      process.env.QD_FAKE_GH_MODE = mode;
      await expect(githubPrStatus(root, await node(`node-${mode}`))).rejects.toThrow(message);
    }
  });

  it("computes mergeability from every PR guard", async () => {
    for (const mode of ["draft", "closed", "conflicting", "dirty", "draft-state"] as const) {
      process.env.QD_FAKE_GH_MODE = mode;
      const status = await githubPrStatus(root, await node(`node-${mode}`));
      expect(status.mergeable).toBe(false);
      expect(status.readyToMerge).toBe(false);
    }
    process.env.QD_FAKE_GH_MODE = "behind";
    const behind = await githubPrStatus(root, await node("node-behind"));
    expect(behind).toMatchObject({ checkState: "pass", mergeable: true, behind: 3 });
    expect(behind.readyToMerge).toBe(false);
    process.env.QD_FAKE_GH_MODE = "checks-pending";
    const pending = await githubPrStatus(root, await node("node-pending"));
    expect(pending).toMatchObject({ checkState: "pending", mergeable: true, behind: 0 });
    expect(pending.readyToMerge).toBe(false);
  });

  it("links explicit PRs and rejects a branch mismatch or missing reference", async () => {
    const linked = await linkNodePullRequest(root, (await node()).id, "17");
    expect(linked).toMatchObject({ pr_number: 17, pr_url: expect.stringContaining("/pull/17") });
    process.env.QD_FAKE_GH_MODE = "branch-mismatch";
    await expect(linkNodePullRequest(root, "node-a", "17")).rejects.toThrow(
      "does not match node branch spec/node-a",
    );
    const noReference = await node("no-reference", null);
    await expect(githubPrStatus(root, noReference)).rejects.toThrow(
      "has no PR or branch. Use qd node set-pr no-reference",
    );
  });

  it("auto-links only eligible nodes and treats lookup failure as non-fatal", async () => {
    const created = await node();
    const linked = await tryAutoLinkPullRequest(root, created.id);
    expect(linked).toMatchObject({ pr_number: 17 });
    process.env.QD_FAKE_GH_MODE = "view-fail";
    expect(await tryAutoLinkPullRequest(root, created.id)).toEqual(linked);
    const failed = await node("auto-failed");
    expect(await tryAutoLinkPullRequest(root, failed.id)).toMatchObject({ pr_number: null });
    const noBranch = await node("auto-no-branch", null);
    expect(await tryAutoLinkPullRequest(root, noBranch.id)).toMatchObject({ pr_number: null });
    await writeConfig(root, { ...defaultConfig, ciProvider: "none", ciRepo: "owner/repo" });
    const disabled = await node("auto-disabled");
    expect(await tryAutoLinkPullRequest(root, disabled.id)).toMatchObject({ pr_number: null });
    await writeConfig(root, { ...defaultConfig, ciProvider: "github", ciRepo: "" });
    const noRepo = await node("auto-no-repo");
    expect(await tryAutoLinkPullRequest(root, noRepo.id)).toMatchObject({ pr_number: null });
  });

  it("returns an already-merged commit and rejects merged PRs without one", async () => {
    process.env.QD_FAKE_GH_MODE = "merged";
    await expect(mergeGitHubPullRequest(root, await node(), "squash")).resolves.toMatchObject({
      commitSha: "def5678",
      repository: "owner/repo",
      alreadyMerged: true,
      pr: { state: "MERGED" },
    });
    process.env.QD_FAKE_GH_MODE = "merged-no-sha";
    await expect(mergeGitHubPullRequest(root, await node("missing-sha"), "merge")).rejects.toThrow(
      "has no merge commit SHA",
    );
  });

  it("reports merge and update-branch command failures with stderr evidence", async () => {
    process.env.QD_FAKE_GH_MODE = "merge-fail";
    await expect(mergeGitHubPullRequest(root, await node(), "rebase")).rejects.toThrow(
      "gh pr merge failed: merge rejected",
    );
    process.env.QD_FAKE_GH_MODE = "update-fail";
    const status = await githubPrStatus(root, await node("update-node"));
    await expect(updateGitHubPullRequestBranch(root, status, true)).rejects.toThrow(
      "gh pr update-branch failed: update rejected",
    );
    process.env.QD_FAKE_GH_MODE = "update-fail-stdout";
    const stdoutStatus = await githubPrStatus(root, await node("update-stdout"));
    await expect(updateGitHubPullRequestBranch(root, stdoutStatus, false)).rejects.toThrow(
      "gh pr update-branch failed: update stdout",
    );
  });

  it("waits for a newly merged PR and distinguishes it from an already-merged rerun", async () => {
    process.env.QD_FAKE_GH_MODE = "merge-success";
    await expect(
      mergeGitHubPullRequest(root, await node(), "squash", { timeoutSeconds: 5 }),
    ).resolves.toMatchObject({
      commitSha: "def5678",
      alreadyMerged: false,
      pr: { state: "MERGED", mergeCommit: { oid: "def5678" } },
    });
  });
});

async function installFakeGh(): Promise<void> {
  const bin = path.join(root, "bin");
  const mergedMarker = path.join(root, "merged");
  await mkdir(bin, { recursive: true });
  const script = `#!/usr/bin/env bash
set -eu
mode="\${QD_FAKE_GH_MODE:-normal}"
if [ "$1 $2" = "pr view" ]; then
  if [ "$mode" = "view-fail" ]; then printf 'PR unavailable\n' >&2; exit 1; fi
  head=spec/node-a
  case "$mode" in branch-mismatch) head=other-branch ;; esac
  case "$3" in
    spec/*) head="$3" ;;
  esac
  state=OPEN
  draft=false
  mergeable=MERGEABLE
  merge_state=CLEAN
  merged_at=null
  merge_commit=null
  case "$mode" in
    merged) state=MERGED; merged_at='"2026-07-10T12:00:00Z"'; merge_commit='{"oid":"def5678"}' ;;
    merged-no-sha) state=MERGED; merged_at='"2026-07-10T12:00:00Z"'; merge_commit=null ;;
    draft) draft=true ;;
    closed) state=CLOSED ;;
    conflicting) mergeable=CONFLICTING ;;
    dirty) merge_state=DIRTY ;;
    draft-state) merge_state=DRAFT ;;
  esac
  if [ -f "${mergedMarker}" ]; then state=MERGED; merged_at='"2026-07-10T12:00:00Z"'; merge_commit='{"oid":"def5678"}'; fi
  printf '{"number":17,"url":"https://github.com/owner/repo/pull/17","headRefName":"%s","headRefOid":"abc1234","baseRefName":"main","baseRefOid":"base123","mergeable":"%s","mergeStateStatus":"%s","isDraft":%s,"state":"%s","mergedAt":%s,"mergeCommit":%s}\n' "$head" "$mergeable" "$merge_state" "$draft" "$state" "$merged_at" "$merge_commit"
  exit 0
fi
if [ "$1 $2" = "pr checks" ]; then
  required=false
  for arg in "$@"; do if [ "$arg" = "--required" ]; then required=true; fi; done
  if [ "$mode" = "checks-invalid" ]; then printf '{}\n'; exit 0; fi
  if [ "$mode" = "required-empty" ] && [ "$required" = true ]; then printf '[]\n'; exit 0; fi
  if [ "$mode" = "all-checks-fail" ]; then printf 'checks unavailable\n' >&2; exit 2; fi
  if [ "$mode" = "all-checks-error-output" ]; then
    if [ "$required" = true ]; then printf '[]\n'; exit 0; fi
    printf '[]\n'; printf 'warning\n' >&2; exit 2
  fi
  if [ "$mode" = "checks-pending" ]; then printf '[{"bucket":"pending","name":"ci","state":"IN_PROGRESS","link":"https://example.test/ci","workflow":"CI"}]\n'; exit 0; fi
  name=ci
  if [ "$mode" = "required-empty" ]; then name=all-ci; fi
  printf '[{"bucket":"pass","name":"%s","state":"SUCCESS","link":"https://example.test/ci","workflow":"CI"}]\n' "$name"
  exit 0
fi
if [ "$1" = "api" ]; then
  case "$mode" in
    compare-fail) printf 'compare unavailable\n' >&2; exit 1 ;;
    compare-invalid) printf 'no-number\n'; exit 0 ;;
    compare-negative) printf '%s\n' -1; exit 0 ;;
    behind) printf '%s\n' 3; exit 0 ;;
  esac
  printf '%s\n' 0
  exit 0
fi
if [ "$1 $2" = "pr merge" ]; then
  if [ "$mode" = "merge-fail" ]; then printf 'merge rejected\n' >&2; exit 1; fi
  if [ "$mode" = "merge-success" ]; then touch "${mergedMarker}"; exit 0; fi
  exit 0
fi
if [ "$1 $2" = "pr update-branch" ]; then
  if [ "$mode" = "update-fail" ]; then printf 'update rejected\n' >&2; exit 1; fi
  if [ "$mode" = "update-fail-stdout" ]; then printf 'update stdout\n'; exit 1; fi
  exit 0
fi
exit 2
`;
  const executable = path.join(bin, "gh");
  await writeFile(executable, script, "utf8");
  await chmod(executable, 0o755);
  process.env.PATH = `${bin}:${previousPath ?? ""}`;
}
