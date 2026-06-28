import {
  ciFail,
  latestRun,
  readConfig,
  recordCiResult,
  startRun,
  type QdConfig,
} from "@cat-cave/qdcli-core";
import { numberOpt, output, required, requiredArg, stringOpt } from "./args.js";
import { runConfiguredCheck } from "./checks.js";
import { captureCommand, sleep } from "./shell.js";

export async function ciCommand(
  root: string,
  action: string | undefined,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "run")
    return runConfiguredCheck(root, requiredArg(nodeId, "node id"), "ci", options, json);
  if (action === "poll" || action === "wait") {
    return pollCi(root, requiredArg(nodeId, "node id"), options, json);
  }
  if (action === "start") {
    return output(
      await startRun(root, requiredArg(nodeId, "node id"), "ci", {
        summary: stringOpt(options.cmd),
      }),
      json,
    );
  }
  if (action === "pass")
    throw new Error(
      "Use qd ci record-pass <node> --summary <text> with --log-path, --url, or --external-id",
    );
  if (action === "record-pass") {
    const evidence = ciEvidence(options);
    return output(
      await recordCiResult(root, requiredArg(nodeId, "node id"), {
        status: "passed",
        summary: `${required(options.summary, "--summary")}\n${evidence.summary}`,
        logPath: evidence.logPath,
      }),
      json,
    );
  }
  if (action === "fail")
    return output(
      await ciFail(root, requiredArg(nodeId, "node id"), stringOpt(options.summary)),
      json,
    );
  throw new Error(`Unknown ci action: ${action}`);
}

async function pollCi(
  root: string,
  nodeId: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const config = await readConfig(root);
  const provider = stringOpt(options.provider) ?? config.ciProvider;
  const providerError = ciProviderError(provider);
  if (providerError) throw new Error(providerError);
  const sha = stringOpt(options.sha) ?? (await latestMergeCommitSha(root, nodeId));
  if (!sha) {
    throw new Error(
      "No commit SHA found. Pass --sha, or record qd merge <node> --use-existing-commit <sha> first.",
    );
  }
  const result = await pollGitHubCi(root, nodeId, sha, config, options);
  output(result, json);
  if (!result.ok) process.exitCode = 1;
}

export async function latestMergeCommitSha(root: string, nodeId: string): Promise<string | null> {
  const run = await latestRun(root, nodeId, "merge");
  const summary = run?.summary ?? "";
  const match = /\b[0-9a-f]{7,40}\b/i.exec(summary);
  return match?.[0] ?? null;
}

export interface PolledCiRun {
  databaseId?: number;
  status?: string;
  conclusion?: string;
  url?: string;
  headSha?: string;
  name?: string;
  displayTitle?: string;
}

export interface GitHubCiPollingOptions {
  repo: string;
  workflow: string;
  auth: string;
  intervalSeconds: number;
  timeoutSeconds: number;
}

async function pollGitHubCi(
  root: string,
  nodeId: string,
  sha: string,
  config: QdConfig,
  options: Record<string, string | string[] | boolean>,
): Promise<Record<string, unknown> & { ok: boolean }> {
  const { repo, workflow, intervalSeconds, timeoutSeconds } = githubCiPollingOptions(
    config,
    options,
  );
  const startedAt = Date.now();
  let lastRun: PolledCiRun | null = null;

  while (Date.now() - startedAt <= timeoutSeconds * 1000) {
    lastRun = await githubRunForSha(root, repo, workflow, sha);
    const terminal = githubCiTerminalResult(lastRun, sha);
    if (terminal) {
      const node = await recordCiResult(root, nodeId, {
        status: terminal.ok ? "passed" : "failed",
        summary: terminal.summary,
        logPath: null,
      });
      return { ok: terminal.ok, provider: "github", repo, workflow, sha, run: lastRun, node };
    }
    await sleep(intervalSeconds * 1000);
  }
  return {
    ok: false,
    provider: "github",
    repo,
    workflow,
    sha,
    run: lastRun,
    error: `Timed out after ${timeoutSeconds} seconds waiting for GitHub CI`,
  };
}

