import type { QdConfig } from "@cat-cave/qdcli-core";
import { parseBoolean, parsePositiveInteger, stringOpt } from "./args.js";

export function setConfigValue(config: QdConfig, key: string, value: string): QdConfig {
  if (key === "check_command" || key === "check-command") return { ...config, checkCommand: value };
  if (key === "ci_command" || key === "ci-command") return { ...config, ciCommand: value };
  if (key === "ci_provider" || key === "ci-provider") return setCiProviderConfig(config, value, {});
  if (key === "ci_repo" || key === "ci-repo") return { ...config, ciRepo: value };
  if (key === "ci_workflow" || key === "ci-workflow") return { ...config, ciWorkflow: value };
  if (key === "ci_auth" || key === "ci-auth") {
    if (value !== "gh-cli") throw new Error("ci_auth must be gh-cli");
    return { ...config, ciAuth: value };
  }
  if (key === "skills_dir" || key === "skills-dir") return { ...config, skillsDir: value };
  if (key === "merge_strategy" || key === "merge-strategy") {
    if (value !== "squash" && value !== "merge" && value !== "rebase") {
      throw new Error("merge_strategy must be squash, merge, or rebase");
    }
    return { ...config, mergeStrategy: value };
  }
  if (key === "require_clean_worktree" || key === "require-clean-worktree") {
    return { ...config, requireCleanWorktree: parseBoolean(value, key) };
  }
  if (key === "clean_worktree_except" || key === "clean-worktree-except") {
    return {
      ...config,
      cleanWorktreeExcept: value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    };
  }
  if (key === "require_gate_before_ci" || key === "require-gate-before-ci") {
    return { ...config, requireGateBeforeCi: parseBoolean(value, key) };
  }
  if (key === "require_ci_before_merge" || key === "require-ci-before-merge") {
    return { ...config, requireCiBeforeMerge: parseBoolean(value, key) };
  }
  if (key === "export_default_out" || key === "export-default-out") {
    return { ...config, exportDefaultOut: value };
  }
  if (key === "export_canonicalize_command" || key === "export-canonicalize-command") {
    return { ...config, exportCanonicalizeCommand: value };
  }
  if (key.startsWith("hooks_") || key.startsWith("hooks-")) return setHook(config, key, value);
  if (key === "check_timeout_seconds" || key === "check-timeout-seconds")
    return { ...config, checkTimeoutSeconds: parsePositiveInteger(value, key) };
  if (key === "check_no_output_timeout_seconds" || key === "check-no-output-timeout-seconds")
    return { ...config, checkNoOutputTimeoutSeconds: parsePositiveInteger(value, key) };
  if (key === "ci_timeout_seconds" || key === "ci-timeout-seconds")
    return { ...config, ciTimeoutSeconds: parsePositiveInteger(value, key) };
  if (key === "ci_no_output_timeout_seconds" || key === "ci-no-output-timeout-seconds")
    return { ...config, ciNoOutputTimeoutSeconds: parsePositiveInteger(value, key) };
  if (key === "policy_require_audit_before_ci" || key === "policy-require-audit-before-ci")
    return {
      ...config,
      policy: { ...config.policy, requireAuditBeforeCi: parseBoolean(value, key) },
    };
  if (
    key === "policy_require_verification_before_ci" ||
    key === "policy-require-verification-before-ci"
  )
    return {
      ...config,
      policy: { ...config.policy, requireVerificationBeforeCi: parseBoolean(value, key) },
    };
  if (
    key === "policy_require_p2_p3_disposition_before_merge" ||
    key === "policy-require-p2-p3-disposition-before-merge"
  )
    return {
      ...config,
      policy: {
        ...config.policy,
        requireP2P3DispositionBeforeMerge: parseBoolean(value, key),
      },
    };
  if (key === "policy_require_merge_commit" || key === "policy-require-merge-commit")
    return {
      ...config,
      policy: { ...config.policy, requireMergeCommit: parseBoolean(value, key) },
    };
  if (key === "worktree_base_dir" || key === "worktree-base-dir")
    return { ...config, worktree: { ...config.worktree, baseDir: value } };
  if (key === "worktree_env_template" || key === "worktree-env-template")
    return { ...config, worktree: { ...config.worktree, envTemplate: value } };
  if (key === "worktree_env_file" || key === "worktree-env-file")
    return { ...config, worktree: { ...config.worktree, envFile: value } };
  throw new Error(`Unknown config key: ${key}`);
}

export function setCiProviderConfig(
  config: QdConfig,
  value: string,
  options: Record<string, string | string[] | boolean>,
): QdConfig {
  if (value !== "none" && value !== "github") throw new Error("ci_provider must be none or github");
  if (value === "none") {
    return { ...config, ciProvider: "none", ciRepo: "", ciWorkflow: "", ciAuth: "gh-cli" };
  }
  const repo = stringOpt(options.repo) ?? config.ciRepo;
  const workflow = stringOpt(options.workflow) ?? config.ciWorkflow;
  const auth = stringOpt(options.auth) ?? config.ciAuth;
  if (!repo.trim()) throw new Error("--repo is required when setting ci-provider github");
  if (!workflow.trim()) throw new Error("--workflow is required when setting ci-provider github");
  if (auth !== "gh-cli") throw new Error("--auth must be gh-cli");
  return {
    ...config,
    ciProvider: "github",
    ciRepo: repo,
    ciWorkflow: workflow,
    ciAuth: "gh-cli",
  };
}

