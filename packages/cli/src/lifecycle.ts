import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  addNodeNote,
  completeNode,
  finishRun,
  gateNode,
  getNode,
  getProjectPaths,
  markMerged,
  policyReport,
  readConfig,
  startRun,
  type VerificationEntry,
} from "@cat-cave/qdcli-core";
import { output, required, requiredArg, stringOpt } from "./args.js";
import { executeConfiguredCheck, runConfiguredCheck } from "./checks.js";
import { isVerificationType, strictEnum } from "./enums.js";
import { readJson } from "./file-io.js";
import {
  asRecord,
  optionalNumberField,
  optionalStringField,
  requiredNodeStringField,
} from "./object-utils.js";
import { validateVerificationReport } from "./schemas.js";
import { runShellCommand } from "./shell.js";

export async function checkCommand(
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

export async function verificationCommand(
  root: string,
  action: string | undefined,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action !== "sign-off" && action !== "signoff") {
    if (action === "list" || !action) {
      const node = await getNode(root, requiredArg(nodeId, "node id"));
      return output({ nodeId: node.id, verification: node.verification }, json);
    }
    if (action === "validate") {
      return output(
        validateVerificationReport(
          await readJson(root, nodeId ?? required(options.file, "--file")),
        ),
        json,
      );
    }
    if (action === "record") {
      const report = asRecord(
        await readJson(root, required(options["from-json"], "--from-json")),
        "--from-json",
      );
      const id = requiredNodeStringField(report, "nodeId", "--from-json", "node_id");
      const status = requiredNodeStringField(report, "status", "--from-json");
      if (status !== "passed" && status !== "failed") {
        throw new Error("--from-json.status must be passed or failed");
      }
      const runRow = await startRun(root, id, "verification", {
        command: optionalStringField(report, "command", "--from-json"),
        provider: optionalStringField(report, "provider", "--from-json") ?? "external",
        summary: optionalStringField(report, "summary", "--from-json"),
        reportPath: optionalStringField(report, "evidence", "--from-json"),
      });
      const finished = await finishRun(root, runRow.id, {
        status,
        summary: optionalStringField(report, "summary", "--from-json") ?? `verification ${status}`,
        exitCode: optionalNumberField(report, "exitCode", "--from-json"),
      });
      return output(finished, json);
    }
    if (action === "run") {
      return verificationRunCommand(root, requiredArg(nodeId, "node id"), options, json);
    }
    throw new Error(`Unknown verification action: ${action}`);
  }
  const id = requiredArg(nodeId, "node id");
  const type = strictEnum(required(options.type, "--type"), isVerificationType, "--type");
  const note = required(options.note, "--note");
  const evidence = stringOpt(options.evidence);
  const node = await getNode(root, id);
  const signedEntry = selectVerificationSignoffEntry(
    node.verification,
    type,
    stringOpt(options.value),
    id,
  );
  const text = verificationSignoffText(type, note, signedEntry, evidence);
  const saved = await addNodeNote(root, id, text);
  const command = signedEntry ? verificationRunCommandKey(signedEntry) : `${type}:${note}`;
  const runRow = await startRun(root, id, "verification", {
    command,
    provider: "sign-off",
    reportPath: evidence ?? null,
    summary: note,
  });
  const finished = await finishRun(root, runRow.id, {
    status: "passed",
    summary: note,
  });
  return output(
    {
      ok: true,
      nodeId: id,
      type,
      value: signedEntry?.value ?? null,
      note,
      evidence: evidence ?? null,
      noteRecord: saved,
      run: finished,
    },
    json,
  );
}

async function verificationRunCommand(
  root: string,
  nodeId: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const node = await getNode(root, nodeId);
  const only = stringOpt(options.only);
  const commands = verificationCommandsForRun(node.verification, only);
  if (commands.length === 0) {
    throw new Error(verificationCommandMissingMessage(only));
  }
  const results = [];
  for (const command of commands) {
    const runRow = await startRun(root, nodeId, "verification", {
      command,
      provider: "local",
      summary: `verification command started: ${command}`,
    });
    const paths = getProjectPaths(root);
    await mkdir(paths.logsDir, { recursive: true });
    const logPath = path.join(paths.logsDir, `verification-${nodeId}-${runRow.id}.log`);
    const execution = await runShellCommand(command, root, logPath);
    const status = verificationRunStatusFromExecution(execution);
    const finished = await finishRun(root, runRow.id, {
      status,
      summary: verificationRunSummary(status, command),
      exitCode: execution.exitCode,
    });
    results.push({ ...finished, log_path: logPath });
  }
  output({ ok: results.every((runRow) => runRow.status === "passed"), runs: results }, json);
  if (results.some((runRow) => runRow.status !== "passed")) process.exitCode = 1;
}

