import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { qd, root } from "./cli-e2e-fixtures.js";

export async function setupGithubNode(id: string): Promise<void> {
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

export async function installFakeGh(
  options: {
    behind?: number;
    checkBucket?: "pass" | "fail" | "pending";
    checkState?: string;
    mergeGroupCheckBucket?: "pass" | "fail" | "pending";
    queueEnabled?: boolean;
    requiredEmpty?: boolean;
    failView?: boolean;
  } = {},
): Promise<void> {
  const bin = path.join(root, "fake-bin");
  const mergedMarker = path.join(root, "pr-merged");
  const queuedMarker = path.join(root, "pr-queued");
  const checkRunStatus =
    options.checkBucket === "pending"
      ? options.checkState === "QUEUED"
        ? "queued"
        : "in_progress"
      : "completed";
  const checkRunConclusion =
    options.checkBucket === "pending"
      ? null
      : options.checkBucket === "fail"
        ? "failure"
        : "success";
  const checkRunsResponse = JSON.stringify([
    {
      check_runs: ["ci", "alpha-proof"].map((name) => ({
        name,
        status: checkRunStatus,
        conclusion: checkRunConclusion,
        details_url: `https://example.test/${name}`,
        started_at: "2026-07-10T00:00:00Z",
        completed_at: checkRunStatus === "completed" ? "2026-07-10T00:01:00Z" : null,
        app: { id: 1, slug: "github-actions" },
      })),
    },
  ]);
  const mergeGroupConclusion =
    options.mergeGroupCheckBucket === "fail"
      ? "failure"
      : options.mergeGroupCheckBucket === "pending"
        ? null
        : "success";
  const mergeGroupStatus =
    options.mergeGroupCheckBucket === "pending" ? "in_progress" : "completed";
  const mergeGroupCheckRunsResponse = JSON.stringify([
    {
      check_runs: ["ci", "alpha-proof"].map((name) => ({
        name,
        status: mergeGroupStatus,
        conclusion: mergeGroupConclusion,
        details_url: `https://example.test/merge-group/${name}`,
        started_at: "2026-07-10T00:02:00Z",
        completed_at: mergeGroupStatus === "completed" ? "2026-07-10T00:03:00Z" : null,
        app: { id: 1, slug: "github-actions" },
      })),
    },
  ]);
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
if [ "$1 $2" = "api graphql" ]; then
  if ${options.queueEnabled ? "true" : "false"}; then
    if [ -f "${queuedMarker}" ] && [ ! -f "${mergedMarker}" ]; then
      printf '{"data":{"repository":{"pullRequest":{"isInMergeQueue":true,"isMergeQueueEnabled":true,"autoMergeRequest":{"enabledAt":"2026-07-10T12:00:00Z","mergeMethod":"SQUASH"},"mergeQueueEntry":{"id":"MQE_17","position":2,"state":"AWAITING_CHECKS","enqueuedAt":"2026-07-10T12:00:00Z","estimatedTimeToMerge":60,"headCommit":{"oid":"merge-group-sha"},"baseCommit":{"oid":"base123"},"mergeQueue":{"url":"https://github.com/owner/repo/queue/main"}}}}}}\n'
    else
      printf '{"data":{"repository":{"pullRequest":{"isInMergeQueue":false,"isMergeQueueEnabled":true,"autoMergeRequest":null,"mergeQueueEntry":null}}}}\n'
    fi
  else
    printf '{"data":{"repository":{"pullRequest":{"isInMergeQueue":false,"isMergeQueueEnabled":false,"autoMergeRequest":null,"mergeQueueEntry":null}}}}\n'
  fi
  exit 0
fi
if [ "$1" = "api" ] && [[ "$*" == *"/rules/branches/"* ]]; then
  if ${options.requiredEmpty ? "true" : "false"}; then printf '[]\n'; exit 0; fi
  printf '[{"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":false,"required_status_checks":[{"context":"ci","integration_id":null},{"context":"alpha-proof","integration_id":null}]}}${options.queueEnabled ? ',{"type":"merge_queue","parameters":{"merge_method":"SQUASH"}}' : ""}]\n'
  exit 0
fi
if [ "$1" = "api" ] && [[ "$*" == *"/protection/required_status_checks"* ]]; then
  printf 'Branch not protected (HTTP 404)\n' >&2
  exit 1
fi
if [ "$1" = "api" ] && [[ "$*" == *"/check-runs"* ]]; then
  if [[ "$*" == *"merge-group-sha"* ]]; then
    printf '%s\n' '${mergeGroupCheckRunsResponse}'
  else
    printf '%s\n' '${checkRunsResponse}'
  fi
  exit 0
fi
if [ "$1" = "api" ] && [[ "$*" == *"/statuses"* ]]; then
  printf '[[]]\n'
  exit 0
fi
if [ "$1" = "api" ]; then
  printf '${options.behind ?? 0}\n'
  exit 0
fi
if [ "$1 $2" = "pr merge" ]; then
  if ${options.queueEnabled ? "true" : "false"}; then touch "${queuedMarker}"; else touch "${mergedMarker}"; fi
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
