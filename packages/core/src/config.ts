export interface QdConfig {
  schemaVersion: number;
  skillsDir: string;
  checkCommand: string;
  ciCommand: string;
  ciProvider: "none" | "github";
  ciRepo: string;
  ciWorkflow: string;
  ciAuth: "gh-cli";
  mergeStrategy: "squash" | "merge" | "rebase";
  requireCleanWorktree: boolean;
  cleanWorktreeExcept: string[];
  requireGateBeforeCi: boolean;
  requireCiBeforeMerge: boolean;
  exportDefaultOut: string;
  exportCanonicalizeCommand: string;
  hooks: {
    preClaim: string;
    postClaim: string;
    preCheck: string;
    postCheck: string;
    preGate: string;
    postExport: string;
    preMerge: string;
    postMerge: string;
  };
  checkTimeoutSeconds: number;
  checkNoOutputTimeoutSeconds: number;
  ciTimeoutSeconds: number;
  ciNoOutputTimeoutSeconds: number;
  forbiddenPathGlobs: string[];
  maskedEnv: string[];
  broadAuditEvery: number;
  deepAuditEvery: number;
  policy: {
    requireAuditBeforeCi: boolean;
    requireVerificationBeforeCi: boolean;
    requireP2P3DispositionBeforeMerge: boolean;
    requireMergeCommit: boolean;
  };
  worktree: {
    baseDir: string;
    envTemplate: string;
    envFile: string;
  };
}

export const defaultConfig: QdConfig = {
  schemaVersion: 1,
  skillsDir: ".qd/skills",
  checkCommand: "",
  ciCommand: "",
  ciProvider: "none",
  ciRepo: "",
  ciWorkflow: "",
  ciAuth: "gh-cli",
  mergeStrategy: "squash",
  requireCleanWorktree: true,
  cleanWorktreeExcept: [".qd/"],
  requireGateBeforeCi: true,
  requireCiBeforeMerge: true,
  exportDefaultOut: "",
  exportCanonicalizeCommand: "",
  hooks: {
    preClaim: "",
    postClaim: "",
    preCheck: "",
    postCheck: "",
    preGate: "",
    postExport: "",
    preMerge: "",
    postMerge: "",
  },
  checkTimeoutSeconds: 1200,
  checkNoOutputTimeoutSeconds: 300,
  ciTimeoutSeconds: 3600,
  ciNoOutputTimeoutSeconds: 600,
  forbiddenPathGlobs: [".env", ".env.*", "**/.env", "**/.env.*"],
  maskedEnv: [],
  broadAuditEvery: 3,
  deepAuditEvery: 9,
  policy: {
    requireAuditBeforeCi: true,
    requireVerificationBeforeCi: true,
    requireP2P3DispositionBeforeMerge: true,
    requireMergeCommit: true,
  },
  worktree: {
    baseDir: ".qd/worktrees",
    envTemplate: "",
    envFile: ".env",
  },
};

