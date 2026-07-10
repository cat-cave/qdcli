import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  addNodeNote,
  finishRun,
  getNode,
  getProjectPaths,
  listRuns,
  startRun,
  type VerificationEntry,
} from "@cat-cave/qdcli-core";
import { output, required, requiredArg, stringOpt } from "./args.js";
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
import { validateBatchVerificationReport } from "./verification-report.js";

export async function verificationCommand(
  root: string,
  action: string | undefined,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action !== "sign-off" && action !== "signoff") {
    return verificationReadOrRunCommand(root, action, nodeId, options, json);
  }
  return verificationSignoffCommand(root, requiredArg(nodeId, "node id"), options, json);
}

async function verificationReadOrRunCommand(
  root: string,
  action: string | undefined,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "list" || !action) {
    const node = await getNode(root, requiredArg(nodeId, "node id"));
    const passed = new Set(
      (await listRuns(root, { nodeId: node.id, kind: "verification" }))
        .filter((runRow) => runRow.status === "passed")
        .map((runRow) => runRow.command),
    );
    return output(
      {
        nodeId: node.id,
        verification: node.verification.map((entry, index) => ({
          index: index + 1,
          ...entry,
          signed: passed.has(verificationRunCommandKey(entry)),
        })),
      },
      json,
    );
  }
  if (action === "validate") {
    return output(
      validateVerificationReport(await readJson(root, nodeId ?? required(options.file, "--file"))),
      json,
    );
  }
  if (action === "record") return verificationRecordCommand(root, options, json);
  if (action === "run") {
    return verificationRunCommand(root, requiredArg(nodeId, "node id"), options, json);
  }
  throw new Error(`Unknown verification action: ${action}`);
}

async function verificationRecordCommand(
  root: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
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

async function verificationSignoffCommand(
  root: string,
  nodeId: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (options.all) return verificationBatchSignoff(root, nodeId, options, json);
  const node = await getNode(root, nodeId);
  const signedEntry = options.index
    ? selectVerificationSignoffEntryByIndex(node.verification, options.index, nodeId)
    : selectVerificationSignoffEntry(
        node.verification,
        strictEnum(required(options.type, "--type"), isVerificationType, "--type"),
        stringOpt(options.value),
        nodeId,
      );
  const note = required(options.note, "--note");
  const evidence = stringOpt(options.evidence);
  const saved = await addNodeNote(
    root,
    nodeId,
    verificationSignoffText(signedEntry.type, note, signedEntry, evidence),
  );
  const runRow = await startRun(root, nodeId, "verification", {
    command: verificationRunCommandKey(signedEntry),
    provider: "sign-off",
    reportPath: evidence ?? null,
    summary: note,
  });
  const finished = await finishRun(root, runRow.id, { status: "passed", summary: note });
  return output(
    {
      ok: true,
      nodeId,
      type: signedEntry.type,
      value: signedEntry.value,
      note,
      evidence: evidence ?? null,
      noteRecord: saved,
      run: finished,
    },
    json,
  );
}

async function verificationBatchSignoff(
  root: string,
  nodeId: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (options.index || options.type || options.value || options.note || options.evidence) {
    throw new Error(
      "qd verification sign-off --all cannot be combined with --index, --type, --value, --note, or --evidence",
    );
  }
  const reportPath = required(options["from-report"], "--from-report");
  const report = validateBatchVerificationReport(await readJson(root, reportPath));
  if (report.nodeId !== nodeId) {
    throw new Error(`verification report nodeId ${report.nodeId} does not match ${nodeId}`);
  }
  const node = await getNode(root, nodeId);
  assertCompleteVerificationCoverage(node.verification, report.entries, nodeId);
  const runs = [];
  for (const item of report.entries) {
    const declared = node.verification[item.index - 1];
    if (!declared) throw new Error(`verification index ${item.index} is out of range`);
    const runRow = await startRun(root, nodeId, "verification", {
      command: verificationRunCommandKey(declared),
      provider: "report-sign-off",
      reportPath: item.evidence,
      summary: item.summary,
    });
    runs.push(await finishRun(root, runRow.id, { status: "passed", summary: item.summary }));
  }
  await addNodeNote(root, nodeId, `Signed off all ${runs.length} declared verifications.`, {
    kind: "note",
    evidence: reportPath,
  });
  return output({ ok: true, nodeId, signed: runs.length, runs }, json);
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
  if (commands.length === 0) throw new Error(verificationCommandMissingMessage(only));
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
    const execution = await runShellCommand(command, root, logPath, { streamOutput: !json });
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
): VerificationEntry {
  if (verification.length === 0) {
    throw new Error(`Node ${nodeId} has no declared verification entries.`);
  }
  const matchingEntries = verification.filter((entry) => entry.type === type);
  if (matchingEntries.length === 0) {
    throw new Error(
      `Node ${nodeId} has no ${type} verification entry. Sign off only declared verification gates.`,
    );
  }
  if (matchingEntries.length === 1) {
    const [signedEntry] = matchingEntries;
    if (!signedEntry) throw new Error(`Internal error: missing ${type} verification entry`);
    if (value !== undefined && signedEntry.value !== value) {
      throw new Error(
        `Node ${nodeId} has no ${type} verification entry matching --value ${JSON.stringify(value)}.`,
      );
    }
    return signedEntry;
  }
  const signedEntry = matchingEntries.find((entry) => entry.value === value);
  if (!signedEntry) {
    throw new Error(
      `Node ${nodeId} has multiple ${type} verification entries. Pass --value with the declared verification value.`,
    );
  }
  return signedEntry;
}

export function selectVerificationSignoffEntryByIndex(
  verification: VerificationEntry[],
  rawIndex: string | string[] | boolean,
  nodeId: string,
): VerificationEntry {
  const index = Number(required(rawIndex, "--index"));
  if (!Number.isInteger(index) || index < 1) throw new Error("--index must be a positive integer");
  const entry = verification[index - 1];
  if (!entry) {
    throw new Error(
      `Node ${nodeId} has ${verification.length} declared verification entr${verification.length === 1 ? "y" : "ies"}; index ${index} is out of range.`,
    );
  }
  return entry;
}

export function assertCompleteVerificationCoverage(
  verification: VerificationEntry[],
  entries: Array<{ index: number; type: string; value: string }>,
  nodeId: string,
): void {
  if (entries.length !== verification.length) {
    throw new Error(
      `Verification report for ${nodeId} must cover all ${verification.length} declared entries; received ${entries.length}.`,
    );
  }
  const indices = new Set<number>();
  for (const item of entries) {
    if (indices.has(item.index)) throw new Error(`Duplicate verification index ${item.index}`);
    indices.add(item.index);
    const declared = verification[item.index - 1];
    if (!declared) throw new Error(`verification index ${item.index} is out of range`);
    if (declared.type !== item.type || declared.value !== item.value) {
      throw new Error(
        `Verification index ${item.index} does not exactly match the declared ${declared.type} verification ${JSON.stringify(declared.value)}.`,
      );
    }
  }
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
