import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  addEdge,
  addFinding,
  addNode,
  addNodeNote,
  analyticsReport,
  cancelNode,
  ciFail,
  ciPass,
  claimNode,
  completeNode,
  criticalPathReport,
  etaReport,
  getProjectPaths,
  gateNode,
  getNode,
  graphSnapshot,
  initProject,
  listNodeNotes,
  listEdges,
  listNodes,
  listRegistry,
  markMerged,
  promoteFindings,
  readConfig,
  recordCiResult,
  readyNodes,
  registerGroup,
  registerMilestone,
  registerProject,
  recordCheckResult,
  removeEdge,
  resolveFinding,
  setupProject,
  startRun,
  stats,
  updateNode,
  validateGraph,
  velocityReport,
  writeConfig,
  type QdConfig,
  type AddNodeInput,
  type EdgeType,
  type NodeKind,
  type NodeStatus,
  type Priority,
  type Risk,
  type VerificationEntry,
} from "@qdcli/core";
import { promptText, skillText } from "./prompts.js";

interface ParsedArgs {
  command: string[];
  options: Record<string, string | string[] | boolean>;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [group, action, extra] = args.command;
  const json = Boolean(args.options.json);
  const root = process.cwd();

  if (!group || group === "help" || group === "--help" || group === "-h") {
    console.log(helpText());
    return;
  }

  if (group === "--version" || group === "-v") {
    console.log("0.1.0");
    return;
  }

  switch (group) {
    case "init":
      await initProject(root);
      return output({ ok: true, message: "Initialized .qd" }, json);
    case "setup":
      await setupProject(root);
      await installSkill(root);
      if (args.options["print-agent-url"]) {
        console.log("https://github.com/cat-cave/qdcli/blob/main/docs/llms.md");
        return;
      }
      return output(
        {
          ok: true,
          hooks: args.options["no-hooks"] ? "skipped" : "not-installed",
          message: "Initialized qd and installed skills.sh skill",
        },
        json,
      );
    case "doctor":
      return doctor(root, json);
    case "status":
      return output(await stats(root), json);
    case "ready":
      return output(await readyNodes(root), json);
    case "graph":
      return graph(root, args.options, json);
    case "validate":
      return validation(root, json);
    case "config":
      return configCommand(root, action, extra, args.options, json);
    case "import":
      return importCommand(root, args.options, json);
    case "group":
      return registryCommand(root, "groups", action, args.options, json);
    case "project":
      return registryCommand(root, "projects", action, args.options, json);
    case "node":
      return nodeCommand(root, action, extra, args.options, json);
    case "edge":
      return edgeCommand(root, action, args.command.slice(2), args.options, json);
    case "claim":
      return output(
        await claimNode(root, {
          id: action,
          agent: required(args.options.agent, "--agent"),
          branch: stringOpt(args.options.branch),
        }),
        json,
      );
    case "start":
      return output(await startRun(root, requiredArg(action, "node id"), "implement"), json);
    case "complete":
      return output(
        await completeNode(
          root,
          requiredArg(action, "node id"),
          required(args.options.summary, "--summary"),
        ),
        json,
      );
    case "audit":
      return output(
        await startRun(root, requiredArg(action === "start" ? extra : action, "node id"), "audit"),
        json,
      );
    case "finding":
      return findingCommand(root, action, extra, args.options, json);
    case "promote-findings":
      return output(await promoteFindings(root, requiredArg(action, "node id")), json);
    case "gate":
      return gate(root, requiredArg(action, "node id"), json);
    case "ci":
      return ciCommand(root, action, extra, args.options, json);
    case "check":
      return checkCommand(root, action, extra, args.options, json);
    case "merge":
      return output(
        await markMerged(
          root,
          requiredArg(action, "node id"),
          stringOpt(args.options.strategy) ?? "squash",
        ),
        json,
      );
    case "plan":
      return planCommand(root, action, args.options, json);
    case "milestone":
      return milestoneCommand(root, action, args.options, json);
    case "velocity":
      return output(await velocityReport(root, numberOpt(args.options.window) ?? 7), json);
    case "critical-path":
      return output(
        await criticalPathReport(root, stringOpt(args.options.milestone) ?? null),
        json,
      );
    case "eta":
      return output(
        await etaReport(
          root,
          stringOpt(args.options.milestone) ?? null,
          numberOpt(args.options.window) ?? 7,
        ),
        json,
      );
    case "stats":
      return output(
        await analyticsReport(root, {
          milestone: stringOpt(args.options.milestone) ?? null,
          windowDays: numberOpt(args.options.window) ?? 7,
        }),
        json,
      );
    case "snapshot":
      return snapshotCommand(root, args.options, json);
    case "prompt":
      return promptCommand(root, action, extra, json);
    case "agent":
      return agentCommand(root, action, extra, args.options, json);
    case "view":
      return viewCommand(args.options);
    default:
      throw new Error(`Unknown command: ${group}`);
  }
}

async function doctor(root: string, json: boolean): Promise<void> {
  await initProject(root);
  const validationResult = await validateGraph(root);
  const config = await readConfig(root);
  const configErrors: string[] = [];
  if (!config.checkCommand.trim()) configErrors.push("check_command is empty");
  if (!config.ciCommand.trim()) configErrors.push("ci_command is empty");
  if (!["squash", "merge", "rebase"].includes(config.mergeStrategy)) {
    configErrors.push("merge_strategy must be squash, merge, or rebase");
  }
  const result = {
    ok: validationResult.ok && configErrors.length === 0,
    checks: {
      initialized: true,
      schema: true,
      graph: validationResult.ok,
      config: configErrors.length === 0,
    },
    config,
    errors: [...validationResult.errors, ...configErrors],
    warnings: validationResult.warnings,
  };
  output(result, json);
  if (!result.ok) process.exitCode = 1;
}

