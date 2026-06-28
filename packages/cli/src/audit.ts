import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  addFinding,
  addNode,
  addNodeNote,
  disposeFinding,
  finishRun,
  gateNode,
  getNode,
  getRun,
  latestRun,
  listFindings,
  listRuns,
  policyReport,
  promoteFindings,
  readConfig,
  resolveFinding,
  startRun,
  type QdRun,
} from "@cat-cave/qdcli-core";
import { numberOpt, output, required, requiredArg, stringListOpt, stringOpt } from "./args.js";
import {
  isFindingStatus,
  isPolicyPhase,
  isPriority,
  parseSeverityList,
  strictEnum,
  strictEnumOpt,
} from "./enums.js";
import { readJson } from "./file-io.js";
import { nextStepForNode } from "./graph-format.js";
import { arrayAtPath, numberAt, parseVerification, stringAt } from "./object-utils.js";
import { validateAuditReport } from "./schemas.js";
import { runPolicyHook } from "./shell.js";

export async function findingCommand(
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
        severity: strictEnum(required(options.severity, "--severity"), isPriority, "--severity"),
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
  if (action === "dispose") {
    const disposition = required(options.disposition, "--disposition");
    const status = findingStatusFromDisposition(disposition);
    if (!status)
      throw new Error(
        "--disposition must be resolved, follow-up-node, promoted, dismissed, or accepted-risk",
      );
    return output(
      await disposeFinding(root, requiredArg(nodeOrFinding, "finding id"), {
        status,
        rationale: required(options.rationale, "--rationale"),
      }),
      json,
    );
  }
  if (action === "promote") {
    const findingId = requiredArg(nodeOrFinding, "finding id");
    const finding = (await listFindings(root)).find((item) => item.id === findingId);
    if (!finding) throw new Error(`Finding not found: ${findingId}`);
    if (finding.severity === "P0" || finding.severity === "P1") {
      throw new Error("P0/P1 findings must be resolved, not promoted into non-blocking follow-up");
    }
    const targetNode = stringOpt(options.node);
    if (targetNode) {
      const node = await getNode(root, targetNode);
      const disposed = await disposeFinding(root, findingId, {
        status: "promoted",
        rationale: required(options.rationale, "--rationale"),
      });
      await addNodeNote(root, node.id, `Promoted finding ${findingId}: ${disposed.title}`, {
        kind: "audit-disposition",
        evidence: `finding:${findingId}`,
      });
      return output({ finding: disposed, node }, json);
    }
    const node = await addNode(root, {
      title: stringOpt(options.title) ?? finding.title,
      kind: "audit-fix",
      priority: finding.severity,
      risk: finding.severity === "P2" ? "medium" : "low",
      spec: [finding.evidence, finding.suggested_fix].filter(Boolean).join("\n\n"),
      acceptance: stringOpt(options.acceptance) ?? finding.expected ?? "Finding is addressed.",
      verification: stringListOpt(options.verification).map(parseVerification),
      context: finding.path ? `${finding.path}${finding.line ? `:${finding.line}` : ""}` : null,
      statusReason: `Promoted from finding ${finding.id} on node ${finding.node_id}.`,
    });
    const disposed = await disposeFinding(root, findingId, {
      status: "promoted",
      rationale: stringOpt(options.rationale) ?? `Promoted to ${node.id}`,
    });
    return output({ finding: disposed, node }, json);
  }
  if (action === "list" || !action) {
    if (options.open && options.status) throw new Error("Use either --open or --status, not both");
    return output(
      await listFindings(root, {
        nodeId: stringOpt(options.node),
        status: options.open ? "open" : strictEnumOpt(options.status, isFindingStatus, "--status"),
        severities: parseSeverityList(options.severity),
      }),
      json,
    );
  }
  throw new Error(`Unknown finding action: ${action}`);
}

export async function auditCommand(
  root: string,
  action: string | undefined,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "start") {
    return output(
      await startRun(root, requiredArg(nodeId, "node id"), "audit", {
        auditKind: stringOpt(options.kind) ?? "general",
        agent: stringOpt(options.auditor) ?? stringOpt(options.agent),
        summary: stringOpt(options.summary),
      }),
      json,
    );
  }
  if (action === "validate") {
    return output(
      validateAuditReport(await readJson(root, nodeId ?? required(options.file, "--file"))),
      json,
    );
  }
  if (action && !["pass", "fail", "dispose", "cancel", "supersede", "list"].includes(action)) {
    return output(await startRun(root, requiredArg(action, "node id"), "audit"), json);
  }
  if (action === "list") {
    return output(
      await listRuns(root, {
        nodeId: stringOpt(options.node),
        status: stringOpt(options.status),
        kind: "audit",
      }),
      json,
    );
  }
  if (action === "pass") {
    const id = requiredArg(nodeId, "node id");
    const auditRun = await selectedAuditRun(root, id, options);
    const imported = await importFindingsFromReport(
      root,
      required(options["from-report"], "--from-report"),
      id,
      { allowEmpty: true },
    );
    await finishRun(root, auditRun.id, {
      status: "passed",
      summary: `Audit passed from ${required(options["from-report"], "--from-report")}`,
      reportPath: required(options["from-report"], "--from-report"),
    });
    const gate = await gateNode(root, id);
    if (!gate.ok) {
      output(
        {
          ok: false,
          code: "auditNotClean",
          nodeId: id,
          imported,
          blocking: gate.blocking,
          remaining: gate.blocking.length,
        },
        json,
      );
      process.exitCode = 1;
      return;
    }
    const promoted = await promoteFindings(root, id);
    const openFindings = await listFindings(root, { nodeId: id, status: "open" });
    return output(
      { ok: true, nodeId: id, imported, promoted, remaining: openFindings.length },
      json,
    );
  }
  if (action === "fail") {
    const id = requiredArg(nodeId, "node id");
    const auditRun = await selectedAuditRun(root, id, options);
    const imported = await importFindingsFromReport(
      root,
      required(options["from-report"], "--from-report"),
      id,
      { allowEmpty: true },
    );
    const finished = await finishRun(root, auditRun.id, {
      status: "failed",
      summary:
        stringOpt(options.summary) ??
        `Audit failed from ${required(options["from-report"], "--from-report")}`,
      reportPath: required(options["from-report"], "--from-report"),
    });
    return output({ ok: false, nodeId: id, run: finished, imported }, json);
  }
  if (action === "dispose" || action === "cancel" || action === "supersede") {
    requiredArg(nodeId, "node id");
    const runId = required(options["run-id"], "--run-id");
    const status = auditTerminalStatus(action);
    return output(
      await finishRun(root, runId, {
        status,
        rationale: required(options.rationale, "--rationale"),
        summary: `${action}: ${required(options.rationale, "--rationale")}`,
      }),
      json,
    );
  }
  throw new Error(`Unknown audit action: ${action}`);
}

