import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  analyticsReport,
  criticalPathReport,
  deterministicGraphSnapshot,
  graphSnapshot,
  readConfig,
  readyNodes,
  stats,
  validateGraph,
  workspaceGraph,
  workspaceReady,
  workspaceStatus,
  writeConfig,
} from "@cat-cave/qdcli-core";
import { numberOpt, output, requiredArg, stringListOpt, stringOpt } from "./args.js";
import { getConfigValue, setCiProviderConfig, setConfigValue } from "./config-options.js";
import { parseStatusList } from "./enums.js";
import { filterNodes, filterSnapshot, formatRows, toDot, toMermaid } from "./graph-format.js";
import { runPolicyHook } from "./shell.js";
import { isSourceCheckout, viewerRuntime } from "./viewer.js";

export async function doctorCommand(
  root: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const strict = Boolean(options.strict);
  const validationResult = await validateGraph(root, { strict });
  const config = await readConfig(root);
  const configErrors: string[] = [];
  const configWarnings: string[] = [];
  const sourceCheckout = await isSourceCheckout();
  const viewer = await viewerRuntime();
  if (!config.checkCommand.trim()) configWarnings.push("check_command is empty");
  if (!config.ciCommand.trim()) configErrors.push("ci_command is empty");
  if (!["squash", "merge", "rebase"].includes(config.mergeStrategy)) {
    configErrors.push("merge_strategy must be squash, merge, or rebase");
  }
  if (config.ciProvider === "github") {
    if (!config.ciRepo.trim()) configErrors.push("ci_repo is required when ci_provider is github");
    if (!config.ciWorkflow.trim()) {
      configErrors.push("ci_workflow is required when ci_provider is github");
    }
    if (config.ciAuth !== "gh-cli") configErrors.push("ci_auth must be gh-cli");
  }
  const result = {
    ok: validationResult.ok && configErrors.length === 0,
    strict,
    checks: {
      initialized: true,
      schema: true,
      graph: validationResult.ok,
      config: configErrors.length === 0,
    },
    runtime: {
      sourceCheckout,
      viewer,
      skills: "embedded",
    },
    config,
    errors: [...validationResult.errors, ...configErrors],
    warnings: [...validationResult.warnings, ...configWarnings],
  };
  output(result, json);
  if (!result.ok) process.exitCode = 1;
}

export async function configCommand(
  root: string,
  action: string | undefined,
  key: string | undefined,
  positionals: string[],
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const config = await readConfig(root);
  if (action === "show" || !action) return output(config, json);
  if (action === "get") {
    const configKey = requiredArg(key, "config key");
    return output({ key: configKey, value: getConfigValue(config, configKey) }, json);
  }
  if (action === "set") {
    const configKey = requiredArg(key, "config key");
    const value = stringOpt(options.value) ?? positionals[0] ?? "";
    const next =
      configKey === "ci-provider" || configKey === "ci_provider"
        ? setCiProviderConfig(config, value, options)
        : setConfigValue(config, configKey, requiredArg(value || undefined, "--value"));
    await writeConfig(root, next);
    return output(next, json);
  }
  throw new Error(`Unknown config action: ${action}`);
}

export async function workspaceCommand(
  action: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const workspaceOptions = {
    configPath: stringOpt(options.config),
    repos: stringListOpt(options.repo),
  };
  if (action === "status" || !action) {
    const result = await workspaceStatus(workspaceOptions);
    output(result, json);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (action === "ready") return output(await workspaceReady(workspaceOptions), json);
  if (action === "graph") return output(await workspaceGraph(workspaceOptions), json);
  throw new Error(`Unknown workspace action: ${action}`);
}

export async function graphCommand(
  root: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const format = stringOpt(options.format) ?? (json ? "json" : "table");
  const snapshot = await graphSnapshot(root);
  if (format === "json") return output(snapshot, true);
  if (format === "mermaid") {
    console.log(toMermaid(snapshot));
    return;
  }
  if (format === "dot") {
    console.log(toDot(snapshot));
    return;
  }
  output(snapshot.nodes, false);
}

export async function readyCommand(
  root: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  return output(formatRows(filterNodes(await readyNodes(root), options), options), json);
}

export async function exportCommand(
  root: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const snapshot = filterSnapshot(await graphSnapshot(root), {
    statuses: parseStatusList(options.status),
    milestone: stringOpt(options.milestone),
  });
  if (options.fields) {
    if (options.out) throw new Error("qd export --fields cannot be combined with --out");
    return output(formatRows(snapshot.nodes, options), json);
  }
  const exported = options.deterministic ? deterministicGraphSnapshot(snapshot) : snapshot;
  const config = await readConfig(root);
  const outPath = stringOpt(options.out) ?? config.exportDefaultOut;
  if (!outPath) return output(exported, true);

  const resolvedOut = path.resolve(root, outPath);
  await mkdir(path.dirname(resolvedOut), { recursive: true });
  await writeFile(resolvedOut, `${JSON.stringify(exported, null, 2)}\n`, "utf8");
  if (!options["no-hooks"]) {
    const hook = config.exportCanonicalizeCommand || config.hooks.postExport;
    if (hook.trim()) await runPolicyHook(root, hook, { out: resolvedOut, root });
  }
  return output(
    {
      ok: true,
      path: path.relative(root, resolvedOut),
      nodes: snapshot.nodes.length,
      edges: snapshot.edges.length,
      findings: snapshot.findings.length,
      runs: snapshot.runs.length,
      nodeNotes: snapshot.node_notes.length,
    },
    json,
  );
}

export async function validationCommand(root: string, json: boolean): Promise<void> {
  const result = await validateGraph(root);
  output(result, json);
  if (!result.ok) process.exitCode = 1;
}

export async function snapshotCommand(
  root: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const milestone = stringOpt(options.milestone) ?? null;
  const graph = await graphSnapshot(root);
  const result = {
    schemaVersion: 1,
    status: await stats(root),
    ready: await readyNodes(root),
    openFindings: graph.findings.filter((finding) => finding.status === "open"),
    criticalPath: await criticalPathReport(root, milestone),
  };
  output(result, json);
}

export async function statusCommand(root: string, json: boolean): Promise<void> {
  return output(await stats(root), json);
}

export async function milestoneStatus(
  root: string,
  milestone: string | null,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  return output(
    await analyticsReport(root, {
      milestone,
      windowDays: numberOpt(options.window) ?? 7,
    }),
    json,
  );
}