async function configCommand(
  root: string,
  action: string | undefined,
  key: string | undefined,
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
    const value = requiredArg(options.value ? stringOpt(options.value) : undefined, "--value");
    const next = setConfigValue(config, requiredArg(key, "config key"), value);
    await writeConfig(root, next);
    return output(next, json);
  }
  throw new Error(`Unknown config action: ${action}`);
}

async function graph(
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

async function validation(root: string, json: boolean): Promise<void> {
  const result = await validateGraph(root);
  output(result, json);
  if (!result.ok) process.exitCode = 1;
}

async function snapshotCommand(
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

async function nodeCommand(
  root: string,
  action: string | undefined,
  id: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "add") {
    return output(
      await addNode(root, {
        id: stringOpt(options.id),
        title: required(options.title, "--title"),
        kind: strictEnumOpt(options.kind, isNodeKind, "--kind", "feature"),
        milestone: stringOpt(options.milestone),
        groupName: stringOpt(options.group),
        projects: stringListOpt(options.project),
        status: strictEnumOpt(options.status, isNodeStatus, "--status", "ready"),
        priority: strictEnumOpt(options.priority, isPriority, "--priority", "P2"),
        estimatePoints: numberOpt(options.estimate) ?? 1,
        risk: strictEnumOpt(options.risk, isRisk, "--risk", "medium"),
        spec: required(options.spec, "--spec"),
        acceptance: required(options.acceptance, "--acceptance"),
        validation: stringOpt(options.validation),
        verification: stringListOpt(options.verify).map(parseVerification),
        auditFocus: stringListOpt(options["audit-focus"]),
        context: stringOpt(options.context),
        statusReason: stringOpt(options["status-reason"]),
        checkCommand: stringOpt(options["check-command"]),
      }),
      json,
    );
  }
  if (action === "note") return nodeNoteCommand(root, id, options, json);
  if (action === "show") return output(await getNode(root, requiredArg(id, "node id")), json);
  if (action === "list" || !action) return output(await listNodes(root), json);
  if (action === "cancel") return output(await cancelNode(root, requiredArg(id, "node id")), json);
  if (action === "edit") {
    return output(
      await updateNode(root, requiredArg(id, "node id"), {
        title: stringOpt(options.title),
        kind: strictEnumOpt(options.kind, isNodeKind, "--kind"),
        milestone: stringOpt(options.milestone),
        group_name: stringOpt(options.group),
        projects: options.project ? stringListOpt(options.project) : undefined,
        status: strictEnumOpt(options.status, isNodeStatus, "--status"),
        priority: strictEnumOpt(options.priority, isPriority, "--priority"),
        estimatePoints: numberOpt(options.estimate),
        risk: strictEnumOpt(options.risk, isRisk, "--risk"),
        spec: stringOpt(options.spec),
        acceptance: stringOpt(options.acceptance),
        validation: stringOpt(options.validation),
        verification: options.verify
          ? stringListOpt(options.verify).map(parseVerification)
          : undefined,
        audit_focus: options["audit-focus"] ? stringListOpt(options["audit-focus"]) : undefined,
        context: stringOpt(options.context),
        status_reason: stringOpt(options["status-reason"]),
        check_command: stringOpt(options["check-command"]),
      }),
      json,
    );
  }
  throw new Error(`Unknown node action: ${action}`);
}

async function edgeCommand(
  root: string,
  action: string | undefined,
  values: string[],
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "add") {
    return output(
      await addEdge(
        root,
        requiredArg(values[0], "from node"),
        requiredArg(values[1], "to node"),
        strictEnumOpt(options.type, isEdgeType, "--type", "requires"),
      ),
      json,
    );
  }
  if (action === "remove") {
    await removeEdge(
      root,
      requiredArg(values[0], "from node"),
      requiredArg(values[1], "to node"),
      strictEnumOpt(options.type, isEdgeType, "--type", "requires"),
    );
    return output({ ok: true }, json);
  }
  if (action === "list" || !action) return output(await listEdges(root), json);
  throw new Error(`Unknown edge action: ${action}`);
}

async function findingCommand(
  root: string,
  action: string | undefined,
  nodeOrFinding: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "add" && options["from-report"]) {
    return output(
      await importFindingsFromReport(
        root,
        required(options["from-report"], "--from-report"),
        nodeOrFinding,
      ),
      json,
    );
  }
  if (action === "add") {
    return output(
      await addFinding(root, requiredArg(nodeOrFinding, "node id"), {
        severity: strictEnumOpt(options.severity, isPriority, "--severity", "P2"),
        title: required(options.title, "--title"),
        evidence: required(options.evidence, "--evidence"),
        path: stringOpt(options.path),
        line: numberOpt(options.line),
        expected: stringOpt(options.expected),
        suggestedFix: stringOpt(options["suggested-fix"]),
      }),
      json,
    );
  }
  if (action === "resolve")
    return output(await resolveFinding(root, requiredArg(nodeOrFinding, "finding id")), json);
  throw new Error(`Unknown finding action: ${action}`);
}

async function gate(root: string, nodeId: string, json: boolean): Promise<void> {
  const result = await gateNode(root, nodeId);
  output(result, json);
  if (!result.ok) process.exitCode = 1;
}

async function ciCommand(
  root: string,
  action: string | undefined,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "run")
    return runConfiguredCheck(root, requiredArg(nodeId, "node id"), "ci", options, json);
  if (action === "start") {
    return output(
      await startRun(root, requiredArg(nodeId, "node id"), "ci", {
        summary: stringOpt(options.cmd),
      }),
      json,
    );
  }
  if (action === "pass")
    return output(
      await ciPass(root, requiredArg(nodeId, "node id"), stringOpt(options.summary)),
      json,
    );
  if (action === "fail")
    return output(
      await ciFail(root, requiredArg(nodeId, "node id"), stringOpt(options.summary)),
      json,
    );
  throw new Error(`Unknown ci action: ${action}`);
}

