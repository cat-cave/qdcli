import type {
  AssignmentRole,
  AssignmentStatus,
  BlockerType,
  EdgeType,
  FindingStatus,
  ImportAdapter,
  NoteKind,
  NodeKind,
  NodeStatus,
  PolicyPhase,
  Priority,
  QdConfig,
  Risk,
  RunKind,
  VerificationEntry,
  WaveKind,
} from "@cat-cave/qdcli-core";
import { stringListOpt, stringOpt } from "./args.js";

export const NODE_KINDS = ["feature", "fix", "refactor", "test", "docs", "infra", "audit-fix"];
export const IMPORT_ADAPTERS = ["roadmap-html", "markdown-checklist"];
export const NODE_STATUSES = [
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
];
export const PRIORITIES = ["P0", "P1", "P2", "P3"];
export const RISKS = ["low", "medium", "high"];
export const EDGE_TYPES = ["requires", "unblocks", "supersedes", "related"];
export const FINDING_STATUSES = ["open", "resolved", "promoted", "dismissed"];
export const VERIFICATION_TYPES = ["command", "manual", "url", "note"];
export const MERGE_STRATEGIES = ["squash", "merge", "rebase"];
export const BLOCKER_TYPES = ["manual", "external", "policy"];
export const RUN_KINDS = ["implement", "audit", "resolve", "check", "ci", "verification", "merge"];
export const ASSIGNMENT_ROLES = ["planner", "worker", "auditor", "repair", "reviewer", "explorer"];
export const ASSIGNMENT_STATUSES = ["open", "complete", "failed", "cancelled"];
export const WAVE_KINDS = ["implementation", "audit", "repair", "planning", "release"];
export const NOTE_KINDS = [
  "note",
  "blocker",
  "retry",
  "external-dependency",
  "operator-instruction",
  "audit-disposition",
  "live-run-attempt",
  "environment-preflight",
  "risk-acceptance",
  "migration-note",
];
export const POLICY_PHASES = ["completion", "ci", "merge"];

