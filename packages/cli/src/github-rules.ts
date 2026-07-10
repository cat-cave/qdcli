import { captureCommand } from "./shell.js";
import type { GitHubPrCheck } from "./github-pr-model.js";

export interface GitHubRequiredCheck {
  context: string;
  integrationId: number | null;
}

export interface GitHubBranchPolicy {
  source: "ruleset" | "branch-protection" | "none";
  requiredChecks: GitHubRequiredCheck[];
  strict: boolean;
  mergeQueueEnabled: boolean;
}

interface GitHubCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string;
  appId: number | null;
  appName: string;
  startedAt: string;
  completedAt: string;
}

interface GitHubCommitStatus {
  context: string;
  state: string;
  targetUrl: string;
  updatedAt: string;
}

export async function githubBranchPolicy(
  root: string,
  repository: string,
  branch: string,
): Promise<GitHubBranchPolicy> {
  const rules = await captureCommand(
    "gh",
    ["api", "--method", "GET", `repos/${repository}/rules/branches/${encodeURIComponent(branch)}`],
    root,
  );
  if (rules.code === 0) {
    const policy = parseAppliedBranchRules(rules.stdout);
    if (policy.requiredChecks.length > 0 || policy.mergeQueueEnabled) return policy;
  }

  const protection = await captureCommand(
    "gh",
    [
      "api",
      "--method",
      "GET",
      `repos/${repository}/branches/${encodeURIComponent(branch)}/protection/required_status_checks`,
    ],
    root,
  );
  if (protection.code === 0) return parseClassicBranchProtection(protection.stdout);
  if (isNotFound(protection.stderr, protection.stdout)) {
    return {
      source: "none",
      requiredChecks: [],
      strict: false,
      mergeQueueEnabled: false,
    };
  }
  if (rules.code !== 0) {
    throw new Error(`Unable to read GitHub branch rules: ${rules.stderr || rules.stdout}`);
  }
  throw new Error(
    `Unable to read GitHub branch protection: ${protection.stderr || protection.stdout}`,
  );
}

export async function githubRequiredChecksForCommit(
  root: string,
  repository: string,
  sha: string,
  requiredChecks: GitHubRequiredCheck[],
): Promise<GitHubPrCheck[]> {
  if (requiredChecks.length === 0) return [];
  const [checkRunsResult, statusesResult] = await Promise.all([
    captureCommand(
      "gh",
      [
        "api",
        "--method",
        "GET",
        `repos/${repository}/commits/${sha}/check-runs`,
        "-f",
        "per_page=100",
        "--paginate",
        "--slurp",
      ],
      root,
    ),
    captureCommand(
      "gh",
      [
        "api",
        "--method",
        "GET",
        `repos/${repository}/commits/${sha}/statuses`,
        "-f",
        "per_page=100",
        "--paginate",
        "--slurp",
      ],
      root,
    ),
  ]);
  if (checkRunsResult.code !== 0) {
    throw new Error(
      `Unable to read GitHub check runs for ${sha}: ${checkRunsResult.stderr || checkRunsResult.stdout}`,
    );
  }
  if (statusesResult.code !== 0) {
    throw new Error(
      `Unable to read GitHub commit statuses for ${sha}: ${statusesResult.stderr || statusesResult.stdout}`,
    );
  }
  return evaluateRequiredChecks(
    requiredChecks,
    parseCheckRuns(checkRunsResult.stdout),
    parseCommitStatuses(statusesResult.stdout),
  );
}

export function parseAppliedBranchRules(stdout: string): GitHubBranchPolicy {
  const value = JSON.parse(stdout || "[]") as unknown;
  if (!Array.isArray(value)) throw new Error("GitHub branch rules response must be an array");
  const checks = new Map<string, GitHubRequiredCheck>();
  let strict = false;
  let mergeQueueEnabled = false;
  for (const [index, raw] of value.entries()) {
    const rule = asRecord(raw, `GitHub branch rule ${index + 1}`);
    if (rule.type === "merge_queue") mergeQueueEnabled = true;
    if (rule.type !== "required_status_checks") continue;
    const parameters = asRecord(rule.parameters, "required_status_checks.parameters");
    strict ||= parameters.strict_required_status_checks_policy === true;
    const required = parameters.required_status_checks;
    if (!Array.isArray(required)) {
      throw new Error("required_status_checks.parameters.required_status_checks must be an array");
    }
    for (const rawCheck of required) {
      const check = asRecord(rawCheck, "required status check");
      if (typeof check.context !== "string" || !check.context.trim()) {
        throw new Error("required status check context must be a non-empty string");
      }
      const integrationId =
        typeof check.integration_id === "number" && Number.isInteger(check.integration_id)
          ? check.integration_id
          : null;
      checks.set(`${check.context}\0${integrationId ?? ""}`, {
        context: check.context,
        integrationId,
      });
    }
  }
  return {
    source: "ruleset",
    requiredChecks: [...checks.values()],
    strict,
    mergeQueueEnabled,
  };
}

