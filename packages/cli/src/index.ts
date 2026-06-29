import { fileURLToPath } from "node:url";
import {
  analyticsReport,
  completeNode,
  criticalPathReport,
  etaReport,
  graphSnapshot,
  initProject,
  listRegistry,
  policyReport,
  promoteFindings,
  readyNodes,
  registerGroup,
  registerMilestone,
  registerProject,
  resolveProjectRoot,
  setupProject,
  startRun,
  unblockNode,
  velocityReport,
} from "@cat-cave/qdcli-core";
import {
  numberOpt,
  output,
  parseArgs,
  parseBoolean,
  parsePositiveInteger,
  required,
  requiredArg,
  requiredNumber,
  stringOpt,
} from "./args.js";
import { getConfigValue, setCiProviderConfig, setConfigValue } from "./config-options.js";
import {
  isPolicyPhase,
  parseNoteKindList,
  parseSeverityList,
  parseStatusList,
  strictEnumOpt,
} from "./enums.js";
import {
  numberAt,
  parseVerification,
  strictArrayAtPath,
  strictStringArrayAt,
  strictVerificationArrayAt,
  stringAt,
} from "./object-utils.js";
import {
  contentType,
  handleViewerRequest,
  hostForUrl,
  viewCommand,
  viewerFilePath,
} from "./viewer.js";
import {
  filterSnapshot,
  formatCell,
  formatRows,
  nextStepForNode,
  snapshotDiff,
} from "./graph-format.js";
import { diffCommand } from "./diff.js";
import { worktreeCommand } from "./worktree.js";
import { cliVersion, commandHelp, helpText, topicHelp } from "./help.js";
import { ciCommand } from "./ci.js";
import { advanceCommand, checkCommand, verificationCommand } from "./lifecycle.js";
import { assignmentCommand, waveCommand } from "./orchestration.js";
import { auditCommand, findingCommand, gate } from "./audit.js";
import {
  claimCommand,
  edgeCommand,
  mergeCommand,
  nodeCommand,
  nodesCommand,
  noteCommand,
} from "./graph-commands.js";
import { importCommand, syncCommand } from "./import-command.js";
import {
  configCommand,
  doctorCommand,
  exportCommand,
  graphCommand,
  migrateCommand,
  readyCommand,
  snapshotCommand,
  statusCommand,
  validationCommand,
  workspaceCommand,
} from "./project-commands.js";
import {
  agentCommand,
  envCommand,
  installSkill,
  promptCommand,
  readinessCommand,
  runCommand,
  schemaCommand,
  stateCommand,
} from "./runtime-commands.js";
import { isCliEntrypoint } from "./entrypoint.js";

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const [group, action, extra] = args.command;
  const json = Boolean(args.options.json);

  if (args.options.version || group === "version" || group === "--version" || group === "-v") {
    console.log(cliVersion());
    return;
  }

  if (!group || group === "help" || group === "--help" || group === "-h") {
    const topic = group === "help" ? action : undefined;
    if (topic) console.log(topicHelp(topic));
    else console.log(helpText());
    return;
  }

  if (args.options.help || args.options.h) {
    console.log(commandHelp(group, action));
    return;
  }

  if (group === "view" && args.options.check) {
    return viewCommand("", args.options, json);
  }

  const root = await resolveProjectRoot({
    root: stringOpt(args.options.root),
    allowMissing: group === "init" || group === "setup",
  });

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
      return doctorCommand(root, args.options, json);
    case "migrate":
    case "upgrade":
      return migrateCommand(root, json);
    case "status":
      return statusCommand(root, json);
    case "ready":
      return readyCommand(root, args.options, json);
    case "graph":
      return graphCommand(root, args.options, json);
    case "validate":
      return validationCommand(root, json);
    case "config":
      return configCommand(root, action, extra, args.command.slice(3), args.options, json);
    case "import":
      return importCommand(root, args.options, json);
    case "sync":
      return syncCommand(root, args.options, json);
    case "export":
      return exportCommand(root, args.options, json);
    case "group":
      return registryCommand(root, "groups", action, args.options, json);
    case "project":
      return registryCommand(root, "projects", action, args.options, json);
    case "node":
      return nodeCommand(root, action, extra, args.options, json);
    case "nodes":
      return nodesCommand(root, action, args.options, json);
    case "note":
      return noteCommand(root, action, extra, args.options, json);
    case "assignment":
      return assignmentCommand(root, action, extra, args.options, json);
    case "wave":
      return waveCommand(root, action, extra, args.command.slice(3), args.options, json);
    case "worktree":
      return worktreeCommand(root, action, extra, args.options, json);
    case "run":
      return runCommand(root, action, extra, args.options, json);
    case "state":
      return stateCommand(root, action, args.options, json);
    case "env":
      return envCommand(action, args.options, json);
    case "schema":
      return schemaCommand(action, extra, json);
    case "unblock":
      return output(
        await unblockNode(root, requiredArg(action, "node id"), {
          fromRunId: required(args.options["from-run"], "--from-run"),
          summary: required(args.options.summary, "--summary"),
        }),
        json,
      );
    case "merge-ready":
      return readinessCommand(root, action, "merge", json);
    case "completion-ready":
      return readinessCommand(root, action, "completion", json);
    case "edge":
      return edgeCommand(root, action, args.command.slice(2), args.options, json);
    case "claim":
      return claimCommand(root, action, args.options, json);
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
      return auditCommand(root, action, extra, args.options, json);
    case "finding":
      return findingCommand(root, action, extra, args.options, json);
    case "promote-findings":
      return output(
        { promoted: await promoteFindings(root, requiredArg(action, "node id")) },
        json,
      );
    case "gate":
      return gate(root, requiredArg(action, "node id"), args.options, json);
    case "advance":
      return advanceCommand(root, action, args.options, json);
    case "diff":
      return diffCommand(root, action, args.options, json);
    case "ci":
      return ciCommand(root, action, extra, args.options, json);
    case "check":
      return checkCommand(root, action, extra, args.options, json);
    case "verification":
      return verificationCommand(root, action, extra, args.options, json);
    case "merge":
      return mergeCommand(root, action, args.options, json);
    case "plan":
      return planCommand(root, action, args.options, json);
    case "policy":
      return policyCommand(root, action, extra, args.options, json);
    case "milestone":
      return milestoneCommand(root, action, extra, args.options, json);
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
      return promptCommand(root, action, extra, args.options, json);
    case "agent":
      return agentCommand(root, action, extra, args.options, json);
    case "workspace":
      return workspaceCommand(action, args.options, json);
    case "view":
      return viewCommand(root, args.options, json);
    default:
      throw new Error(`Unknown command: ${group}`);
  }
}