export function strictEnumOpt<T extends string>(
  value: string | string[] | boolean | undefined,
  isValue: (candidate: string) => candidate is T,
  label: string,
  fallback: T,
): T;
export function strictEnumOpt<T extends string>(
  value: string | string[] | boolean | undefined,
  isValue: (candidate: string) => candidate is T,
  label: string,
): T | undefined;
export function strictEnumOpt<T extends string>(
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

export function strictOptionalEnum<T extends string>(
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

export function optionalEnumField<T extends string>(
  value: string | undefined,
  isValue: (candidate: string) => candidate is T,
  label: string,
): T | undefined {
  if (!value) return undefined;
  if (!isValue(value)) {
    throw new Error(`${label} must be one of ${validValuesFor(isValue).join(", ")}`);
  }
  return value;
}

export function nullableEnumField<T extends string>(
  value: string | null | undefined,
  isValue: (candidate: string) => candidate is T,
  label: string,
): T | null | undefined {
  if (value === undefined || value === null) return value;
  if (!isValue(value)) {
    throw new Error(`${label} must be one of ${validValuesFor(isValue).join(", ")} or null`);
  }
  return value;
}

export function strictEnum<T extends string>(
  value: string,
  isValue: (candidate: string) => candidate is T,
  label: string,
): T {
  if (!isValue(value))
    throw new Error(`${label} must be one of ${validValuesFor(isValue).join(", ")}`);
  return value;
}

export function validValuesFor(isValue: (candidate: string) => boolean): readonly string[] {
  if (isValue === isNodeKind) return NODE_KINDS;
  if (isValue === isNodeStatus) return NODE_STATUSES;
  if (isValue === isPriority) return PRIORITIES;
  if (isValue === isRisk) return RISKS;
  if (isValue === isEdgeType) return EDGE_TYPES;
  if (isValue === isFindingStatus) return FINDING_STATUSES;
  if (isValue === isVerificationType) return VERIFICATION_TYPES;
  if (isValue === isMergeStrategy) return MERGE_STRATEGIES;
  if (isValue === isBlockerType) return BLOCKER_TYPES;
  if (isValue === isRunKind) return RUN_KINDS;
  if (isValue === isAssignmentRole) return ASSIGNMENT_ROLES;
  if (isValue === isAssignmentStatus) return ASSIGNMENT_STATUSES;
  if (isValue === isWaveKind) return WAVE_KINDS;
  if (isValue === isNoteKind) return NOTE_KINDS;
  if (isValue === isPolicyPhase) return POLICY_PHASES;
  return [];
}

export function importAdapter(value: string): ImportAdapter {
  if (IMPORT_ADAPTERS.includes(value)) return value as ImportAdapter;
  throw new Error(`--adapter must be one of ${IMPORT_ADAPTERS.join(", ")}`);
}

export function isPriority(value: string): value is Priority {
  return PRIORITIES.includes(value);
}

export function isNodeKind(value: string): value is NodeKind {
  return NODE_KINDS.includes(value);
}

export function isNodeStatus(value: string): value is NodeStatus {
  return NODE_STATUSES.includes(value);
}

export function isRisk(value: string): value is Risk {
  return RISKS.includes(value);
}

export function isEdgeType(value: string): value is EdgeType {
  return EDGE_TYPES.includes(value);
}

export function isFindingStatus(value: string): value is FindingStatus {
  return FINDING_STATUSES.includes(value);
}

export function isMergeStrategy(value: string): value is QdConfig["mergeStrategy"] {
  return MERGE_STRATEGIES.includes(value);
}

export function isBlockerType(value: string): value is BlockerType {
  return BLOCKER_TYPES.includes(value);
}

export function isVerificationType(value: string): value is VerificationEntry["type"] {
  return VERIFICATION_TYPES.includes(value);
}

export function isRunKind(value: string): value is RunKind {
  return RUN_KINDS.includes(value);
}

export function isAssignmentRole(value: string): value is AssignmentRole {
  return ASSIGNMENT_ROLES.includes(value);
}

export function isAssignmentStatus(value: string): value is AssignmentStatus {
  return ASSIGNMENT_STATUSES.includes(value);
}

export function isWaveKind(value: string): value is WaveKind {
  return WAVE_KINDS.includes(value);
}

export function isNoteKind(value: string): value is NoteKind {
  return NOTE_KINDS.includes(value);
}

export function isPolicyPhase(value: string): value is PolicyPhase {
  return POLICY_PHASES.includes(value);
}

export function parseSeverityList(
  value: string | string[] | boolean | undefined,
): Priority[] | undefined {
  const raw = stringListOpt(value).flatMap((item) => item.split(","));
  if (raw.length === 0) return undefined;
  return raw.map((item) => {
    const severity = item.trim();
    if (!isPriority(severity)) throw new Error("--severity must contain P0, P1, P2, or P3");
    return severity;
  });
}

export function parseStatusList(
  value: string | string[] | boolean | undefined,
): NodeStatus[] | undefined {
  const raw = stringListOpt(value).flatMap((item) => item.split(","));
  if (raw.length === 0) return undefined;
  return raw.map((item) => {
    const status = item.trim();
    if (!isNodeStatus(status)) {
      throw new Error(`--status must contain one of ${NODE_STATUSES.join(", ")}`);
    }
    return status;
  });
}

export function parseNoteKindList(
  value: string | string[] | boolean | undefined,
): NoteKind[] | undefined {
  const raw = stringListOpt(value).flatMap((item) => item.split(","));
  if (raw.length === 0) return undefined;
  return raw.map((item) => {
    const kind = item.trim();
    if (!isNoteKind(kind)) throw new Error(`--kind must contain one of ${NOTE_KINDS.join(", ")}`);
    return kind;
  });
}