export function parseClassicBranchProtection(stdout: string): GitHubBranchPolicy {
  const value = asRecord(JSON.parse(stdout), "GitHub branch protection");
  const checks = Array.isArray(value.checks)
    ? value.checks.map((raw) => {
        const check = asRecord(raw, "branch protection check");
        if (typeof check.context !== "string" || !check.context.trim()) {
          throw new Error("branch protection check context must be a non-empty string");
        }
        return {
          context: check.context,
          integrationId:
            typeof check.app_id === "number" && Number.isInteger(check.app_id)
              ? check.app_id
              : null,
        };
      })
    : Array.isArray(value.contexts)
      ? value.contexts.map((context) => {
          if (typeof context !== "string" || !context.trim()) {
            throw new Error("branch protection context must be a non-empty string");
          }
          return { context, integrationId: null };
        })
      : [];
  return {
    source: "branch-protection",
    requiredChecks: checks,
    strict: value.strict === true,
    mergeQueueEnabled: false,
  };
}

export function evaluateRequiredChecks(
  requiredChecks: GitHubRequiredCheck[],
  checkRuns: GitHubCheckRun[],
  statuses: GitHubCommitStatus[],
): GitHubPrCheck[] {
  return requiredChecks.map((required) => {
    const checkRun = checkRuns
      .filter(
        (check) =>
          check.name === required.context &&
          (required.integrationId === null || check.appId === required.integrationId),
      )
      .sort((left, right) => checkRunTime(right).localeCompare(checkRunTime(left)))[0];
    if (checkRun) {
      return {
        bucket: checkRunBucket(checkRun),
        name: required.context,
        state: (checkRun.conclusion ?? checkRun.status).toUpperCase(),
        link: checkRun.detailsUrl,
        workflow: checkRun.appName,
        required: true,
        source: "check-run" as const,
      };
    }
    const status = statuses
      .filter((candidate) => candidate.context === required.context)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (status && required.integrationId === null) {
      return {
        bucket: statusBucket(status.state),
        name: required.context,
        state: status.state.toUpperCase(),
        link: status.targetUrl,
        workflow: "commit-status",
        required: true,
        source: "status" as const,
      };
    }
    return {
      bucket: "pending",
      name: required.context,
      state: "EXPECTED",
      link: "",
      workflow: "required-by-branch-policy",
      required: true,
      source: "missing" as const,
    };
  });
}

function parseCheckRuns(stdout: string): GitHubCheckRun[] {
  const pages = normalizePages(JSON.parse(stdout || "[]"));
  const values = pages.flatMap((page) => {
    const record = asRecord(page, "GitHub check runs page");
    return Array.isArray(record.check_runs) ? record.check_runs : [];
  });
  return values.map((raw, index) => {
    const value = asRecord(raw, `GitHub check run ${index + 1}`);
    const app =
      value.app && typeof value.app === "object" ? asRecord(value.app, "check run app") : {};
    return {
      name: requiredString(value.name, "check run name"),
      status: typeof value.status === "string" ? value.status : "queued",
      conclusion: typeof value.conclusion === "string" ? value.conclusion : null,
      detailsUrl: typeof value.details_url === "string" ? value.details_url : "",
      appId: typeof app.id === "number" && Number.isInteger(app.id) ? app.id : null,
      appName:
        typeof app.slug === "string"
          ? app.slug
          : typeof app.name === "string"
            ? app.name
            : "check-run",
      startedAt: typeof value.started_at === "string" ? value.started_at : "",
      completedAt: typeof value.completed_at === "string" ? value.completed_at : "",
    };
  });
}

function parseCommitStatuses(stdout: string): GitHubCommitStatus[] {
  return normalizePages(JSON.parse(stdout || "[]"))
    .flatMap((page) => (Array.isArray(page) ? page : []))
    .map((raw, index) => {
      const value = asRecord(raw, `GitHub commit status ${index + 1}`);
      return {
        context: requiredString(value.context, "commit status context"),
        state: typeof value.state === "string" ? value.state : "pending",
        targetUrl: typeof value.target_url === "string" ? value.target_url : "",
        updatedAt: typeof value.updated_at === "string" ? value.updated_at : "",
      };
    });
}

function normalizePages(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("GitHub paginated response must be an array");
  return value;
}

function checkRunBucket(check: GitHubCheckRun): GitHubPrCheck["bucket"] {
  if (check.status !== "completed") {
    return /queued|waiting|requested|pending/i.test(check.status) ? "pending" : "pending";
  }
  if (["success", "neutral", "skipped"].includes(check.conclusion ?? "")) {
    return check.conclusion === "skipped" ? "skipping" : "pass";
  }
  if (check.conclusion === "cancelled") return "cancel";
  return "fail";
}

function statusBucket(state: string): GitHubPrCheck["bucket"] {
  if (state === "success") return "pass";
  if (state === "pending") return "pending";
  return "fail";
}

function checkRunTime(check: GitHubCheckRun): string {
  return check.completedAt || check.startedAt;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

function isNotFound(...messages: string[]): boolean {
  return messages.some((message) => /404|not found|branch not protected/i.test(message));
}
