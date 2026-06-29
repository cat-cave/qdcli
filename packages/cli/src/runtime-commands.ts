import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  finishRun,
  gateNode,
  getNode,
  getRun,
  graphSnapshot,
  latestRun,
  listRuns,
  replaceGraphSnapshot,
  type RunKind,
} from "@cat-cave/qdcli-core";
import { output, required, requiredArg, stringListOpt, stringOpt } from "./args.js";
import { isRunKind, strictEnumOpt } from "./enums.js";
import { readTextFile } from "./file-io.js";
import { nextStepForNode, snapshotDiff } from "./graph-format.js";
import { promptText, skillText } from "./prompts.js";
import { canonicalSnapshotFrom } from "./object-utils.js";
import {
  assignmentSchema,
  auditReportSchema,
  blockerReportSchema,
  completionReportSchema,
  externalCiSchema,
  findingImportSchema,
  milestoneSchema,
  specSchema,
  unblockReportSchema,
  verificationSchema,
  waveSchema,
} from "./schemas.js";
import { reportTemplate, templateNames } from "./report-templates.js";
import { isDiffTool } from "./diff.js";
import { doctorCommand } from "./project-commands.js";

export async function runCommand(
  root: string,
  action: string | undefined,
  id: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "list" || !action) {
    return output(
      await listRuns(root, {
        nodeId: stringOpt(options.node),
        status: stringOpt(options.status),
        kind: strictEnumOpt<RunKind>(options.kind, isRunKind, "--kind"),
      }),
      json,
    );
  }
  if (action === "show") return output(await getRun(root, requiredArg(id, "run id")), json);
  if (action === "cancel") {
    return output(
      await finishRun(root, requiredArg(id, "run id"), {
        status: "cancelled",
        rationale: required(options.rationale, "--rationale"),
        summary: required(options.rationale, "--rationale"),
      }),
      json,
    );
  }
  if (action === "supersede") {
    return output(
      await finishRun(root, requiredArg(id, "run id"), {
        status: "superseded",
        supersededBy: required(options.by, "--by"),
        rationale: required(options.rationale, "--rationale"),
        summary: required(options.rationale, "--rationale"),
      }),
      json,
    );
  }
  throw new Error(`Unknown run action: ${action}`);
}

export async function stateCommand(
  root: string,
  action: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "diff") {
    const against = path.resolve(root, required(options["against-export"], "--against-export"));
    const exportSnapshot = canonicalSnapshotFrom(
      JSON.parse(await readFile(against, "utf8")) as unknown,
    );
    if (!exportSnapshot) throw new Error("--against-export must be a canonical qd export");
    const live = await graphSnapshot(root);
    const result = snapshotDiff(live, exportSnapshot);
    output(result, json);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (action === "rebuild") {
    const from = path.resolve(root, required(options["from-export"], "--from-export"));
    const snapshot = canonicalSnapshotFrom(JSON.parse(await readFile(from, "utf8")) as unknown);
    if (!snapshot) throw new Error("--from-export must be a canonical qd export");
    await replaceGraphSnapshot(root, snapshot);
    return output({ ok: true, rebuiltFrom: path.relative(root, from) }, json);
  }
  if (action === "reconcile") {
    const prefer = stringOpt(options.prefer);
    if (prefer !== "export") throw new Error("state reconcile currently supports --prefer export");
    const from = path.resolve(root, required(options["from-export"], "--from-export"));
    const snapshot = canonicalSnapshotFrom(JSON.parse(await readFile(from, "utf8")) as unknown);
    if (!snapshot) throw new Error("--from-export must be a canonical qd export");
    await replaceGraphSnapshot(root, snapshot);
    return output({ ok: true, preferred: "export", source: path.relative(root, from) }, json);
  }
  throw new Error(`Unknown state action: ${action}`);
}

export async function envCommand(
  action: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action !== "check") throw new Error(`Unknown env action: ${action}`);
  const requiredNames = stringListOpt(options.required).flatMap((item) => item.split(","));
  const entries = requiredNames
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({
      name,
      present: process.env[name] !== undefined,
      value: options.mask ? "***" : null,
    }));
  const result = { ok: entries.every((entry) => entry.present), required: entries };
  output(result, json);
  if (!result.ok) process.exitCode = 1;
}

