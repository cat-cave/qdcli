import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  addEdge,
  addFinding,
  addNode,
  cancelNode,
  ciFail,
  ciPass,
  claimNode,
  completeNode,
  gateNode,
  getNode,
  graphSnapshot,
  initProject,
  listEdges,
  listNodes,
  markMerged,
  promoteFindings,
  readyNodes,
  removeEdge,
  resolveFinding,
  setupProject,
  startRun,
  stats,
  updateNode,
  validateGraph,
  type EdgeType,
  type NodeKind,
  type NodeStatus,
  type Priority,
  type Risk,
} from "@qdcli/core";
import { promptText, skillText } from "./prompts.js";

interface ParsedArgs {
  command: string[];
  options: Record<string, string | boolean>;
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
      return output({ ok: true, message: "Initialized qd and installed skills.sh skill" }, json);
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
      return output(await completeNode(root, requiredArg(action, "node id"), required(args.options.summary, "--summary")), json);
    case "audit":
      return output(await startRun(root, requiredArg(action === "start" ? extra : action, "node id"), "audit"), json);
    case "finding":
      return findingCommand(root, action, extra, args.options, json);
    case "promote-findings":
      return output(await promoteFindings(root, requiredArg(action, "node id")), json);
    case "gate":
      return gate(root, requiredArg(action, "node id"), json);
    case "ci":
      return ciCommand(root, action, extra, args.options, json);
    case "merge":
      return output(await markMerged(root, requiredArg(action, "node id"), stringOpt(args.options.strategy) ?? "squash"), json);
    case "plan":
      return planCommand(root, action, args.options, json);
    case "milestone":
      return output(await stats(root), json);
    case "velocity":
    case "eta":
    case "stats":
      return output(await stats(root), json);
    case "prompt":
      return promptCommand(root, action, extra);
    case "agent":
      return agentCommand(root, action, args.options, json);
    case "view":
      return viewCommand(args.options);
    default:
      throw new Error(`Unknown command: ${group}`);
  }
}

async function doctor(root: string, json: boolean): Promise<void> {
  await initProject(root);
  const validationResult = await validateGraph(root);
  const result = {
    ok: validationResult.ok,
    checks: {
      initialized: true,
      schema: true,
      graph: validationResult.ok,
    },
    errors: validationResult.errors,
    warnings: validationResult.warnings,
  };
  output(result, json);
  if (!result.ok) process.exitCode = 1;
}

