import {
  addEdge,
  addNode,
  addNodeNote,
  addNodesBulk,
  cancelNode,
  claimNode,
  getNode,
  listEdges,
  listFindings,
  listNodeNotes,
  listNodes,
  listRuns,
  markMerged,
  readConfig,
  removeEdge,
  updateNode,
} from "@cat-cave/qdcli-core";
import { output, required, requiredArg, stringOpt } from "./args.js";
import {
  isEdgeType,
  isMergeStrategy,
  isNoteKind,
  parseNoteKindList,
  strictEnumOpt,
  strictOptionalEnum,
} from "./enums.js";
import { readJson } from "./file-io.js";
import { filterNodes, formatRows } from "./graph-format.js";
import { nodeInputFromOptions, nodeUpdateFromOptions, normalizeNodeInput } from "./node-input.js";
import { asRecord, optionalStringField, requiredNodeStringField } from "./object-utils.js";
import { runPolicyHook } from "./shell.js";

export async function nodeCommand(
  root: string,
  action: string | undefined,
  id: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "add") {
    return output(await addNode(root, await nodeInputFromOptions(root, options)), json);
  }
  if (action === "note") return nodeNoteCommand(root, id, options, json);
  if (action === "show") return nodeShowCommand(root, id, options, json);
  if (action === "list" || !action)
    return output(formatRows(filterNodes(await listNodes(root), options), options), json);
  if (action === "cancel") return output(await cancelNode(root, requiredArg(id, "node id")), json);
  if (action === "edit") {
    return output(
      await updateNode(
        root,
        requiredArg(id, "node id"),
        await nodeUpdateFromOptions(root, options),
      ),
      json,
    );
  }
  throw new Error(`Unknown node action: ${action}`);
}

export async function nodesCommand(
  root: string,
  action: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action !== "add-bulk") throw new Error(`Unknown nodes action: ${action}`);
  const raw = await readJson(root, required(options["from-json"], "--from-json"));
  const rawNodes: unknown[] | undefined = Array.isArray(raw)
    ? (raw as unknown[])
    : Array.isArray(asRecord(raw, "--from-json").nodes)
      ? (asRecord(raw, "--from-json").nodes as unknown[])
      : undefined;
  if (!rawNodes) throw new Error("--from-json must contain an array or an object with nodes[]");
  const nodes = rawNodes.map((rawNode, index) => normalizeNodeInput(rawNode, `nodes[${index}]`));

  const source = Array.isArray(raw) ? null : asRecord(raw, "--from-json");
  if (source?.edges !== undefined && !Array.isArray(source.edges)) {
    throw new Error("--from-json edges must be an array when provided");
  }
  const rawEdges = source?.edges ?? [];
  const edges = [];
  for (const [index, rawEdge] of rawEdges.entries()) {
    const edge = asRecord(rawEdge, `edges[${index}]`);
    edges.push({
      from: requiredNodeStringField(edge, "from", `edges[${index}]`, "from_node"),
      to: requiredNodeStringField(edge, "to", `edges[${index}]`, "to_node"),
      type: strictOptionalEnum(
        optionalStringField(edge, "type", `edges[${index}]`),
        isEdgeType,
        `edges[${index}].type`,
        "requires",
      ),
    });
  }
  return output(await addNodesBulk(root, { nodes, edges }), json);
}

export async function noteCommand(
  root: string,
  action: string | undefined,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const id = requiredArg(nodeId, "node id");
  if (action === "add")
    return output(
      await addNodeNote(root, id, required(options.text, "--text"), {
        kind: strictEnumOpt(options.kind, isNoteKind, "--kind", "note"),
        evidence: stringOpt(options.evidence),
      }),
      json,
    );
  if (action === "list" || !action)
    return output(await listNodeNotes(root, id, { kinds: parseNoteKindList(options.kind) }), json);
  throw new Error(`Unknown note action: ${action}`);
}

export async function claimCommand(
  root: string,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const config = await readConfig(root);
  if (!options["no-hooks"] && config.hooks.preClaim.trim()) {
    await runPolicyHook(root, config.hooks.preClaim, { root, node: nodeId ?? "" });
  }
  const node = await claimNode(root, {
    id: nodeId,
    agent: required(options.agent, "--agent"),
    branch: stringOpt(options.branch),
  });
  if (!options["no-hooks"] && config.hooks.postClaim.trim()) {
    await runPolicyHook(root, config.hooks.postClaim, {
      root,
      node: node.id,
      branch: node.branch ?? "",
    });
  }
  return output(node, json);
}

export async function mergeCommand(
  root: string,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const id = requiredArg(nodeId, "node id");
  const config = await readConfig(root);
  if (!options["no-hooks"] && config.hooks.preMerge.trim()) {
    await runPolicyHook(root, config.hooks.preMerge, { root, node: id });
  }
  const node = await markMerged(
    root,
    id,
    strictEnumOpt(options.strategy, isMergeStrategy, "--strategy", "squash"),
    {
      commitSha:
        stringOpt(options["use-existing-commit"]) ?? stringOpt(options["already-merged-at"]),
    },
  );
  if (!options["no-hooks"] && config.hooks.postMerge.trim()) {
    await runPolicyHook(root, config.hooks.postMerge, { root, node: id });
  }
  return output(node, json);
}

export async function edgeCommand(
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

async function nodeShowCommand(
  root: string,
  id: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const nodeId = requiredArg(id, "node id");
  const node = await getNode(root, nodeId);
  if (options.summary || options["no-big-text"]) {
    return output(
      {
        id: node.id,
        title: node.title,
        kind: node.kind,
        milestone: node.milestone,
        status: node.status,
        priority: node.priority,
        risk: node.risk,
        owner: node.owner,
        branch: node.branch,
        group_name: node.group_name,
        projects: node.projects,
        blocked_by: node.blocked_by,
        blocked_reason: node.blocked_reason,
        blocked_owner: node.blocked_owner,
        check_command: node.check_command,
        ci_command: node.ci_command,
      },
      json,
    );
  }
  if (!options.full && !options.include) return output(node, json);
  const include = new Set(
    (stringOpt(options.include) ?? "findings,notes,runs,audits")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const allowedIncludes = new Set(["findings", "notes", "runs", "audits"]);
  for (const item of include) {
    if (!allowedIncludes.has(item)) throw new Error(`--include contains unknown section: ${item}`);
  }
  const result: Record<string, unknown> = { node };
  if (include.has("findings")) result.findings = await listFindings(root, { nodeId });
  if (include.has("notes")) result.notes = await listNodeNotes(root, nodeId);
  if (include.has("runs") || include.has("audits")) {
    const runs = await listRuns(root, nodeId);
    if (include.has("runs")) result.runs = runs;
    if (include.has("audits")) result.audits = runs.filter((run) => run.kind === "audit");
  }
  return output(result, json);
}

async function nodeNoteCommand(
  root: string,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const id = requiredArg(nodeId, "node id");
  const mode = stringOpt(options.mode) ?? "add";
  if (mode === "list")
    return output(await listNodeNotes(root, id, { kinds: parseNoteKindList(options.kind) }), json);
  return output(
    await addNodeNote(root, id, required(options.text, "--text"), {
      kind: strictEnumOpt(options.kind, isNoteKind, "--kind", "note"),
      evidence: stringOpt(options.evidence),
    }),
    json,
  );
}