async function checkCommand(
  root: string,
  action: string | undefined,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "run")
    return runConfiguredCheck(root, requiredArg(nodeId, "node id"), "check", options, json);
  throw new Error(`Unknown check action: ${action}`);
}

async function planCommand(
  root: string,
  action: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "export")
    return graph(root, { ...options, format: stringOpt(options.format) ?? "json" }, json);
  if (action === "import") {
    throw new Error(
      "qd plan import is reserved for the next trial iteration; use qd node add and qd edge add for now",
    );
  }
  throw new Error(`Unknown plan action: ${action}`);
}

async function milestoneCommand(
  root: string,
  action: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "register") {
    return output(
      await registerMilestone(
        root,
        required(options.name, "--name"),
        requiredNumber(options.rank, "--rank"),
      ),
      json,
    );
  }
  if (action === "list") return output(await listRegistry(root, "milestones"), json);
  if (action === "status" || !action) {
    return output(
      await analyticsReport(root, {
        milestone: stringOpt(options.milestone) ?? null,
        windowDays: numberOpt(options.window) ?? 7,
      }),
      json,
    );
  }
  throw new Error(`Unknown milestone action: ${action}`);
}

async function registryCommand(
  root: string,
  table: "groups" | "projects",
  action: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "register") {
    const name = required(options.name, "--name");
    return output(
      table === "groups" ? await registerGroup(root, name) : await registerProject(root, name),
      json,
    );
  }
  if (action === "list" || !action) return output(await listRegistry(root, table), json);
  throw new Error(`Unknown ${table} action: ${action}`);
}

async function nodeNoteCommand(
  root: string,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const id = requiredArg(nodeId, "node id");
  const mode = stringOpt(options.mode) ?? "add";
  if (mode === "list") return output(await listNodeNotes(root, id), json);
  return output(await addNodeNote(root, id, required(options.text, "--text")), json);
}

async function importCommand(
  root: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const filePath = path.resolve(root, required(options.from, "--from"));
  const mappingPath = stringOpt(options["schema-mapping"]);
  const dryRun = Boolean(options["dry-run"]);
  const verbose = Boolean(options.verbose);
  const source = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  const mapping = mappingPath
    ? (JSON.parse(await readFile(path.resolve(root, mappingPath), "utf8")) as ImportMapping)
    : defaultImportMapping;
  const nodes = strictArrayAtPath(source, mapping.nodesPath ?? "nodes", true);
  const edges = strictArrayAtPath(source, mapping.edgesPath ?? "edges", false);
  const report: ImportReport = {
    ok: true,
    dryRun,
    nodesFound: nodes.length,
    edgesFound: edges.length,
    importedNodes: 0,
    importedEdges: 0,
    defaults: [],
    droppedFields: [],
    warnings: [],
    errors: [],
    nodes: [],
    edges: [],
  };
  const importedNodes = [];
  const importedEdges = [];
  const plannedImportEdges: PlannedImportEdge[] = [];
  const plannedEdges = new Set<string>();
  const nodeKeysUsed = usedNodeMappingKeys(mapping);
  if (nodes.length === 0) report.errors.push(`No nodes found at ${mapping.nodesPath ?? "nodes"}`);

  const plannedNodes = nodes.flatMap((raw, index): PlannedImportNode[] => {
    try {
      const planned = mapImportNode(raw, index, mapping, report, verbose);
      const dropped = droppedTopLevelKeys(raw, nodeKeysUsed);
      if (dropped.length > 0) {
        report.droppedFields.push({
          nodeId: planned.input.id ?? planned.sourceId,
          fields: dropped,
        });
        if (verbose)
          importVerbose(`node ${planned.sourceId}: dropped unmapped fields ${dropped.join(", ")}`);
      }
      report.nodes.push(planned.input);
      return [planned];
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error));
      return [];
    }
  });

  for (const [index, raw] of edges.entries()) {
    const from = stringAt(raw, mapping.edgeFrom ?? "from");
    const to = stringAt(raw, mapping.edgeTo ?? "to");
    if (!from || !to) {
      report.errors.push(
        `edges[${index}] must include ${mapping.edgeFrom ?? "from"} and ${mapping.edgeTo ?? "to"}`,
      );
      continue;
    }
    try {
      const type = strictOptionalEnum<EdgeType>(
        stringAt(raw, mapping.edgeType ?? "type"),
        isEdgeType,
        "edge.type",
        "requires",
      );
      planImportEdge({ from, to, type, source: "edges" }, plannedImportEdges, report, plannedEdges);
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (mapping.nodeEdges) {
    try {
      validateNodeEdgesMapping(mapping.nodeEdges);
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error));
    }
    for (const planned of plannedNodes) {
      let refs: string[] = [];
      try {
        refs = strictStringArrayAt(
          planned.raw,
          mapping.nodeEdges.path,
          `node ${planned.sourceId}.nodeEdges`,
        );
      } catch (error) {
        report.errors.push(error instanceof Error ? error.message : String(error));
        continue;
      }
      if (refs.length === 0) continue;
      const type = mapping.nodeEdges.edgeType ?? "requires";
      if (!isEdgeType(type)) {
        report.errors.push(`nodeEdges.edgeType must be one of ${EDGE_TYPES.join(", ")}`);
        continue;
      }
      for (const ref of refs) {
        const edge =
          mapping.nodeEdges.edgeDirection === "deps-block-this-node"
            ? {
                from: ref,
                to: planned.sourceId,
                type,
                source: `nodeEdges:${mapping.nodeEdges.path}`,
              }
            : {
                from: planned.sourceId,
                to: ref,
                type,
                source: `nodeEdges:${mapping.nodeEdges.path}`,
              };
        planImportEdge(edge, plannedImportEdges, report, plannedEdges);
      }
    }
  }

  if (report.errors.length === 0) {
    const nodeIds = new Set(plannedNodes.map((node) => node.sourceId));
    if (nodeIds.size !== plannedNodes.length)
      report.errors.push("Import contains duplicate node ids");
    for (const edge of plannedImportEdges) {
      if (!nodeIds.has(edge.from))
        report.errors.push(`edge references missing from node: ${edge.from}`);
      if (!nodeIds.has(edge.to)) report.errors.push(`edge references missing to node: ${edge.to}`);
    }
    const cycle = findImportCycle(plannedImportEdges.filter((edge) => edge.type === "requires"));
    if (cycle) report.errors.push(`requires edge cycle detected: ${cycle.join(" -> ")}`);
  }

  if (report.errors.length === 0 && !dryRun) {
    const existingNodes = await listNodes(root);
    if (existingNodes.length > 0) {
      report.errors.push(
        "qd import requires an empty qd DAG. Run imports before creating nodes, or use --dry-run to inspect a mapping.",
      );
    }
  }

  if (report.errors.length === 0 && !dryRun) {
    for (const planned of plannedNodes) importedNodes.push(await addNode(root, planned.input));
    for (const edge of plannedImportEdges) {
      importedEdges.push(await addEdge(root, edge.from, edge.to, edge.type));
    }
  }

  if (dryRun && report.errors.length === 0) {
    importedNodes.push(...plannedNodes.map((node) => node.input));
    importedEdges.push(...plannedImportEdges);
  }

  report.importedNodes = importedNodes.length;
  report.importedEdges = importedEdges.length;
  report.ok = report.errors.length === 0;
  output(report, json);
  if (!report.ok) process.exitCode = 1;
}