export function getConfigValue(config: QdConfig, key: string): unknown {
  if (key === "check_command" || key === "check-command") return config.checkCommand;
  if (key === "ci_command" || key === "ci-command") return config.ciCommand;
  if (key === "ci_provider" || key === "ci-provider") return config.ciProvider;
  if (key === "ci_repo" || key === "ci-repo") return config.ciRepo;
  if (key === "ci_workflow" || key === "ci-workflow") return config.ciWorkflow;
  if (key === "ci_auth" || key === "ci-auth") return config.ciAuth;
  if (key === "skills_dir" || key === "skills-dir") return config.skillsDir;
  if (key === "merge_strategy" || key === "merge-strategy") return config.mergeStrategy;
  if (key === "require_clean_worktree" || key === "require-clean-worktree")
    return config.requireCleanWorktree;
  if (key === "clean_worktree_except" || key === "clean-worktree-except")
    return config.cleanWorktreeExcept;
  if (key === "require_gate_before_ci" || key === "require-gate-before-ci")
    return config.requireGateBeforeCi;
  if (key === "require_ci_before_merge" || key === "require-ci-before-merge")
    return config.requireCiBeforeMerge;
  if (key === "export_default_out" || key === "export-default-out") return config.exportDefaultOut;
  if (key === "export_canonicalize_command" || key === "export-canonicalize-command")
    return config.exportCanonicalizeCommand;
  if (key === "hooks" || key === "hook") return config.hooks;
  if (key === "hooks_pre_claim" || key === "hooks-pre-claim") return config.hooks.preClaim;
  if (key === "hooks_post_claim" || key === "hooks-post-claim") return config.hooks.postClaim;
  if (key === "hooks_pre_check" || key === "hooks-pre-check") return config.hooks.preCheck;
  if (key === "hooks_post_check" || key === "hooks-post-check") return config.hooks.postCheck;
  if (key === "hooks_pre_gate" || key === "hooks-pre-gate") return config.hooks.preGate;
  if (key === "hooks_post_export" || key === "hooks-post-export") return config.hooks.postExport;
  if (key === "hooks_pre_merge" || key === "hooks-pre-merge") return config.hooks.preMerge;
  if (key === "hooks_post_merge" || key === "hooks-post-merge") return config.hooks.postMerge;
  if (key === "check_timeout_seconds" || key === "check-timeout-seconds")
    return config.checkTimeoutSeconds;
  if (key === "check_no_output_timeout_seconds" || key === "check-no-output-timeout-seconds")
    return config.checkNoOutputTimeoutSeconds;
  if (key === "ci_timeout_seconds" || key === "ci-timeout-seconds") return config.ciTimeoutSeconds;
  if (key === "ci_no_output_timeout_seconds" || key === "ci-no-output-timeout-seconds")
    return config.ciNoOutputTimeoutSeconds;
  if (key === "policy" || key === "policies") return config.policy;
  if (key === "policy_require_audit_before_ci" || key === "policy-require-audit-before-ci")
    return config.policy.requireAuditBeforeCi;
  if (
    key === "policy_require_verification_before_ci" ||
    key === "policy-require-verification-before-ci"
  )
    return config.policy.requireVerificationBeforeCi;
  if (
    key === "policy_require_p2_p3_disposition_before_merge" ||
    key === "policy-require-p2-p3-disposition-before-merge"
  )
    return config.policy.requireP2P3DispositionBeforeMerge;
  if (key === "policy_require_merge_commit" || key === "policy-require-merge-commit")
    return config.policy.requireMergeCommit;
  if (key === "worktree" || key === "worktrees") return config.worktree;
  if (key === "worktree_base_dir" || key === "worktree-base-dir") return config.worktree.baseDir;
  if (key === "worktree_env_template" || key === "worktree-env-template")
    return config.worktree.envTemplate;
  if (key === "worktree_env_file" || key === "worktree-env-file") return config.worktree.envFile;
  throw new Error(`Unknown config key: ${key}`);
}

function setHook(config: QdConfig, key: string, value: string): QdConfig {
  const hookKey = key.replace(/^hooks[-_]/, "");
  const hooks = { ...config.hooks };
  if (hookKey === "pre_claim" || hookKey === "pre-claim") hooks.preClaim = value;
  else if (hookKey === "post_claim" || hookKey === "post-claim") hooks.postClaim = value;
  else if (hookKey === "pre_check" || hookKey === "pre-check") hooks.preCheck = value;
  else if (hookKey === "post_check" || hookKey === "post-check") hooks.postCheck = value;
  else if (hookKey === "pre_gate" || hookKey === "pre-gate") hooks.preGate = value;
  else if (hookKey === "post_export" || hookKey === "post-export") hooks.postExport = value;
  else if (hookKey === "pre_merge" || hookKey === "pre-merge") hooks.preMerge = value;
  else if (hookKey === "post_merge" || hookKey === "post-merge") hooks.postMerge = value;
  else throw new Error(`Unknown config key: ${key}`);
  return { ...config, hooks };
}