async function graph(root: string, options: Record<string, string | boolean>, json: boolean): Promise<void> {
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

async function nodeCommand(
  root: string,
  action: string | undefined,
  id: string | undefined,
  options: Record<string, string | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "add") {
    return output(
      await addNode(root, {
        id: stringOpt(options.id),
        title: required(options.title, "--title"),
        kind: enumOpt<NodeKind>(options.kind) ?? "feature",
        milestone: stringOpt(options.milestone),
        status: enumOpt<NodeStatus>(options.status) ?? "ready",
        priority: enumOpt<Priority>(options.priority) ?? "P2",
        estimatePoints: numberOpt(options.estimate) ?? 1,
        risk: enumOpt<Risk>(options.risk) ?? "medium",
        spec: required(options.spec, "--spec"),
        acceptance: required(options.acceptance, "--acceptance"),
        validation: stringOpt(options.validation),
        context: stringOpt(options.context),
      }),
      json,
    );
  }
  if (action === "show") return output(await getNode(root, requiredArg(id, "node id")), json);
  if (action === "list" || !action) return output(await listNodes(root), json);
  if (action === "cancel") return output(await cancelNode(root, requiredArg(id, "node id")), json);
  if (action === "edit") {
    return output(
      await updateNode(root, requiredArg(id, "node id"), {
        title: stringOpt(options.title),
        kind: enumOpt<NodeKind>(options.kind),
        milestone: stringOpt(options.milestone),
        status: enumOpt<NodeStatus>(options.status),
        priority: enumOpt<Priority>(options.priority),
        estimatePoints: numberOpt(options.estimate),
        risk: enumOpt<Risk>(options.risk),
        spec: stringOpt(options.spec),
        acceptance: stringOpt(options.acceptance),
        validation: stringOpt(options.validation),
        context: stringOpt(options.context),
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
  options: Record<string, string | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "add") {
    return output(
      await addEdge(root, requiredArg(values[0], "from node"), requiredArg(values[1], "to node"), enumOpt<EdgeType>(options.type) ?? "requires"),
      json,
    );
  }
  if (action === "remove") {
    await removeEdge(root, requiredArg(values[0], "from node"), requiredArg(values[1], "to node"), enumOpt<EdgeType>(options.type) ?? "requires");
    return output({ ok: true }, json);
  }
  if (action === "list" || !action) return output(await listEdges(root), json);
  throw new Error(`Unknown edge action: ${action}`);
}

async function findingCommand(
  root: string,
  action: string | undefined,
  nodeOrFinding: string | undefined,
  options: Record<string, string | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "add") {
    return output(
      await addFinding(root, requiredArg(nodeOrFinding, "node id"), {
        severity: enumOpt<Priority>(options.severity) ?? "P2",
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
  if (action === "resolve") return output(await resolveFinding(root, requiredArg(nodeOrFinding, "finding id")), json);
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
  options: Record<string, string | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "start") {
    return output(await startRun(root, requiredArg(nodeId, "node id"), "ci", { summary: stringOpt(options.cmd) }), json);
  }
  if (action === "pass") return output(await ciPass(root, requiredArg(nodeId, "node id"), stringOpt(options.summary)), json);
  if (action === "fail") return output(await ciFail(root, requiredArg(nodeId, "node id"), stringOpt(options.summary)), json);
  throw new Error(`Unknown ci action: ${action}`);
}

async function planCommand(
  root: string,
  action: string | undefined,
  options: Record<string, string | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "export") return graph(root, { ...options, format: stringOpt(options.format) ?? "json" }, json);
  if (action === "import") {
    throw new Error("qd plan import is reserved for the next trial iteration; use qd node add and qd edge add for now");
  }
  throw new Error(`Unknown plan action: ${action}`);
}

async function promptCommand(root: string, action: string | undefined, id: string | undefined): Promise<void> {
  if (action === "implement" && id) {
    console.log(promptText("implement", await getNode(root, id)));
    return;
  }
  console.log(promptText(action ?? "plan"));
}

async function agentCommand(
  root: string,
  action: string | undefined,
  options: Record<string, string | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "install") {
    const target = stringOpt(options.target);
    await installSkill(root, target);
    return output({ ok: true, target: target ?? ".qd/skills/qd-dag/SKILL.md" }, json);
  }
  if (action === "doctor") return doctor(root, json);
  throw new Error(`Unknown agent action: ${action}`);
}

async function installSkill(root: string, target?: string): Promise<void> {
  const skillPath = path.resolve(root, target ?? ".qd/skills/qd-dag/SKILL.md");
  await mkdir(path.dirname(skillPath), { recursive: true });
  await writeFile(skillPath, skillText, "utf8");
}

function viewCommand(options: Record<string, string | boolean>): Promise<void> {
  const port = stringOpt(options.port) ?? "5173";
  const child = spawn("corepack", ["pnpm", "--filter", "@qdcli/viewer", "dev", "--host", "127.0.0.1", "--port", port], {
    cwd: findWorkspaceRoot(),
    env: { ...process.env, QD_ROOT: process.cwd() },
    stdio: "inherit",
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code: number | null) =>
      code === 0 ? resolve() : reject(new Error(`viewer exited with code ${code}`)),
    );
  });
}

function parseArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        options[key] = next;
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

function required(value: string | boolean | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function requiredArg(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function stringOpt(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOpt(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected number, got ${value}`);
  return parsed;
}

function enumOpt<T extends string>(value: string | boolean | undefined): T | undefined {
  return typeof value === "string" ? (value as T) : undefined;
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
  for (const node of snapshot.nodes) lines.push(`  "${node.id}" [label="${node.id}: ${node.title.replaceAll('"', "'")}"];`);
  for (const edge of snapshot.edges.filter((item) => item.type === "requires")) lines.push(`  "${edge.from_node}" -> "${edge.to_node}";`);
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
  qd setup
  qd doctor [--json]
  qd status [--json]
  qd ready [--json]
  qd graph --format table|json|mermaid|dot

Graph:
  qd node add --title <text> --spec <text> --acceptance <text> [--id <id>]
  qd node list|show|edit|cancel
  qd edge add <from> <to> [--type requires]
  qd claim [node] --agent <name>
  qd complete <node> --summary <text>

Audit:
  qd audit start <node>
  qd finding add <node> --severity P1 --title <text> --evidence <text>
  qd finding resolve <finding>
  qd gate <node>

Viewer:
  qd view [--port 5173]`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