async function promptCommand(
  root: string,
  action: string | undefined,
  id: string | undefined,
  json: boolean,
): Promise<void> {
  const kind = action ?? "plan";
  const node = kind === "implement" && id ? await getNode(root, id) : null;
  const prompt = promptText(kind, node);
  if (json) {
    output({ schemaVersion: 1, kind, nodeId: id ?? null, node, prompt }, true);
    return;
  }
  if (action === "implement" && id) {
    console.log(prompt);
    return;
  }
  console.log(prompt);
}

async function runConfiguredCheck(
  root: string,
  nodeId: string,
  kind: "check" | "ci",
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const config = await readConfig(root);
  if (config.requireGateBeforeCi) {
    const gate = await gateNode(root, nodeId);
    if (!gate.ok) {
      output({ ok: false, blocking: gate.blocking }, json);
      process.exitCode = 1;
      return;
    }
  }

  if (config.requireCleanWorktree) await assertCleanWorktree(root, config.cleanWorktreeExcept);

  const node = await getNode(root, nodeId);
  const command =
    stringOpt(options.cmd) ??
    node.check_command ??
    (kind === "ci" ? config.ciCommand : config.checkCommand);
  const paths = getProjectPaths(root);
  await mkdir(paths.logsDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const logPath = path.join(
    paths.logsDir,
    `${kind}-${nodeId}-${startedAt.replace(/[:.]/g, "-")}.log`,
  );
  const exitCode = await runShellCommand(command, root, logPath);
  const finishedAt = new Date().toISOString();
  const status = exitCode === 0 ? "passed" : "failed";
  const recorder = kind === "ci" ? recordCiResult : recordCheckResult;
  const updatedNode = await recorder(root, nodeId, {
    status,
    summary: `${kind} command ${status}: ${command}`,
    logPath,
    startedAt,
    finishedAt,
  });
  const result = {
    ok: exitCode === 0,
    exitCode,
    command,
    logPath,
    node: updatedNode,
  };
  output(result, json);
  if (exitCode !== 0) process.exitCode = exitCode;
}

async function assertCleanWorktree(root: string, except: string[]): Promise<void> {
  const result = await captureCommand("git", ["status", "--porcelain"], root);
  if (result.code !== 0) throw new Error("require_clean_worktree is true, but git status failed");
  const dirtyLines = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !isExceptedDirtyPath(line.slice(3), except));
  if (dirtyLines.length > 0) {
    throw new Error(`Worktree must be clean before CI/check runs:\n${dirtyLines.join("\n")}`);
  }
}

function isExceptedDirtyPath(filePath: string, except: string[]): boolean {
  return except.some(
    (entry) => filePath === entry || filePath.startsWith(entry.endsWith("/") ? entry : `${entry}/`),
  );
}

function runShellCommand(command: string, cwd: string, logPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      void appendFile(logPath, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      void appendFile(logPath, chunk);
    });
    child.on("error", reject);
    child.on("exit", (code: number | null) => resolve(code ?? 1));
  });
}

function captureCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("exit", (code: number | null) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}

async function agentCommand(
  root: string,
  action: string | undefined,
  targetArg: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "install") {
    const requested = targetArg ?? stringOpt(options.agent) ?? "skills-sh";
    const target = stringOpt(options.target);
    if (requested !== "skills-sh" && requested !== "codex" && requested !== "claude") {
      throw new Error("agent install target must be skills-sh, codex, or claude");
    }
    await installSkill(root, target);
    return output(
      {
        ok: true,
        agent: requested,
        target: target ?? ".qd/skills/qd-dag/SKILL.md",
      },
      json,
    );
  }
  if (action === "doctor") return doctor(root, json);
  throw new Error(`Unknown agent action: ${action}`);
}

async function installSkill(root: string, target?: string): Promise<void> {
  const skillPath = path.resolve(root, target ?? ".qd/skills/qd-dag/SKILL.md");
  await mkdir(path.dirname(skillPath), { recursive: true });
  await writeFile(skillPath, skillText, "utf8");
}

