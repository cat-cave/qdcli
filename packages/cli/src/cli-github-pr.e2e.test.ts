import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  expectQdFailure,
  installCliFixture,
  qd,
  qdJson,
  qdJsonAllowExit,
  qdRaw,
  root,
} from "./cli-e2e-fixtures.js";

installCliFixture();

describe("qd GitHub PR integration", () => {
  it("links PRs, verifies aggregate checks, records CI, and merges through gh", async () => {
    const previousPath = process.env.PATH;
    try {
      await installFakeGh();
      await qd("setup", "--no-hooks");
      await qd("method", "acknowledge", "--agent", "test");
      await qd(
        "config",
        "set",
        "ci-provider",
        "github",
        "--repo",
        "owner/repo",
        "--workflow",
        "ci.yml",
        "--auth",
        "gh-cli",
      );
      await qd("config", "set", "policy_require_audit_before_ci", "false");
      await qd("config", "set", "policy_require_verification_before_ci", "false");
      await qd(
        "node",
        "add",
        "--id",
        "pr-node",
        "--title",
        "PR node",
        "--spec",
        "Integrate through a pull request.",
        "--acceptance",
        "The PR is linked, verified, and merged.",
      );
      const claimed = await qdJson(
        "claim",
        "pr-node",
        "--agent",
        "worker",
        "--branch",
        "spec/pr-node",
        "--pr",
        "17",
        "--json",
      );
      expect(claimed).toMatchObject({
        branch: "spec/pr-node",
        pr_number: 17,
        pr_url: "https://github.com/owner/repo/pull/17",
      });

      const status = await qdJson("ci", "status", "pr-node", "--json");
      expect(status).toMatchObject({
        checkState: "pass",
        behind: 0,
        readyToMerge: true,
        requiredChecksOnly: true,
      });
      expect(status.checks.map((check: any) => check.name)).toEqual(["ci", "alpha-proof"]);
      expect((await qdJson("ci", "watch", "pr-node", "--json")).checkState).toBe("pass");
      const humanWatch = await qdRaw(["ci", "watch", "pr-node", "--interval", "1"]);
      expect(humanWatch.exitCode).toBeUndefined();
      expect(humanWatch.stdout).toContain("✓ pr-node PR #17: pass, behind 0, CLEAN");
      expect((await qdJson("monitor", "--json")).nodes).toEqual([
        expect.objectContaining({ nodeId: "pr-node", checkState: "pass" }),
      ]);

      const synced = await qdJson("sync-prs", "--json");
      expect(synced.nodes).toEqual([
        expect.objectContaining({ nodeId: "pr-node", action: "advanced-to-mergeable" }),
      ]);
      expect((await qdJson("sync-prs", "--json")).nodes).toEqual([
        expect.objectContaining({ nodeId: "pr-node", action: "already-mergeable" }),
      ]);

      const recorded = await qdJson(
        "ci",
        "record-pass",
        "pr-node",
        "--provider",
        "github",
        "--json",
      );
      expect(recorded.node.status).toBe("mergeable");
      expect(recorded.observed.pr.headRefOid).toBe("abc1234");
      const mergeQueue = await qdJson("ready", "--mergeable", "--json");
      expect(mergeQueue).toEqual([
        expect.objectContaining({ id: "pr-node", pr: 17, checks: "pass", behind: 0 }),
      ]);
      const mergeDoctor = await qdJsonAllowExit("doctor", "pr-node", "--json");
      expect(mergeDoctor.exitCode).toBe(1);
      expect(mergeDoctor.json).toMatchObject({
        status: "mergeable",
        pullRequest: { behind: 0, readyToMerge: true },
        reasons: [expect.objectContaining({ code: "mergeRecordRequired" })],
        nextActions: ["qd merge pr-node --via-pr"],
      });

      const merged = await qdJson("merge", "pr-node", "--via-pr", "--json");
      expect(merged).toMatchObject({
        status: "done",
        operation: "git-and-ledger",
        gitIntegrated: true,
      });
      expect(merged.pullRequest.state).toBe("MERGED");
      expect(await qdJson("doctor", "pr-node", "--json")).toMatchObject({
        ok: true,
        status: "done",
        reasons: [],
        nextActions: [],
        pullRequest: null,
      });
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("surfaces stale PR drift and can request a rebase", async () => {
    const previousPath = process.env.PATH;
    try {
      await installFakeGh({ behind: 3 });
      await qd("setup", "--no-hooks");
      await qd("method", "acknowledge", "--agent", "test");
      await qd(
        "config",
        "set",
        "ci-provider",
        "github",
        "--repo",
        "owner/repo",
        "--workflow",
        "ci.yml",
        "--auth",
        "gh-cli",
      );
      await qd(
        "node",
        "add",
        "--id",
        "stale-node",
        "--title",
        "Stale node",
        "--spec",
        "Detect stale PR branches.",
        "--acceptance",
        "The behind count and rebase action are visible.",
      );
      await qd("claim", "stale-node", "--agent", "worker", "--branch", "spec/pr-node");
      expect(await qdJson("node", "show", "stale-node", "--json")).toMatchObject({
        pr_number: 17,
        pr_url: "https://github.com/owner/repo/pull/17",
      });
      const doctor = await qdJsonAllowExit("doctor", "stale-node", "--json");
      expect(doctor.exitCode).toBe(1);
      expect(doctor.json.reasons.map((reason: any) => reason.code)).toEqual(
        expect.arrayContaining(["completionRequired", "auditRequired", "staleBase"]),
      );
      expect(doctor.json.pullRequest).toMatchObject({
        behind: 3,
        checkState: "pass",
        pr: { number: 17, baseRefName: "main" },
      });
      expect(doctor.json.nextActions).toEqual(
        expect.arrayContaining([
          "qd complete stale-node --from-report <completion-report.json>",
          "qd sync-prs --rebase",
        ]),
      );
      const policyStopped = await qdJson("sync-prs", "--json");
      expect(policyStopped.nodes).toEqual([
        expect.objectContaining({
          nodeId: "stale-node",
          action: "none",
          status: expect.objectContaining({ readyToMerge: false, behind: 3 }),
          policy: expect.objectContaining({ ok: false }),
        }),
      ]);
      const synced = await qdJson("sync-prs", "--rebase", "--json");
      expect(synced.nodes).toEqual([
        expect.objectContaining({ nodeId: "stale-node", action: "rebase-requested" }),
      ]);
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("reports failed checks consistently across status, monitor, sync, and verified recording", async () => {
    const previousPath = process.env.PATH;
    try {
      await installFakeGh({ checkBucket: "fail", checkState: "FAILURE" });
      await setupGithubNode("failed-checks");

      const status = await qdJsonAllowExit("ci", "status", "failed-checks", "--json");
      expect(status.exitCode).toBe(1);
      expect(status.json).toMatchObject({ ok: false, checkState: "fail", glyph: "✗" });
      const monitor = await qdJsonAllowExit("monitor", "--json");
      expect(monitor.exitCode).toBe(1);
      expect(monitor.json).toMatchObject({
        ok: false,
        nodes: [expect.objectContaining({ nodeId: "failed-checks", checkState: "fail" })],
      });
      const sync = await qdJson("sync-prs", "--json");
      expect(sync).toMatchObject({
        ok: true,
        nodes: [expect.objectContaining({ nodeId: "failed-checks", action: "none" })],
      });
      await expect(
        qdJson("ci", "record-pass", "failed-checks", "--provider", "github", "--json"),
      ).rejects.toThrow(/not concluded-success/);
      const watched = await qdJsonAllowExit("ci", "watch", "failed-checks", "--json");
      expect(watched.exitCode).toBe(1);
      expect(watched.json).toMatchObject({ checkState: "fail", timedOut: false });
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("falls back to all checks, preserves queued state, and validates watch timing", async () => {
    const previousPath = process.env.PATH;
    try {
      await installFakeGh({ requiredEmpty: true, checkBucket: "pending", checkState: "QUEUED" });
      await setupGithubNode("queued-checks");
      const status = await qdJsonAllowExit("ci", "status", "queued-checks", "--json");
      expect(status.exitCode).toBe(8);
      expect(status.json).toMatchObject({
        ok: false,
        requiredChecksOnly: false,
        checkState: "queued",
        glyph: "⧗",
      });
      await expectQdFailure(
        /--interval must be at least 1 second/,
        "ci",
        "watch",
        "queued-checks",
        "--interval",
        "0",
      );
      const watched = await qdJsonAllowExit(
        "ci",
        "watch",
        "queued-checks",
        "--interval",
        "1",
        "--timeout",
        "1",
        "--json",
      );
      expect(watched.exitCode).toBe(8);
      expect(watched.json).toMatchObject({ checkState: "queued", timedOut: true });
      await expectQdFailure(
        /--timeout must be at least 1 second/,
        "ci",
        "watch",
        "queued-checks",
        "--timeout",
        "0",
      );
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("keeps per-node GitHub lookup errors visible in multi-node monitors and sync", async () => {
    const previousPath = process.env.PATH;
    try {
      await installFakeGh({ failView: true });
      await setupGithubNode("unavailable-pr");
      const monitor = await qdJsonAllowExit("monitor", "--json");
      expect(monitor.exitCode).toBe(1);
      expect(monitor.json).toEqual({
        ok: false,
        nodes: [
          {
            nodeId: "unavailable-pr",
            ledgerStatus: "claimed",
            error: expect.stringContaining("Unable to resolve GitHub PR"),
          },
        ],
      });
      const sync = await qdJsonAllowExit("sync-prs", "--json");
      expect(sync.exitCode).toBe(1);
      expect(sync.json).toMatchObject({
        ok: false,
        nodes: [{ nodeId: "unavailable-pr", action: "error" }],
      });
      const doctor = await qdJsonAllowExit("doctor", "unavailable-pr", "--json");
      expect(doctor.exitCode).toBe(1);
      expect(doctor.json).toMatchObject({
        ok: false,
        pullRequest: { error: expect.stringContaining("Unable to resolve GitHub PR") },
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: "completionRequired" }),
          expect.objectContaining({ code: "prStatusUnavailable" }),
        ]),
      });
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("returns clean empty dashboards when no nodes are in flight", async () => {
    const previousPath = process.env.PATH;
    try {
      await installFakeGh();
      await qd("setup", "--no-hooks");
      await qd("method", "acknowledge", "--agent", "test");
      expect(await qdJson("monitor", "--json")).toEqual({ ok: true, nodes: [] });
      expect(await qdJson("sync-prs", "--json")).toEqual({ ok: true, nodes: [] });
      expect(await qdJson("ready", "--mergeable", "--json")).toEqual([]);
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

async function setupGithubNode(id: string): Promise<void> {
  await qd("setup", "--no-hooks");
  await qd("method", "acknowledge", "--agent", "test");
  await qd(
    "config",
    "set",
    "ci-provider",
    "github",
    "--repo",
    "owner/repo",
    "--workflow",
    "ci.yml",
    "--auth",
    "gh-cli",
  );
  await qd("config", "set", "policy_require_audit_before_ci", "false");
  await qd("config", "set", "policy_require_verification_before_ci", "false");
  await qd(
    "node",
    "add",
    "--id",
    id,
    "--title",
    id,
    "--spec",
    "Observe aggregate GitHub PR state.",
    "--acceptance",
    "The observed state controls the ledger.",
  );
  await qd("claim", id, "--agent", "worker", "--branch", "spec/pr-node");
}

async function installFakeGh(
  options: {
    behind?: number;
    checkBucket?: "pass" | "fail" | "pending";
    checkState?: string;
    requiredEmpty?: boolean;
    failView?: boolean;
  } = {},
): Promise<void> {
  const bin = path.join(root, "fake-bin");
  const mergedMarker = path.join(root, "pr-merged");
  await mkdir(bin, { recursive: true });
  const script = `#!/usr/bin/env bash
set -eu
if [ "$1 $2" = "pr view" ]; then
  ${options.failView ? "printf 'PR unavailable\\n' >&2; exit 1" : ""}
  if [ -f "${mergedMarker}" ]; then
    state=MERGED
    merged_at='"2026-07-10T12:00:00Z"'
    merge_commit='{"oid":"def5678"}'
  else
    state=OPEN
    merged_at=null
    merge_commit=null
  fi
  printf '{"number":17,"url":"https://github.com/owner/repo/pull/17","headRefName":"spec/pr-node","headRefOid":"abc1234","baseRefName":"main","baseRefOid":"base123","mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","isDraft":false,"state":"%s","mergedAt":%s,"mergeCommit":%s}\n' "$state" "$merged_at" "$merge_commit"
  exit 0
fi
if [ "$1 $2" = "pr checks" ]; then
  if ${options.requiredEmpty ? "true" : "false"}; then
    for arg in "$@"; do if [ "$arg" = "--required" ]; then printf '[]\n'; exit 0; fi; done
  fi
  printf '[{"bucket":"${options.checkBucket ?? "pass"}","name":"ci","state":"${options.checkState ?? "SUCCESS"}","link":"https://example.test/ci","workflow":"CI"},{"bucket":"${options.checkBucket ?? "pass"}","name":"alpha-proof","state":"${options.checkState ?? "SUCCESS"}","link":"https://example.test/proof","workflow":"Proof"}]\n'
  exit 0
fi
if [ "$1" = "api" ]; then
  printf '${options.behind ?? 0}\n'
  exit 0
fi
if [ "$1 $2" = "pr merge" ]; then
  touch "${mergedMarker}"
  exit 0
fi
if [ "$1 $2" = "pr update-branch" ]; then
  exit 0
fi
printf 'unexpected fake gh invocation: %s\n' "$*" >&2
exit 2
`;
  const executable = path.join(bin, "gh");
  await writeFile(executable, script, "utf8");
  await chmod(executable, 0o755);
  process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
}