async function planCommand(
  root: string,
  action: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "export")
    return graphCommand(root, { ...options, format: stringOpt(options.format) ?? "json" }, json);
  if (action === "import") {
    throw new Error(
      "qd plan import is reserved for the next trial iteration; use qd node add and qd edge add for now",
    );
  }
  throw new Error(`Unknown plan action: ${action}`);
}

async function policyCommand(
  root: string,
  action: string | undefined,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action !== "evaluate" && action !== "check") {
    throw new Error(`Unknown policy action: ${action}`);
  }
  const phase = strictEnumOpt(options.phase, isPolicyPhase, "--phase", "ci");
  const result = await policyReport(root, requiredArg(nodeId, "node id"), phase);
  output(result, json);
  if (!result.ok) process.exitCode = 1;
}

async function milestoneCommand(
  root: string,
  action: string | undefined,
  name: string | undefined,
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
    const milestone = name ?? stringOpt(options.milestone) ?? null;
    return output(
      await analyticsReport(root, {
        milestone,
        windowDays: numberOpt(options.window) ?? 7,
      }),
      json,
    );
  }
  if (action === "remaining") {
    const milestone = requiredArg(name, "milestone name");
    const graph = await graphSnapshot(root);
    return output(
      formatRows(
        graph.nodes.filter((node) => node.milestone === milestone && node.status !== "done"),
        options,
      ),
      json,
    );
  }
  if (action === "blockers") {
    const milestone = requiredArg(name, "milestone name");
    const graph = await graphSnapshot(root);
    const nodeIds = new Set(
      graph.nodes.filter((node) => node.milestone === milestone).map((node) => node.id),
    );
    const findings = graph.findings.filter(
      (finding) =>
        nodeIds.has(finding.node_id) &&
        finding.status === "open" &&
        (finding.severity === "P0" || finding.severity === "P1"),
    );
    const runningAudits = graph.runs.filter(
      (runRow) =>
        nodeIds.has(runRow.node_id) && runRow.kind === "audit" && runRow.status === "running",
    );
    const blockedNodes = graph.nodes.filter(
      (node) => node.milestone === milestone && node.status === "blocked",
    );
    return output({ milestone, findings, runningAudits, blockedNodes }, json);
  }
  if (action === "critical-path") {
    return output(await criticalPathReport(root, requiredArg(name, "milestone name")), json);
  }
  if (action === "next") {
    const milestone = requiredArg(name, "milestone name");
    const limit = numberOpt(options.limit);
    const nodes = (await readyNodes(root)).filter((node) => node.milestone === milestone);
    return output(formatRows(limit ? nodes.slice(0, limit) : nodes, options), json);
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

export const __testing = {
  contentType,
  filterSnapshot,
  formatCell,
  formatRows,
  getConfigValue,
  handleViewerRequest,
  hostForUrl,
  nextStepForNode,
  numberAt,
  parseNoteKindList,
  parseSeverityList,
  parseStatusList,
  parseVerification,
  parseArgs,
  parseBoolean,
  parsePositiveInteger,
  setCiProviderConfig,
  setConfigValue,
  snapshotDiff,
  strictArrayAtPath,
  strictStringArrayAt,
  strictVerificationArrayAt,
  stringAt,
  isCliEntrypoint,
  viewerFilePath,
};

if (isCliEntrypoint(process.argv[1], fileURLToPath(import.meta.url))) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