interface ImportMapping {
  nodesPath?: string;
  edgesPath?: string;
  id?: string;
  title?: string;
  kind?: string;
  milestone?: string;
  group?: string;
  projects?: string;
  status?: string;
  priority?: string;
  estimate?: string;
  risk?: string;
  spec?: ImportTextMapping;
  acceptance?: ImportTextMapping;
  validation?: string;
  verification?: string;
  auditFocus?: string;
  context?: string;
  statusReason?: string;
  statusMap?: Record<string, NodeStatus>;
  nodeEdges?: ImportNodeEdgesMapping;
  edgeFrom?: string;
  edgeTo?: string;
  edgeType?: string;
}

type ImportTextMapping = string | ImportFoldMapping;

interface ImportFoldMapping {
  concat: string[];
  separator?: string;
  preamble?: Record<string, string>;
}

interface ImportNodeEdgesMapping {
  path: string;
  edgeDirection: "deps-block-this-node" | "this-node-blocks-deps";
  edgeType?: EdgeType;
}

interface ImportReport {
  ok: boolean;
  dryRun: boolean;
  nodesFound: number;
  edgesFound: number;
  importedNodes: number;
  importedEdges: number;
  defaults: Array<{ nodeId: string; field: string; value: string | number; reason: string }>;
  droppedFields: Array<{ nodeId: string; fields: string[] }>;
  warnings: string[];
  errors: string[];
  nodes: AddNodeInput[];
  edges: PlannedImportEdge[];
}

interface PlannedImportNode {
  sourceId: string;
  raw: unknown;
  input: AddNodeInput;
}

interface PlannedImportEdge {
  from: string;
  to: string;
  type: EdgeType;
  source: string;
}

const defaultImportMapping: ImportMapping = {
  nodesPath: "nodes",
  edgesPath: "edges",
  id: "id",
  title: "title",
  kind: "kind",
  milestone: "milestone",
  group: "group_name",
  projects: "projects",
  status: "status",
  priority: "priority",
  estimate: "estimate_points",
  risk: "risk",
  spec: "spec",
  acceptance: "acceptance",
  validation: "validation",
  verification: "verification",
  auditFocus: "audit_focus",
  context: "context",
  statusReason: "status_reason",
  edgeFrom: "from_node",
  edgeTo: "to_node",
  edgeType: "type",
};

const NODE_KINDS = ["feature", "fix", "refactor", "test", "docs", "infra", "audit-fix"] as const;
const NODE_STATUSES = [
  "draft",
  "ready",
  "claimed",
  "working",
  "review",
  "fixing",
  "ci",
  "mergeable",
  "done",
  "regressed",
  "blocked",
  "cancelled",
] as const;
const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
const RISKS = ["low", "medium", "high"] as const;
const EDGE_TYPES = ["requires", "unblocks", "supersedes", "related"] as const;

function mapImportNode(
  raw: unknown,
  index: number,
  mapping: ImportMapping,
  report: ImportReport,
  verbose: boolean,
): PlannedImportNode {
  const id = stringAt(raw, mapping.id ?? "id");
  if (!id) throw new Error(`nodes[${index}] is missing required id field (${mapping.id ?? "id"})`);
  const title = stringAt(raw, mapping.title ?? "title") ?? id;
  if (title === id && !stringAt(raw, mapping.title ?? "title")) {
    defaultImportValue(report, id, "title", id, `missing ${mapping.title ?? "title"}`);
  }
  const spec = textAt(raw, mapping.spec ?? "spec", `nodes[${index}].spec`);
  if (!spec) throw new Error(`node ${id}: mapped spec is required`);
  const acceptance = textAt(raw, mapping.acceptance ?? "acceptance", `nodes[${index}].acceptance`);
  if (!acceptance) throw new Error(`node ${id}: mapped acceptance is required`);

  const input: AddNodeInput = {
    id,
    title,
    kind: mappedEnum(raw, mapping.kind ?? "kind", isNodeKind, "kind", "feature", id, report),
    milestone: stringAt(raw, mapping.milestone ?? "milestone"),
    groupName: stringAt(raw, mapping.group ?? "group"),
    projects: strictStringArrayAt(raw, mapping.projects ?? "projects", `node ${id}.projects`),
    status: mappedStatus(raw, mapping, id, report),
    priority: mappedEnum(
      raw,
      mapping.priority ?? "priority",
      isPriority,
      "priority",
      "P2",
      id,
      report,
    ),
    estimatePoints: mappedEstimate(raw, mapping.estimate ?? "estimate", id, report),
    risk: mappedEnum(raw, mapping.risk ?? "risk", isRisk, "risk", "medium", id, report),
    spec,
    acceptance,
    validation: stringAt(raw, mapping.validation ?? "validation"),
    verification: strictVerificationArrayAt(
      raw,
      mapping.verification ?? "verification",
      `node ${id}.verification`,
    ),
    auditFocus: strictStringArrayAt(
      raw,
      mapping.auditFocus ?? "auditFocus",
      `node ${id}.auditFocus`,
    ),
    context: stringAt(raw, mapping.context ?? "context"),
    statusReason: stringAt(raw, mapping.statusReason ?? "statusReason"),
  };
  if (verbose)
    importVerbose(
      `node ${id}: status=${input.status} priority=${input.priority} risk=${input.risk}`,
    );
  return { sourceId: id, raw, input };
}