export function parseConfig(content: string): QdConfig {
  const values: Record<string, string | boolean | number | string[]> = {};
  const allowedKeys = new Set([
    "schema_version",
    "skills_dir",
    "check_command",
    "ci_command",
    "ci_provider",
    "ci_repo",
    "ci_workflow",
    "ci_auth",
    "merge_strategy",
    "require_clean_worktree",
    "clean_worktree_except",
    "require_gate_before_ci",
    "require_ci_before_merge",
    "export_default_out",
    "export_canonicalize_command",
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
    "secrets_forbidden_path_globs",
    "secrets_masked_env",
    "waves_broad_audit_every",
    "waves_deep_audit_every",
    "policy_require_audit_before_ci",
    "policy_require_verification_before_ci",
    "policy_require_p2_p3_disposition_before_merge",
    "policy_require_merge_commit",
    "worktree_base_dir",
    "worktree_env_template",
    "worktree_env_file",
  ]);
  let section = "";
  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const sectionMatch = /^\[(?<section>[a-zA-Z0-9_]+)\]$/.exec(line);
    if (sectionMatch?.groups?.section) {
      section = sectionMatch.groups.section;
      continue;
    }
    const match = /^([a-zA-Z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!match) throw new Error(`line ${index + 1} is not a supported key = value assignment`);
    const rawKey = match[1];
    const rawValue = match[2];
    if (!rawKey || !rawValue) throw new Error(`line ${index + 1} is missing a key or value`);
    const key = section ? `${section}_${rawKey}` : rawKey;
    if (!allowedKeys.has(key)) throw new Error(`unknown config key: ${key}`);
    values[key] = parseTomlValue(rawValue.trim());
  }

  return {
    schemaVersion: requiredNumberValue(values, "schema_version"),
    skillsDir: requiredStringValue(values, "skills_dir"),
    checkCommand: requiredStringValue(values, "check_command", true),
    ciCommand: requiredStringValue(values, "ci_command", true),
    ciProvider: requiredCiProviderValue(values, "ci_provider"),
    ciRepo: requiredStringValue(values, "ci_repo", true),
    ciWorkflow: requiredStringValue(values, "ci_workflow", true),
    ciAuth: requiredCiAuthValue(values, "ci_auth"),
    mergeStrategy: requiredMergeStrategyValue(values, "merge_strategy"),
    requireCleanWorktree: requiredBooleanValue(values, "require_clean_worktree"),
    cleanWorktreeExcept: requiredStringArrayValue(values, "clean_worktree_except"),
    requireGateBeforeCi: requiredBooleanValue(values, "require_gate_before_ci"),
    requireCiBeforeMerge: requiredBooleanValue(values, "require_ci_before_merge"),
    exportDefaultOut: optionalStringValue(values, "export_default_out"),
    exportCanonicalizeCommand: optionalStringValue(values, "export_canonicalize_command"),
    hooks: {
      preClaim: optionalStringValue(values, "hooks_pre_claim"),
      postClaim: optionalStringValue(values, "hooks_post_claim"),
      preCheck: optionalStringValue(values, "hooks_pre_check"),
      postCheck: optionalStringValue(values, "hooks_post_check"),
      preGate: optionalStringValue(values, "hooks_pre_gate"),
      postExport: optionalStringValue(values, "hooks_post_export"),
      preMerge: optionalStringValue(values, "hooks_pre_merge"),
      postMerge: optionalStringValue(values, "hooks_post_merge"),
    },
    checkTimeoutSeconds: optionalNumberValue(values, "check_timeout_seconds", 1200),
    checkNoOutputTimeoutSeconds: optionalNumberValue(
      values,
      "check_no_output_timeout_seconds",
      300,
    ),
    ciTimeoutSeconds: optionalNumberValue(values, "ci_timeout_seconds", 3600),
    ciNoOutputTimeoutSeconds: optionalNumberValue(values, "ci_no_output_timeout_seconds", 600),
    forbiddenPathGlobs: optionalStringArrayValue(values, "secrets_forbidden_path_globs", [
      ".env",
      ".env.*",
      "**/.env",
      "**/.env.*",
    ]),
    maskedEnv: optionalStringArrayValue(values, "secrets_masked_env", []),
    broadAuditEvery: optionalNumberValue(values, "waves_broad_audit_every", 3),
    deepAuditEvery: optionalNumberValue(values, "waves_deep_audit_every", 9),
    policy: {
      requireAuditBeforeCi: optionalBooleanValue(values, "policy_require_audit_before_ci", true),
      requireVerificationBeforeCi: optionalBooleanValue(
        values,
        "policy_require_verification_before_ci",
        true,
      ),
      requireP2P3DispositionBeforeMerge: optionalBooleanValue(
        values,
        "policy_require_p2_p3_disposition_before_merge",
        true,
      ),
      requireMergeCommit: optionalBooleanValue(values, "policy_require_merge_commit", true),
    },
    worktree: {
      baseDir: optionalStringValue(values, "worktree_base_dir") || ".qd/worktrees",
      envTemplate: optionalStringValue(values, "worktree_env_template"),
      envFile: optionalStringValue(values, "worktree_env_file") || ".env",
    },
  };
}