export function schemaCommand(
  action: string | undefined,
  name: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): void {
  const schemas = {
    "audit-report": auditReportSchema(),
    blocker: blockerReportSchema(),
    "blocker-report": blockerReportSchema(),
    "completion-report": completionReportSchema(),
    finding: findingImportSchema(),
    "finding-import": findingImportSchema(),
    milestone: milestoneSchema(),
    "reality-check": {
      type: "object",
      required: ["summary", "findings", "dagChangesNeeded"],
      properties: {
        summary: { type: "string" },
        findings: { type: "array", items: findingImportSchema() },
        dagChangesNeeded: { type: "array", items: { type: "string" } },
      },
    },
    "research-report": {
      type: "object",
      required: ["sourcesInspected", "environmentVerified", "resultingNodes"],
      properties: {
        sourcesInspected: { type: "array", items: { type: "string" } },
        environmentVerified: { type: "array", items: { type: "string" } },
        unresolvedUnknowns: { type: "array", items: { type: "string" } },
        resultingNodes: { type: "array", items: specSchema() },
      },
    },
    spec: specSchema(),
    "unblock-report": unblockReportSchema(),
    assignment: assignmentSchema(),
    verification: verificationSchema(),
    "external-ci": externalCiSchema(),
    wave: waveSchema(),
  };
  if (action === "list" || !action) return output(Object.keys(schemas), json);
  if (action === "example") return output(reportTemplate(requiredArg(name, "schema name")), true);
  if (options.example) return output(reportTemplate(requiredArg(action, "schema name")), true);
  if (action === "print") {
    const schema = schemas[requiredArg(name, "schema name") as keyof typeof schemas];
    if (!schema) throw new Error(`Unknown schema: ${name}`);
    return output(schema, true);
  }
  throw new Error(`Unknown schema action: ${action}`);
}

export function templateCommand(action: string | undefined, json: boolean): void {
  if (action === "list" || !action) return output(templateNames(), json);
  return output(reportTemplate(action), true);
}

export async function readinessCommand(
  root: string,
  nodeId: string | undefined,
  kind: "merge" | "completion",
  json: boolean,
): Promise<void> {
  const id = requiredArg(nodeId, "node id");
  const node = await getNode(root, id);
  const gate = await gateNode(root, id);
  const latestCheck = await latestRun(root, id, "check");
  const latestCi = await latestRun(root, id, "ci");
  const result = {
    ok:
      gate.ok &&
      (kind === "completion" || node.status === "mergeable") &&
      (kind === "completion" || latestCi?.status === "passed"),
    kind,
    node,
    gate,
    latestCheck: latestCheck ?? null,
    latestCi: latestCi ?? null,
    next: nextStepForNode(node, gate, latestCheck ?? null, latestCi ?? null),
  };
  output(result, json);
  if (!result.ok) process.exitCode = 1;
}

export async function promptCommand(
  root: string,
  action: string | undefined,
  id: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const kind = action ?? "plan";
  const node = (kind === "implement" || kind === "audit") && id ? await getNode(root, id) : null;
  const gateContext = node ? await gateNode(root, node.id) : null;
  const rulesPath =
    stringOpt(options["include-project-rules"]) ?? stringOpt(options["include-rules-file"]);
  const projectRules = rulesPath ? await readTextFile(root, rulesPath) : undefined;
  const auditBase = stringOpt(options.base) ?? "main";
  const auditDiffTool = strictEnumOpt(
    options["diff-tool"] ?? (options.semantic ? "sem" : undefined),
    isDiffTool,
    "--diff-tool",
    "git",
  );
  const auditDiffCommand =
    kind === "audit" && id
      ? `qd diff ${id} --self-only --base ${auditBase}${auditDiffTool === "git" ? "" : ` --tool ${auditDiffTool} --format markdown`}`
      : undefined;
  const prompt = promptText(kind, node, { projectRules, auditDiffCommand, gateContext });
  if (json) {
    output(
      {
        schemaVersion: 1,
        kind,
        nodeId: id ?? null,
        node,
        gate: gateContext,
        projectRulesPath: rulesPath ?? null,
        auditDiffCommand: auditDiffCommand ?? null,
        prompt,
      },
      true,
    );
    return;
  }
  console.log(prompt);
}

export async function agentCommand(
  root: string,
  action: string | undefined,
  targetArg: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "install") {
    const requested = targetArg ?? stringOpt(options.agent) ?? "skills-sh";
    const target = stringOpt(options.target);
    if (requested !== "skills-sh") throw new Error("agent install target must be skills-sh");
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
  if (action === "doctor") return doctorCommand(root, options, json);
  throw new Error(`Unknown agent action: ${action}`);
}

export async function installSkill(root: string, target?: string): Promise<void> {
  const skillPath = path.resolve(root, target ?? ".qd/skills/qd-dag/SKILL.md");
  await mkdir(path.dirname(skillPath), { recursive: true });
  await writeFile(skillPath, skillText, "utf8");
}