function mappedStatus(
  raw: unknown,
  mapping: ImportMapping,
  nodeId: string,
  report: ImportReport,
): NodeStatus {
  const sourceStatus = stringAt(raw, mapping.status ?? "status");
  if (!sourceStatus) {
    defaultImportValue(report, nodeId, "status", "ready", `missing ${mapping.status ?? "status"}`);
    return "ready";
  }
  const mapped = mapping.statusMap?.[sourceStatus];
  if (mapped) {
    if (!isNodeStatus(mapped))
      throw new Error(`statusMap.${sourceStatus} must be one of ${NODE_STATUSES.join(", ")}`);
    return mapped;
  }
  if (isNodeStatus(sourceStatus)) return sourceStatus;
  throw new Error(
    `node ${nodeId}: unknown status "${sourceStatus}"; add statusMap.${sourceStatus} to the import mapping`,
  );
}

function mappedEnum<T extends string>(
  raw: unknown,
  pathText: string,
  isValue: (value: string) => value is T,
  field: string,
  fallback: T,
  nodeId: string,
  report: ImportReport,
): T {
  const value = stringAt(raw, pathText);
  if (!value) {
    defaultImportValue(report, nodeId, field, fallback, `missing ${pathText}`);
    return fallback;
  }
  if (!isValue(value)) throw new Error(`node ${nodeId}: ${field} "${value}" is not valid`);
  return value;
}

function mappedEstimate(
  raw: unknown,
  pathText: string,
  nodeId: string,
  report: ImportReport,
): number {
  const value = valueAtPath(raw, pathText);
  if (value === undefined) {
    defaultImportValue(report, nodeId, "estimate_points", 1, `missing ${pathText}`);
    return 1;
  }
  const parsed = numberAt(raw, pathText);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`node ${nodeId}: estimate at ${pathText} must be a positive integer`);
  }
  return parsed;
}

function textAt(source: unknown, mapping: ImportTextMapping, label: string): string | undefined {
  if (typeof mapping === "string") {
    const value = valueAtPath(source, mapping);
    if (value === undefined) return undefined;
    if (typeof value !== "string")
      throw new Error(`${label}: ${mapping} must be a string or use a fold descriptor`);
    return value.trim() ? value : undefined;
  }
  if (!Array.isArray(mapping.concat) || mapping.concat.length === 0) {
    throw new Error(`${label}: fold descriptor requires a non-empty concat array`);
  }
  const parts: string[] = [];
  for (const pathText of mapping.concat) {
    const value = valueAtPath(source, pathText);
    if (value === undefined) continue;
    const preamble = mapping.preamble?.[pathText] ?? "";
    if (typeof value === "string") {
      if (value.trim()) parts.push(`${preamble}${value}`);
      continue;
    }
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      const items = value.filter((item) => item.trim());
      if (items.length > 0) parts.push(`${preamble}${items.join(mapping.separator ?? "\n")}`);
      continue;
    }
    throw new Error(`${label}: ${pathText} must be a string or string array`);
  }
  const text = parts.join("");
  return text.trim() ? text : undefined;
}

function planImportEdge(
  edge: PlannedImportEdge,
  planned: PlannedImportEdge[],
  report: ImportReport,
  seen: Set<string>,
): void {
  if (edge.from === edge.to) {
    report.errors.push(`edge ${edge.from} -> ${edge.to} from ${edge.source} points to itself`);
    return;
  }
  const key = `${edge.from}\0${edge.to}\0${edge.type}`;
  if (seen.has(key)) {
    report.warnings.push(
      `duplicate edge skipped: ${edge.from} -> ${edge.to} (${edge.type}) from ${edge.source}`,
    );
    return;
  }
  seen.add(key);
  planned.push(edge);
  report.edges.push(edge);
}

function validateNodeEdgesMapping(mapping: ImportNodeEdgesMapping): void {
  if (!mapping.path) throw new Error("nodeEdges.path is required");
  if (
    mapping.edgeDirection !== "deps-block-this-node" &&
    mapping.edgeDirection !== "this-node-blocks-deps"
  ) {
    throw new Error(
      "nodeEdges.edgeDirection must be deps-block-this-node or this-node-blocks-deps",
    );
  }
}

function defaultImportValue(
  report: ImportReport,
  nodeId: string,
  field: string,
  value: string | number,
  reason: string,
): void {
  report.defaults.push({ nodeId, field, value, reason });
}

function importVerbose(message: string): void {
  console.error(`[qd import] ${message}`);
}

function usedNodeMappingKeys(mapping: ImportMapping): Set<string> {
  const keys = new Set<string>();
  for (const value of [
    mapping.id ?? "id",
    mapping.title ?? "title",
    mapping.kind ?? "kind",
    mapping.milestone ?? "milestone",
    mapping.group ?? "group",
    mapping.projects ?? "projects",
    mapping.status ?? "status",
    mapping.priority ?? "priority",
    mapping.estimate ?? "estimate",
    mapping.risk ?? "risk",
    mapping.validation ?? "validation",
    mapping.verification ?? "verification",
    mapping.auditFocus ?? "auditFocus",
    mapping.context ?? "context",
    mapping.statusReason ?? "statusReason",
  ]) {
    keys.add(topLevelKey(value));
  }
  addTextMappingKeys(keys, mapping.spec ?? "spec");
  addTextMappingKeys(keys, mapping.acceptance ?? "acceptance");
  if (mapping.nodeEdges) keys.add(topLevelKey(mapping.nodeEdges.path));
  return keys;
}

function addTextMappingKeys(keys: Set<string>, mapping: ImportTextMapping): void {
  if (typeof mapping === "string") {
    keys.add(topLevelKey(mapping));
    return;
  }
  for (const pathText of mapping.concat) keys.add(topLevelKey(pathText));
}

function topLevelKey(pathText: string): string {
  return pathText.split(".")[0] ?? pathText;
}

function droppedTopLevelKeys(source: unknown, used: Set<string>): string[] {
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  return Object.keys(source as Record<string, unknown>)
    .filter((key) => !used.has(key))
    .sort();
}

