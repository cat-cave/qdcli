import {
  completeNode,
  gateNode,
  getNode,
  markMerged,
  policyReport,
  readConfig,
} from "@cat-cave/qdcli-core";
import { output, required, requiredArg, stringOpt } from "./args.js";
import { executeConfiguredCheck, runConfiguredCheck } from "./checks.js";
import { readJson } from "./file-io.js";
import { asRecord, requiredNodeStringField } from "./object-utils.js";
import { validateCompletionReport } from "./schemas.js";

export { verificationCommand } from "./verification.js";

export async function checkCommand(
  root: string,
  action: string | undefined,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "run") {
    return runConfiguredCheck(root, requiredArg(nodeId, "node id"), "check", options, json);
  }
  throw new Error(`Unknown check action: ${action}`);
}

export async function advanceCommand(
  root: string,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const id = requiredArg(nodeId, "node id");
  const steps: Array<{ step: string; ok: boolean; detail?: unknown }> = [];
  let node = await getNode(root, id);

  if (shouldCompleteForAdvance(node.status)) {
    if (!options["from-report"]) {
      throw new Error(
        "qd advance would complete this node first, so it requires --from-report <completion-report.json> with structured validation evidence.",
      );
    }
    const reportPath = required(options["from-report"], "--from-report");
    const report = await readJson(root, reportPath);
    const validated = validateCompletionReport(report);
    const reportNodeId = requiredNodeId(report, undefined, "completion report");
    if (reportNodeId !== id) {
      throw new Error(`completion report nodeId ${reportNodeId} does not match ${id}`);
    }
    node = await completeNode(root, id, { summary: validated.summary, reportPath });
    steps.push({ step: "complete", ok: true, detail: { status: node.status } });
  }

  const gate = await gateNode(root, id);
  steps.push({ step: "gate", ok: gate.ok, detail: gate });
  if (!gate.ok) return stopAdvance(id, root, "gate", steps, json, 1);

  const config = await readConfig(root);
  if (shouldRunConfiguredAdvanceStep(options, config.checkCommand, "skip-check")) {
    const check = await executeConfiguredCheck(root, id, "check", options, !json);
    steps.push({ step: "check", ok: check.ok, detail: check });
    if (!check.ok) return stopAdvance(id, root, "check", steps, json, check.exitCode);
  }

  if (shouldRunConfiguredAdvanceStep(options, config.ciCommand, "skip-ci")) {
    const policy = await policyReport(root, id, "ci");
    steps.push({ step: "policy:ci", ok: policy.ok, detail: policy });
    if (!policy.ok) return stopAdvance(id, root, "policy:ci", steps, json, 1);
    const ci = await executeConfiguredCheck(root, id, "ci", options, !json);
    steps.push({ step: "ci", ok: ci.ok, detail: ci });
    if (!ci.ok) return stopAdvance(id, root, "ci", steps, json, ci.exitCode);
  } else if (!options["skip-ci"] && !config.ciCommand.trim()) {
    throw new Error("ci_command is empty; configure it or pass --skip-ci explicitly");
  }

  node = await getNode(root, id);
  if (options.merge) {
    const commitSha = commitShaFromAdvanceOptions(options);
    if (!commitSha) {
      throw new Error(
        "qd advance --merge requires --use-existing-commit <sha> after the real repository merge has happened",
      );
    }
    try {
      node = await markMerged(root, id, stringOpt(options.strategy) ?? "squash", { commitSha });
      steps.push({ step: "merge", ok: true, detail: { status: node.status } });
    } catch (error) {
      steps.push({
        step: "merge",
        ok: false,
        detail: { message: error instanceof Error ? error.message : String(error) },
      });
      return stopAdvance(id, root, "merge", steps, json, 1);
    }
  }

  const done = node.status === "done";
  output(
    {
      ok: done || !options.merge,
      stoppedAt: done ? "done" : node.status,
      nextAction: advanceNextAction(node.status, Boolean(options.merge)),
      nextActions: advanceNextActions(node.status, Boolean(options.merge)),
      steps,
      node,
    },
    json,
  );
}

async function stopAdvance(
  nodeId: string,
  root: string,
  stoppedAt: string,
  steps: Array<{ step: string; ok: boolean; detail?: unknown }>,
  json: boolean,
  exitCode: number,
): Promise<void> {
  const node = await getNode(root, nodeId);
  output(
    {
      ok: false,
      stoppedAt,
      nextAction: advanceNextAction(node.status, false),
      nextActions: advanceNextActions(node.status, false),
      steps,
      node,
    },
    json,
  );
  process.exitCode = exitCode || 1;
}

export function shouldCompleteForAdvance(status: string): boolean {
  return !["review", "mergeable", "queued", "done"].includes(status);
}

export function shouldRunConfiguredAdvanceStep(
  options: Record<string, string | string[] | boolean>,
  command: string,
  skipFlag: "skip-check" | "skip-ci",
): boolean {
  return !options[skipFlag] && Boolean(command.trim());
}

export function commitShaFromAdvanceOptions(
  options: Record<string, string | string[] | boolean>,
): string | undefined {
  return stringOpt(options["use-existing-commit"]) ?? stringOpt(options["already-merged-at"]);
}

export function advanceNextAction(status: string, mergeRequested: boolean): string | null {
  return advanceNextActions(status, mergeRequested)[0] ?? null;
}

export function advanceNextActions(status: string, mergeRequested: boolean): string[] {
  if (status === "review") {
    return [
      "Run and pass an independent audit.",
      "Sign off every declared verification.",
      "Record or run trusted CI.",
    ];
  }
  if (status === "mergeable" && !mergeRequested) {
    return [
      "Perform the real git/GitHub merge, then run qd merge --use-existing-commit <sha> or qd reconcile --commit <sha> --from-report <reconciliation.json>.",
    ];
  }
  if (status === "queued") {
    return ["Wait with qd queue watch <node> or reconcile all queued PRs with qd queue drain."];
  }
  return [];
}

function requiredNodeId(report: unknown, fallback: string | undefined, context: string): string {
  const record = asRecord(report, context);
  const reportNodeId = requiredNodeStringField(record, "nodeId", context, "node_id");
  if (fallback && fallback !== reportNodeId) {
    throw new Error(`${context} nodeId ${reportNodeId} does not match ${fallback}`);
  }
  return fallback ?? reportNodeId;
}
