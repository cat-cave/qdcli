export interface GitHubPullRequest {
  number: number;
  url: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  baseRefOid: string;
  mergeable: string;
  mergeStateStatus: string;
  isDraft: boolean;
  state: string;
  mergedAt: string | null;
  mergeCommit: { oid?: string } | null;
}

export interface GitHubPrCheck {
  bucket: "pass" | "fail" | "pending" | "skipping" | "cancel";
  name: string;
  state: string;
  link: string;
  workflow: string;
  required?: boolean;
  source?: "check-run" | "status" | "missing";
}

export type GitHubCheckState = "pass" | "fail" | "pending" | "queued" | "no_checks";

export function prViewArgs(reference: string, repo: string): string[] {
  return [
    "pr",
    "view",
    reference,
    "--repo",
    repo,
    "--json",
    [
      "number",
      "url",
      "headRefName",
      "headRefOid",
      "baseRefName",
      "baseRefOid",
      "mergeable",
      "mergeStateStatus",
      "isDraft",
      "state",
      "mergedAt",
      "mergeCommit",
    ].join(","),
  ];
}

export function prChecksArgs(reference: string, repo: string, requiredOnly: boolean): string[] {
  return [
    "pr",
    "checks",
    reference,
    "--repo",
    repo,
    ...(requiredOnly ? ["--required"] : []),
    "--json",
    "bucket,name,state,link,workflow",
  ];
}

export function prCompareArgs(repo: string, baseOid: string, headOid: string): string[] {
  return ["api", `repos/${repo}/compare/${baseOid}...${headOid}`, "--jq", ".behind_by"];
}

export function prMergeArgs(
  reference: string,
  repo: string,
  strategy: "squash" | "merge" | "rebase",
  headOid: string,
): string[] {
  return [
    "pr",
    "merge",
    reference,
    "--repo",
    repo,
    `--${strategy}`,
    "--match-head-commit",
    headOid,
  ];
}

export function prUpdateBranchArgs(reference: string, repo: string, rebase: boolean): string[] {
  return ["pr", "update-branch", reference, "--repo", repo, ...(rebase ? ["--rebase"] : [])];
}

export function parseGitHubPullRequest(stdout: string): GitHubPullRequest {
  const value = JSON.parse(stdout) as Partial<GitHubPullRequest>;
  if (!Number.isInteger(value.number) || Number(value.number) < 1) {
    throw new Error("gh pr view returned an invalid pull request number");
  }
  return {
    number: Number(value.number),
    url: requiredPrString(value, "url"),
    headRefName: requiredPrString(value, "headRefName"),
    headRefOid: requiredPrString(value, "headRefOid"),
    baseRefName: requiredPrString(value, "baseRefName"),
    baseRefOid: requiredPrString(value, "baseRefOid"),
    mergeable: typeof value.mergeable === "string" ? value.mergeable : "UNKNOWN",
    mergeStateStatus:
      typeof value.mergeStateStatus === "string" ? value.mergeStateStatus : "UNKNOWN",
    isDraft: value.isDraft === true,
    state: typeof value.state === "string" ? value.state : "UNKNOWN",
    mergedAt: typeof value.mergedAt === "string" ? value.mergedAt : null,
    mergeCommit:
      value.mergeCommit && typeof value.mergeCommit === "object" ? value.mergeCommit : null,
  };
}

function requiredPrString(
  value: Partial<GitHubPullRequest>,
  key: "url" | "headRefName" | "headRefOid" | "baseRefName" | "baseRefOid",
): string {
  const field = value[key];
  if (typeof field !== "string" || !field) {
    throw new Error(`gh pr view returned an invalid ${key}`);
  }
  return field;
}

export function parseGitHubPrChecks(stdout: string): GitHubPrCheck[] {
  const value = JSON.parse(stdout || "[]") as unknown;
  if (!Array.isArray(value)) throw new Error("gh pr checks returned non-array JSON");
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`gh pr checks[${index}] is invalid`);
    const check = raw as Record<string, unknown>;
    const bucket = check.bucket;
    if (!["pass", "fail", "pending", "skipping", "cancel"].includes(String(bucket))) {
      throw new Error(`gh pr checks[${index}].bucket is invalid`);
    }
    return {
      bucket: bucket as GitHubPrCheck["bucket"],
      name: typeof check.name === "string" ? check.name : `check-${index + 1}`,
      state: typeof check.state === "string" ? check.state : "UNKNOWN",
      link: typeof check.link === "string" ? check.link : "",
      workflow: typeof check.workflow === "string" ? check.workflow : "",
    };
  });
}

export function aggregateGitHubChecks(checks: GitHubPrCheck[]): GitHubCheckState {
  if (checks.length === 0) return "no_checks";
  if (checks.some((check) => check.bucket === "fail" || check.bucket === "cancel")) return "fail";
  if (checks.some((check) => check.bucket === "pending")) {
    return checks.every(
      (check) => check.bucket !== "pending" || /QUEUED|EXPECTED|WAITING/i.test(check.state),
    )
      ? "queued"
      : "pending";
  }
  return "pass";
}

export function monitorGlyph(state: GitHubCheckState): string {
  if (state === "pass") return "✓";
  if (state === "fail") return "✗";
  if (state === "queued") return "⧗";
  if (state === "pending") return "⏳";
  return "?";
}