function findImportCycle(edges: Array<Pick<PlannedImportEdge, "from" | "to">>): string[] | null {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    graph.set(edge.from, [...(graph.get(edge.from) ?? []), edge.to]);
    if (!graph.has(edge.to)) graph.set(edge.to, []);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(node: string): string[] | null {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (visited.has(node)) return null;
    visiting.add(node);
    stack.push(node);
    for (const child of graph.get(node) ?? []) {
      const cycle = visit(child);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

async function importFindingsFromReport(
  root: string,
  reportPath: string,
  nodeIdArg?: string,
): Promise<unknown> {
  const report = JSON.parse(await readFile(path.resolve(root, reportPath), "utf8")) as unknown;
  const nodeId = nodeIdArg ?? stringAt(report, "nodeId") ?? stringAt(report, "node_id");
  if (!nodeId)
    throw new Error("Report must include nodeId/node_id or command must provide node id");
  const findings = arrayAtPath(report, "findings");
  if (findings.length === 0) throw new Error("Report must include a non-empty findings array");
  const imported = [];
  for (const [index, raw] of findings.entries()) {
    const severity = stringAt(raw, "severity") ?? "P2";
    if (!isPriority(severity))
      throw new Error(`findings[${index}].severity must be P0, P1, P2, or P3`);
    const title = stringAt(raw, "title");
    if (!title) throw new Error(`findings[${index}].title is required`);
    const evidence = stringAt(raw, "evidence") ?? stringAt(raw, "body");
    if (!evidence) throw new Error(`findings[${index}].evidence is required`);
    imported.push(
      await addFinding(root, nodeId, {
        severity,
        title,
        evidence,
        path: stringAt(raw, "path"),
        line: numberAt(raw, "line") ?? null,
        expected: stringAt(raw, "expected"),
        suggestedFix: stringAt(raw, "suggested_fix") ?? stringAt(raw, "suggestedFix"),
      }),
    );
  }
  return { nodeId, importedFindings: imported.length, findings: imported };
}

function viewCommand(options: Record<string, string | string[] | boolean>): Promise<void> {
  const port = stringOpt(options.port) ?? "5173";
  const child = spawn(
    "corepack",
    ["pnpm", "exec", "vp", "run", "@qdcli/viewer#dev", "--", "--host", "127.0.0.1", "--port", port],
    {
      cwd: findWorkspaceRoot(),
      env: { ...process.env, QD_ROOT: process.cwd() },
      stdio: "inherit",
    },
  );
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code: number | null) =>
      code === 0 ? resolve() : reject(new Error(`viewer exited with code ${code}`)),
    );
  });
}

function parseArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  const options: Record<string, string | string[] | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        const current = options[key];
        if (Array.isArray(current)) current.push(next);
        else if (typeof current === "string") options[key] = [current, next];
        else options[key] = next;
        i += 1;
      } else {
        options[key] = true;
      }
    } else {
      command.push(arg);
    }
  }
  return { command, options };
}