export function verificationRunCommandKey(entry: VerificationEntry): string {
  return entry.type === "command" ? entry.value : `${entry.type}:${entry.value}`;
}

export function selectVerificationSignoffEntry(
  verification: VerificationEntry[],
  type: VerificationEntry["type"],
  value: string | undefined,
  nodeId: string,
): VerificationEntry | null {
  if (verification.length === 0) return null;
  const matchingEntries = verification.filter((entry) => entry.type === type);
  if (matchingEntries.length === 0) {
    throw new Error(
      `Node ${nodeId} has no ${type} verification entry. Sign off only declared verification gates.`,
    );
  }
  if (matchingEntries.length === 1) {
    const [signedEntry] = matchingEntries;
    if (!signedEntry) throw new Error(`Internal error: missing ${type} verification entry`);
    return signedEntry;
  }
  const signedEntry = matchingEntries.find((entry) => entry.value === value);
  if (!signedEntry) {
    throw new Error(
      `Node ${nodeId} has multiple ${type} verification entries. Pass --value with the declared verification value.`,
    );
  }
  return signedEntry ?? null;
}

export function verificationSignoffText(
  type: VerificationEntry["type"],
  note: string,
  signedEntry: VerificationEntry | null,
  evidence: string | undefined,
): string {
  return [
    `Verification sign-off (${type}): ${note}`,
    signedEntry ? `Value: ${signedEntry.value}` : null,
    evidence ? `Evidence: ${evidence}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function verificationCommandsForRun(
  verification: VerificationEntry[],
  only: string | undefined,
): string[] {
  return verification
    .filter((entry) => entry.type === "command")
    .filter((entry) => !only || entry.value === only)
    .map((entry) => entry.value);
}

export function verificationCommandMissingMessage(only: string | undefined): string {
  return only
    ? `No matching command verification: ${only}`
    : "Node has no command verification entries";
}

export function verificationRunStatusFromExecution(execution: {
  exitCode: number;
  timedOut: boolean;
}): "passed" | "failed" | "timed_out" {
  if (execution.exitCode === 0) return "passed";
  return execution.timedOut ? "timed_out" : "failed";
}

export function verificationRunSummary(
  status: "passed" | "failed" | "timed_out",
  command: string,
): string {
  return `verification command ${status}: ${command}`;
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
    const summary = required(options.summary, "--summary");
    node = await completeNode(root, id, summary);
    steps.push({ step: "complete", ok: true, detail: { status: node.status } });
  }

  const gate = await gateNode(root, id);
  steps.push({ step: "gate", ok: gate.ok, detail: gate });
  if (!gate.ok) {
    output({ ok: false, stoppedAt: "gate", steps, node: await getNode(root, id) }, json);
    process.exitCode = 1;
    return;
  }

  const config = await readConfig(root);
  if (shouldRunConfiguredAdvanceStep(options, config.checkCommand, "skip-check")) {
    const check = await executeConfiguredCheck(root, id, "check", options);
    steps.push({ step: "check", ok: check.ok, detail: check });
    if (!check.ok) {
      output({ ok: false, stoppedAt: "check", steps, node: await getNode(root, id) }, json);
      process.exitCode = check.exitCode;
      return;
    }
  }

  if (shouldRunConfiguredAdvanceStep(options, config.ciCommand, "skip-ci")) {
    const policy = await policyReport(root, id, "ci");
    steps.push({ step: "policy:ci", ok: policy.ok, detail: policy });
    if (!policy.ok) {
      output({ ok: false, stoppedAt: "policy:ci", steps, node: await getNode(root, id) }, json);
      process.exitCode = 1;
      return;
    }
    const ci = await executeConfiguredCheck(root, id, "ci", options);
    steps.push({ step: "ci", ok: ci.ok, detail: ci });
    if (!ci.ok) {
      output({ ok: false, stoppedAt: "ci", steps, node: await getNode(root, id) }, json);
      process.exitCode = ci.exitCode;
      return;
    }
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
    node = await markMerged(root, id, stringOpt(options.strategy) ?? "squash", { commitSha });
    steps.push({ step: "merge", ok: true, detail: { status: node.status } });
  }

  output(
    {
      ok: true,
      stoppedAt: node.status === "done" ? "done" : node.status,
      nextAction: advanceNextAction(node.status, Boolean(options.merge)),
      steps,
      node,
    },
    json,
  );
}

export function shouldCompleteForAdvance(status: string): boolean {
  return !["review", "mergeable", "done"].includes(status);
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
  return status === "mergeable" && !mergeRequested
    ? "Perform the real git/GitHub merge, then run qd merge --use-existing-commit <sha> or qd advance --merge --use-existing-commit <sha>."
    : null;
}