export function formatConfig(config: QdConfig): string {
  return `# qdcli repo-local configuration
# qd expects one canonical command that means "this node is safe to merge".
schema_version = ${config.schemaVersion}
skills_dir = "${config.skillsDir}"
check_command = "${escapeTomlString(config.checkCommand)}"
ci_command = "${escapeTomlString(config.ciCommand)}"
ci_provider = "${config.ciProvider}"
ci_repo = "${escapeTomlString(config.ciRepo)}"
ci_workflow = "${escapeTomlString(config.ciWorkflow)}"
ci_auth = "${config.ciAuth}"
merge_strategy = "${config.mergeStrategy}"
require_clean_worktree = ${config.requireCleanWorktree}
clean_worktree_except = [${config.cleanWorktreeExcept.map((item) => `"${escapeTomlString(item)}"`).join(", ")}]
require_gate_before_ci = ${config.requireGateBeforeCi}
require_ci_before_merge = ${config.requireCiBeforeMerge}

[export]
default_out = "${escapeTomlString(config.exportDefaultOut)}"
canonicalize_command = "${escapeTomlString(config.exportCanonicalizeCommand)}"

[hooks]
pre_claim = "${escapeTomlString(config.hooks.preClaim)}"
post_claim = "${escapeTomlString(config.hooks.postClaim)}"
pre_check = "${escapeTomlString(config.hooks.preCheck)}"
post_check = "${escapeTomlString(config.hooks.postCheck)}"
pre_gate = "${escapeTomlString(config.hooks.preGate)}"
post_export = "${escapeTomlString(config.hooks.postExport)}"
pre_merge = "${escapeTomlString(config.hooks.preMerge)}"
post_merge = "${escapeTomlString(config.hooks.postMerge)}"

[check]
timeout_seconds = ${config.checkTimeoutSeconds}
no_output_timeout_seconds = ${config.checkNoOutputTimeoutSeconds}

[ci]
timeout_seconds = ${config.ciTimeoutSeconds}
no_output_timeout_seconds = ${config.ciNoOutputTimeoutSeconds}

[secrets]
forbidden_path_globs = [${config.forbiddenPathGlobs.map((item) => `"${escapeTomlString(item)}"`).join(", ")}]
masked_env = [${config.maskedEnv.map((item) => `"${escapeTomlString(item)}"`).join(", ")}]

[waves]
broad_audit_every = ${config.broadAuditEvery}
deep_audit_every = ${config.deepAuditEvery}

[policy]
require_audit_before_ci = ${config.policy.requireAuditBeforeCi}
require_verification_before_ci = ${config.policy.requireVerificationBeforeCi}
require_p2_p3_disposition_before_merge = ${config.policy.requireP2P3DispositionBeforeMerge}
require_merge_commit = ${config.policy.requireMergeCommit}

[worktree]
base_dir = "${escapeTomlString(config.worktree.baseDir)}"
env_template = "${escapeTomlString(config.worktree.envTemplate)}"
env_file = "${escapeTomlString(config.worktree.envFile)}"
`;
}

function optionalStringValue(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

function requiredStringValue(
  values: Record<string, unknown>,
  key: string,
  allowEmpty = false,
): string {
  const value = values[key];
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  if (!allowEmpty && !value.trim()) throw new Error(`${key} must not be empty`);
  return value;
}

function requiredBooleanValue(values: Record<string, unknown>, key: string): boolean {
  const value = values[key];
  if (typeof value !== "boolean") throw new Error(`${key} must be true or false`);
  return value;
}

function optionalBooleanValue(
  values: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = values[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${key} must be true or false`);
  return value;
}

function requiredStringArrayValue(values: Record<string, unknown>, key: string): string[] {
  const value = values[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${key} must be an array of strings`);
  }
  return value;
}

function optionalStringArrayValue(
  values: Record<string, unknown>,
  key: string,
  fallback: string[],
): string[] {
  const value = values[key];
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${key} must be an array of strings`);
  }
  return value;
}

function requiredNumberValue(values: Record<string, unknown>, key: string): number {
  const value = values[key];
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${key} must be a number`);
  return value;
}

function optionalNumberValue(
  values: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = values[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number`);
  }
  return value;
}

function requiredMergeStrategyValue(
  values: Record<string, unknown>,
  key: string,
): QdConfig["mergeStrategy"] {
  const value = values[key];
  if (value === "squash" || value === "merge" || value === "rebase") return value;
  throw new Error(`${key} must be squash, merge, or rebase`);
}

function requiredCiProviderValue(
  values: Record<string, unknown>,
  key: string,
): QdConfig["ciProvider"] {
  const value = values[key];
  if (value === "none" || value === "github") return value;
  throw new Error(`${key} must be none or github`);
}

function requiredCiAuthValue(values: Record<string, unknown>, key: string): QdConfig["ciAuth"] {
  const value = values[key];
  if (value === "gh-cli") return value;
  throw new Error(`${key} must be gh-cli`);
}

function parseTomlValue(value: string): string | boolean | number | string[] {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (item.startsWith('"') && item.endsWith('"') ? item.slice(1, -1) : item))
      .filter(Boolean);
  }
  return value;
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