function output(value: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (Array.isArray(value)) {
    console.table(value);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

function required(value: string | string[] | boolean | undefined, name: string): string {
  const resolved = stringOpt(value);
  if (!resolved) throw new Error(`${name} is required`);
  return resolved;
}

function requiredArg(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function setConfigValue(config: QdConfig, key: string, value: string): QdConfig {
  if (key === "check_command" || key === "check-command") return { ...config, checkCommand: value };
  if (key === "ci_command" || key === "ci-command") return { ...config, ciCommand: value };
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
  throw new Error(`Unknown config key: ${key}`);
}

function getConfigValue(config: QdConfig, key: string): unknown {
  if (key === "check_command" || key === "check-command") return config.checkCommand;
  if (key === "ci_command" || key === "ci-command") return config.ciCommand;
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
  throw new Error(`Unknown config key: ${key}`);
}

function parseBoolean(value: string, key: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${key} must be true or false`);
}

function stringOpt(value: string | string[] | boolean | undefined): string | undefined {
  if (Array.isArray(value)) return value.at(-1);
  return typeof value === "string" ? value : undefined;
}

function stringListOpt(value: string | string[] | boolean | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  return [];
}

function numberOpt(value: string | string[] | boolean | undefined): number | undefined {
  const text = stringOpt(value);
  if (!text) return undefined;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Error(`Expected number, got ${text}`);
  return parsed;
}

function requiredNumber(value: string | string[] | boolean | undefined, name: string): number {
  const parsed = numberOpt(value);
  if (parsed === undefined || Number.isNaN(parsed)) throw new Error(`${name} is required`);
  return parsed;
}

function strictEnumOpt<T extends string>(
  value: string | string[] | boolean | undefined,
  isValue: (candidate: string) => candidate is T,
  label: string,
  fallback: T,
): T;
function strictEnumOpt<T extends string>(
  value: string | string[] | boolean | undefined,
  isValue: (candidate: string) => candidate is T,
  label: string,
): T | undefined;
function strictEnumOpt<T extends string>(
  value: string | string[] | boolean | undefined,
  isValue: (candidate: string) => candidate is T,
  label: string,
  fallback?: T,
): T | undefined {
  const text = stringOpt(value);
  if (!text) return fallback;
  if (!isValue(text))
    throw new Error(`${label} must be one of ${validValuesFor(isValue).join(", ")}`);
  return text;
}

function strictOptionalEnum<T extends string>(
  value: string | undefined,
  isValue: (candidate: string) => candidate is T,
  label: string,
  fallback: T,
): T {
  if (!value) return fallback;
  if (!isValue(value))
    throw new Error(`${label} must be one of ${validValuesFor(isValue).join(", ")}`);
  return value;
}

function validValuesFor(isValue: (candidate: string) => boolean): readonly string[] {
  if (isValue === isNodeKind) return NODE_KINDS;
  if (isValue === isNodeStatus) return NODE_STATUSES;
  if (isValue === isPriority) return PRIORITIES;
  if (isValue === isRisk) return RISKS;
  if (isValue === isEdgeType) return EDGE_TYPES;
  return [];
}

function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value);
}

function isNodeKind(value: string): value is NodeKind {
  return (NODE_KINDS as readonly string[]).includes(value);
}

function isNodeStatus(value: string): value is NodeStatus {
  return (NODE_STATUSES as readonly string[]).includes(value);
}

function isRisk(value: string): value is Risk {
  return (RISKS as readonly string[]).includes(value);
}

function isEdgeType(value: string): value is EdgeType {
  return (EDGE_TYPES as readonly string[]).includes(value);
}

function parseVerification(value: string): VerificationEntry {
  const fields = Object.fromEntries(
    value.split(",").map((part) => {
      const [key, ...rest] = part.split("=");
      return [key?.trim(), rest.join("=").trim()];
    }),
  );
  const type = fields.type || "manual";
  const entryValue = fields.value || value;
  if (type !== "command" && type !== "manual" && type !== "url" && type !== "note") {
    throw new Error(`Unknown verification type: ${type}`);
  }
  return { type, value: entryValue };
}

function strictArrayAtPath(source: unknown, pathText: string, requiredPath: boolean): unknown[] {
  const value = valueAtPath(source, pathText);
  if (value === undefined) {
    if (requiredPath) throw new Error(`Expected ${pathText} to be an array`);
    return [];
  }
  if (!Array.isArray(value)) throw new Error(`Expected ${pathText} to be an array`);
  return value;
}

function arrayAtPath(source: unknown, pathText: string): unknown[] {
  const value = valueAtPath(source, pathText);
  return Array.isArray(value) ? value : [];
}

function stringAt(source: unknown, pathText: string): string | undefined {
  const value = valueAtPath(source, pathText);
  return typeof value === "string" ? value : undefined;
}

function numberAt(source: unknown, pathText: string): number | undefined {
  const value = valueAtPath(source, pathText);
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function strictStringArrayAt(source: unknown, pathText: string, label: string): string[] {
  const value = valueAtPath(source, pathText);
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (!Array.isArray(value)) throw new Error(`${label} at ${pathText} must be a string array`);
  const invalidIndex = value.findIndex((item) => typeof item !== "string");
  if (invalidIndex !== -1)
    throw new Error(`${label} at ${pathText}[${invalidIndex}] must be a string`);
  return value.filter((item) => item.trim());
}

function strictVerificationArrayAt(
  source: unknown,
  pathText: string,
  label: string,
): VerificationEntry[] {
  const value = valueAtPath(source, pathText);
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} at ${pathText} must be an array`);
  return value.map((item, index): VerificationEntry => {
    if (typeof item === "string") return parseVerification(item);
    if (item && typeof item === "object") {
      const type = stringAt(item, "type") ?? "manual";
      const entryValue = stringAt(item, "value");
      if (!entryValue) throw new Error(`${label}[${index}].value is required`);
      return parseVerification(`type=${type},value=${entryValue}`);
    }
    throw new Error(`${label}[${index}] must be a string or object`);
  });
}

function valueAtPath(source: unknown, pathText: string): unknown {
  return pathText.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, source);
}

function toMermaid(snapshot: Awaited<ReturnType<typeof graphSnapshot>>): string {
  const lines = ["flowchart TD"];
  for (const node of snapshot.nodes) {
    lines.push(`  ${safeId(node.id)}["${node.id}: ${node.title.replaceAll('"', "'")}"]`);
  }
  for (const edge of snapshot.edges.filter((item) => item.type === "requires")) {
    lines.push(`  ${safeId(edge.from_node)} --> ${safeId(edge.to_node)}`);
  }
  return lines.join("\n");
}

function toDot(snapshot: Awaited<ReturnType<typeof graphSnapshot>>): string {
  const lines = ["digraph qd {"];
  for (const node of snapshot.nodes)
    lines.push(`  "${node.id}" [label="${node.id}: ${node.title.replaceAll('"', "'")}"];`);
  for (const edge of snapshot.edges.filter((item) => item.type === "requires"))
    lines.push(`  "${edge.from_node}" -> "${edge.to_node}";`);
  lines.push("}");
  return lines.join("\n");
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function findWorkspaceRoot(): string {
  return path.resolve(new URL("../../..", import.meta.url).pathname);
}

function helpText(): string {
  return `qd - Quick DAG CLI

Core:
  qd init
  qd setup [--no-hooks] [--print-agent-url]
  qd doctor [--json]
  qd status [--json]
  qd stats [--json] [--window 7] [--milestone <name>]
  qd snapshot [--json] [--milestone <name>]
  qd ready [--json]
  qd graph --format table|json|mermaid|dot
  qd velocity [--window 7]
  qd critical-path [--milestone <name>]
  qd eta [--window 7] [--milestone <name>]
  qd prompt plan|implement|audit|resolve [node] [--json]
  qd config show
  qd config get ci-command
  qd config set check-command --value "<fast project check command>"
  qd import --from roadmap/spec-dag.json --schema-mapping qd-import-map.json [--dry-run] [--verbose]

Graph:
  qd node add --title <text> --spec <text> --acceptance <text> [--id <id>] [--project <name>] [--verify type=command,value="<command>"]
  qd node list|show|edit|cancel|note
  qd group register --name <name>
  qd project register --name <name>
  qd milestone register --name <name> --rank <n>
  qd edge add <from> <to> [--type requires]
  qd claim [node] --agent <name>
  qd complete <node> --summary <text>

Audit:
  qd audit start <node>
  qd finding add <node> --severity P1 --title <text> --evidence <text>
  qd finding add [node] --from-report <audit-report.json>
  qd finding resolve <finding>
  qd gate <node>
  qd check run <node>
  qd ci run <node>

Viewer:
  qd view [--port 5173]`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