export async function gate(
  root: string,
  nodeId: string,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const config = await readConfig(root);
  if (config.hooks.preGate.trim())
    await runPolicyHook(root, config.hooks.preGate, { root, node: nodeId });
  const result = await gateNode(root, nodeId);
  const phase = strictEnumOpt(options.phase, isPolicyPhase, "--phase");
  if (phase === "completion") throw new Error("--phase must be ci or merge");
  const node = await getNode(root, nodeId);
  const latestCheck = await latestRun(root, nodeId, "check");
  const latestCi = await latestRun(root, nodeId, "ci");
  const openFollowups = await listFindings(root, {
    nodeId,
    status: "open",
    severities: ["P2", "P3"],
  });
  const ciPolicy = await policyReport(root, nodeId, "ci");
  const mergePolicy = await policyReport(root, nodeId, "merge");
  const selectedPolicy = phase === "ci" ? ciPolicy : phase === "merge" ? mergePolicy : null;
  const ok = result.ok && (selectedPolicy?.ok ?? true);
  const enriched = {
    ...result,
    ok,
    structuralOk: result.ok,
    phase: phase ?? null,
    policy: { ci: ciPolicy, merge: mergePolicy, selected: selectedPolicy },
    checks: {
      latestCheck: latestCheck ?? null,
      latestCi: latestCi ?? null,
      undisposedP2P3: openFollowups,
    },
    next: nextStepForNode(node, result, latestCheck ?? null, latestCi ?? null),
  };
  output(enriched, json);
  if (!ok) process.exitCode = 1;
}

export function findingStatusFromDisposition(
  disposition: string,
): "dismissed" | "resolved" | "promoted" | null {
  if (disposition === "accepted-risk" || disposition === "dismissed") return "dismissed";
  if (disposition === "resolved") return "resolved";
  if (disposition === "follow-up-node" || disposition === "promoted") return "promoted";
  return null;
}

export function auditTerminalStatus(
  action: "dispose" | "cancel" | "supersede",
): "cancelled" | "superseded" {
  return action === "supersede" ? "superseded" : "cancelled";
}

export async function selectedAuditRun(
  root: string,
  nodeId: string,
  options: Record<string, string | string[] | boolean>,
): Promise<QdRun> {
  const runId = stringOpt(options["run-id"]);
  if (runId) {
    const runRow = await getRun(root, runId);
    if (runRow.node_id !== nodeId)
      throw new Error(`Audit run ${runId} does not belong to ${nodeId}`);
    if (runRow.kind !== "audit") throw new Error(`Run ${runId} is not an audit run`);
    return runRow;
  }
  const running = await listRuns(root, { nodeId, kind: "audit", status: "running" });
  if (running.length === 0) {
    throw new Error(`No running audit found for ${nodeId}; pass --run-id for a specific audit`);
  }
  if (running.length > 1) {
    throw new Error(`Multiple running audits found for ${nodeId}; pass --run-id`);
  }
  const runRow = running[0];
  if (!runRow) throw new Error(`No running audit found for ${nodeId}`);
  return runRow;
}

export async function importFindingsFromReport(
  root: string,
  reportPath: string,
  nodeIdArg?: string,
  options: { allowEmpty?: boolean } = {},
): Promise<{ nodeId: string; importedFindings: number; findings: unknown[] }> {
  const report = JSON.parse(await readFile(path.resolve(root, reportPath), "utf8")) as unknown;
  const nodeId = nodeIdArg ?? stringAt(report, "nodeId") ?? stringAt(report, "node_id");
  if (!nodeId)
    throw new Error("Report must include nodeId/node_id or command must provide node id");
  const findings = arrayAtPath(report, "findings");
  if (findings.length === 0 && !options.allowEmpty) {
    throw new Error("Report must include a non-empty findings array");
  }
  const imported = [];
  for (const [index, raw] of findings.entries()) {
    const severity = stringAt(raw, "severity");
    if (!severity) throw new Error(`findings[${index}].severity is required`);
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