async function githubRunForSha(
  root: string,
  repo: string,
  workflow: string,
  sha: string,
): Promise<PolledCiRun | null> {
  const result = await captureCommand("gh", githubRunListArgs(repo, workflow, sha), root);
  if (result.code !== 0) throw new Error(`gh run list failed: ${result.stderr.trim()}`);
  return parseGitHubRunList(result.stdout);
}

export function ciProviderError(provider: string): string | null {
  if (provider === "github") return null;
  if (provider === "none")
    return "ci_provider is none. Configure a provider or pass --provider github.";
  return `Unsupported CI provider: ${provider}`;
}

export function githubCiPollingOptions(
  config: Pick<QdConfig, "ciRepo" | "ciWorkflow" | "ciAuth">,
  options: Record<string, string | string[] | boolean>,
): GitHubCiPollingOptions {
  const repo = (stringOpt(options.repo) ?? config.ciRepo).trim();
  const workflow = (stringOpt(options.workflow) ?? config.ciWorkflow).trim();
  const auth = stringOpt(options.auth) ?? config.ciAuth;
  if (!repo) throw new Error("--repo or ci_repo is required for GitHub CI polling");
  if (!workflow) throw new Error("--workflow or ci_workflow is required for GitHub CI polling");
  if (auth !== "gh-cli") throw new Error("GitHub CI polling currently supports --auth gh-cli only");
  const intervalSeconds = numberOpt(options.interval) ?? 30;
  const timeoutSeconds = numberOpt(options.timeout) ?? 1800;
  if (intervalSeconds < 1) throw new Error("--interval must be at least 1 second");
  if (timeoutSeconds < 1) throw new Error("--timeout must be at least 1 second");
  return { repo, workflow, auth, intervalSeconds, timeoutSeconds };
}

export function githubRunListArgs(repo: string, workflow: string, sha: string): string[] {
  return [
    "run",
    "list",
    "--repo",
    repo,
    "--workflow",
    workflow,
    "--commit",
    sha,
    "--limit",
    "1",
    "--json",
    "databaseId,status,conclusion,url,headSha,name,displayTitle",
  ];
}

export function parseGitHubRunList(stdout: string): PolledCiRun | null {
  const parsed = JSON.parse(stdout || "[]") as unknown;
  if (!Array.isArray(parsed)) throw new Error("gh run list returned non-array JSON");
  return (parsed[0] as PolledCiRun | undefined) ?? null;
}

export function githubCiTerminalResult(
  run: PolledCiRun | null,
  sha: string,
): { ok: boolean; summary: string } | null {
  const conclusion = run?.conclusion;
  if (conclusion) {
    const ok = conclusion === "success";
    const evidence = run?.url ?? String(run?.databaseId ?? sha);
    return {
      ok,
      summary: `GitHub CI ${ok ? "passed" : `failed (${conclusion})`}: ${evidence}`,
    };
  }
  if (run?.status === "completed") {
    return {
      ok: false,
      summary: `GitHub CI completed without a conclusion for ${sha}`,
    };
  }
  return null;
}

export function ciEvidence(options: Record<string, string | string[] | boolean>): {
  summary: string;
  logPath?: string;
} {
  const logPath = stringOpt(options["log-path"]);
  const url = stringOpt(options.url);
  const externalId = stringOpt(options["external-id"]);
  if (!logPath && !url && !externalId) {
    throw new Error("CI pass recording requires --log-path, --url, or --external-id");
  }
  const parts = [
    logPath ? `log_path=${logPath}` : null,
    url ? `url=${url}` : null,
    externalId ? `external_id=${externalId}` : null,
  ].filter(Boolean);
  return { summary: `Evidence: ${parts.join(", ")}`, logPath };
}
