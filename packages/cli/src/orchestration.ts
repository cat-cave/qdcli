import {
  addAssignment,
  addWaveAssignment,
  addWaveNode,
  completeAssignment,
  completeWave,
  listAssignments,
  listWaveMemberships,
  listWaves,
  startWave,
} from "@cat-cave/qdcli-core";
import { output, required, requiredArg, stringListOpt, stringOpt } from "./args.js";
import {
  isAssignmentRole,
  isAssignmentStatus,
  isWaveKind,
  strictEnum,
  strictEnumOpt,
} from "./enums.js";
import { readJson } from "./file-io.js";
import {
  asRecord,
  optionalStringField,
  requiredNodeStringField,
  strictStringArrayField,
} from "./object-utils.js";
import { validateAssignmentReport } from "./schemas.js";

export async function assignmentCommand(
  root: string,
  action: string | undefined,
  id: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "add") {
    if (options["from-json"]) {
      const raw = asRecord(
        await readJson(root, required(options["from-json"], "--from-json")),
        "--from-json",
      );
      return output(
        await addAssignment(root, {
          nodeId: requiredNodeStringField(raw, "nodeId", "--from-json", "node_id"),
          role: strictEnum(
            requiredNodeStringField(raw, "role", "--from-json"),
            isAssignmentRole,
            "role",
          ),
          owner: requiredNodeStringField(raw, "owner", "--from-json"),
          branch: optionalStringField(raw, "branch", "--from-json"),
          worktreePath:
            optionalStringField(raw, "worktreePath", "--from-json") ??
            optionalStringField(raw, "worktree_path", "--from-json"),
          scope: optionalStringField(raw, "scope", "--from-json"),
        }),
        json,
      );
    }
    return output(
      await addAssignment(root, {
        nodeId: requiredArg(id, "node id"),
        role: strictEnum(required(options.role, "--role"), isAssignmentRole, "--role"),
        owner: required(options.owner, "--owner"),
        branch: stringOpt(options.branch),
        worktreePath: stringOpt(options.worktree),
        scope: stringOpt(options.scope),
      }),
      json,
    );
  }
  if (action === "validate") {
    return output(
      validateAssignmentReport(await readJson(root, id ?? required(options.file, "--file"))),
      json,
    );
  }
  if (action === "complete" || action === "fail" || action === "cancel") {
    if (options["from-json"]) {
      const raw = asRecord(
        await readJson(root, required(options["from-json"], "--from-json")),
        "--from-json",
      );
      return output(
        await completeAssignment(root, requiredArg(id, "assignment id"), {
          status: action === "complete" ? "complete" : action === "fail" ? "failed" : "cancelled",
          summary: requiredNodeStringField(raw, "summary", "--from-json"),
          commits: strictStringArrayField(raw, "commits", "--from-json"),
          evidence: strictStringArrayField(raw, "evidence", "--from-json"),
        }),
        json,
      );
    }
    return output(
      await completeAssignment(root, requiredArg(id, "assignment id"), {
        status: action === "complete" ? "complete" : action === "fail" ? "failed" : "cancelled",
        summary: required(options.summary, "--summary"),
        commits: stringListOpt(options.commit),
        evidence: stringListOpt(options.evidence),
      }),
      json,
    );
  }
  if (action === "list" || !action) {
    return output(
      await listAssignments(root, {
        nodeId: stringOpt(options.node),
        status: strictEnumOpt(options.status, isAssignmentStatus, "--status"),
      }),
      json,
    );
  }
  throw new Error(`Unknown assignment action: ${action}`);
}

export async function waveCommand(
  root: string,
  action: string | undefined,
  id: string | undefined,
  positionals: string[],
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "start") {
    return output(
      await startWave(root, {
        kind: strictEnumOpt(options.kind, isWaveKind, "--kind", "implementation"),
        summary: required(options.summary, "--summary"),
      }),
      json,
    );
  }
  if (action === "add-node") {
    await addWaveNode(root, requiredArg(id, "wave id"), requiredArg(positionals[0], "node id"));
    return output({ ok: true }, json);
  }
  if (action === "add-assignment") {
    await addWaveAssignment(
      root,
      requiredArg(id, "wave id"),
      requiredArg(positionals[0], "assignment id"),
    );
    return output({ ok: true }, json);
  }
  if (action === "complete" || action === "cancel") {
    return output(
      await completeWave(root, requiredArg(id, "wave id"), {
        status: action === "cancel" ? "cancelled" : "complete",
        summary: required(options.summary, "--summary"),
      }),
      json,
    );
  }
  if (action === "status" || action === "list" || !action) {
    return output(
      { waves: await listWaves(root), memberships: await listWaveMemberships(root) },
      json,
    );
  }
  throw new Error(`Unknown wave action: ${action}`);
}
