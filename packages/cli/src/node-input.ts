import type {
  AddNodeInput,
  GraphSnapshot,
  VerificationEntry,
  updateNode,
} from "@cat-cave/qdcli-core";
import {
  hasOption,
  numberOpt,
  required,
  stringListOpt,
  stringOpt,
  stripUndefinedValues,
} from "./args.js";
import {
  isBlockerType,
  isNodeKind,
  isNodeStatus,
  isPriority,
  isRisk,
  isVerificationType,
  nullableEnumField,
  optionalEnumField,
  strictEnumOpt,
  strictOptionalEnum,
  VERIFICATION_TYPES,
} from "./enums.js";
import { readJson, readTextFile } from "./file-io.js";
import {
  asRecord,
  isNonEmptyString,
  nullableStringField,
  optionalNumberField,
  optionalStringArrayField,
  optionalStringField,
  parseVerification,
  requiredNodeStringField,
} from "./object-utils.js";

export async function nodeInputFromOptions(
  root: string,
  options: Record<string, string | string[] | boolean>,
): Promise<AddNodeInput> {
  if (options["from-json"]) {
    return normalizeNodeInput(
      await readJson(root, required(options["from-json"], "--from-json")),
      "--from-json",
    );
  }
  const spec = options["spec-file"]
    ? await readTextFile(root, required(options["spec-file"], "--spec-file"))
    : required(options.spec, "--spec");
  const acceptance = options["acceptance-file"]
    ? await readTextFile(root, required(options["acceptance-file"], "--acceptance-file"))
    : required(options.acceptance, "--acceptance");
  return {
    id: stringOpt(options.id),
    title: required(options.title, "--title"),
    kind: strictEnumOpt(options.kind, isNodeKind, "--kind", "feature"),
    milestone: stringOpt(options.milestone),
    groupName: stringOpt(options.group),
    projects: stringListOpt(options.project),
    status: strictEnumOpt(options.status, isNodeStatus, "--status", "ready"),
    priority: strictEnumOpt(options.priority, isPriority, "--priority", "P2"),
    estimatePoints: numberOpt(options.estimate) ?? 1,
    risk: strictEnumOpt(options.risk, isRisk, "--risk", "medium"),
    spec,
    acceptance,
    validation: stringOpt(options.validation),
    verification: stringListOpt(options.verify).map(parseVerification),
    auditFocus: stringListOpt(options["audit-focus"]),
    context: stringOpt(options.context),
    statusReason: stringOpt(options["status-reason"]),
    checkCommand: stringOpt(options["check-command"]),
    ciCommand: stringOpt(options["ci-command"]),
    blockedBy: strictEnumOpt(options["blocked-by"], isBlockerType, "--blocked-by"),
    blockedReason: stringOpt(options["blocked-reason"]),
    blockedOwner: stringOpt(options["blocked-owner"]),
  };
}

export async function nodeUpdateFromOptions(
  root: string,
  options: Record<string, string | string[] | boolean>,
): Promise<Parameters<typeof updateNode>[2]> {
  const fromJson = options["from-json"]
    ? normalizeNodeUpdate(
        await readJson(root, required(options["from-json"], "--from-json")),
        "--from-json",
      )
    : {};
  const spec = options["spec-file"]
    ? await readTextFile(root, required(options["spec-file"], "--spec-file"))
    : stringOpt(options.spec);
  const acceptance = options["acceptance-file"]
    ? await readTextFile(root, required(options["acceptance-file"], "--acceptance-file"))
    : stringOpt(options.acceptance);
  const blockedBy = strictEnumOpt(options["blocked-by"], isBlockerType, "--blocked-by");
  const status = strictEnumOpt(options.status, isNodeStatus, "--status");
  const clearBlocker = Boolean(options["clear-blocker"]);
  if (blockedBy && !hasOption(options, "blocked-reason")) {
    throw new Error("--blocked-reason is required when --blocked-by is set");
  }
  const cliUpdates = stripUndefinedValues({
    title: stringOpt(options.title),
    kind: strictEnumOpt(options.kind, isNodeKind, "--kind"),
    milestone: stringOpt(options.milestone),
    group_name: stringOpt(options.group),
    projects: options.project ? stringListOpt(options.project) : undefined,
    status: blockedBy && !status ? "blocked" : status,
    priority: strictEnumOpt(options.priority, isPriority, "--priority"),
    estimatePoints: numberOpt(options.estimate),
    risk: strictEnumOpt(options.risk, isRisk, "--risk"),
    spec,
    acceptance,
    validation: stringOpt(options.validation),
    verification: options.verify ? stringListOpt(options.verify).map(parseVerification) : undefined,
    audit_focus: options["audit-focus"] ? stringListOpt(options["audit-focus"]) : undefined,
    context: stringOpt(options.context),
    status_reason: stringOpt(options["status-reason"]),
    check_command: stringOpt(options["check-command"]),
    ci_command: stringOpt(options["ci-command"]),
    branch: stringOpt(options.branch),
  }) as Parameters<typeof updateNode>[2];
  const blockerUpdates = stripUndefinedValues({
    blocked_by: clearBlocker ? null : blockedBy,
    blocked_reason: clearBlocker
      ? null
      : hasOption(options, "blocked-reason")
        ? stringOpt(options["blocked-reason"])
        : undefined,
    blocked_owner: clearBlocker
      ? null
      : hasOption(options, "blocked-owner")
        ? stringOpt(options["blocked-owner"])
        : undefined,
  }) as Parameters<typeof updateNode>[2];
  return { ...fromJson, ...cliUpdates, ...blockerUpdates } as Parameters<typeof updateNode>[2];
}

export function normalizeNodeInput(raw: unknown, context: string): AddNodeInput {
  const value = asRecord(raw, context);
  return {
    id: optionalStringField(value, "id", context),
    title: requiredNodeStringField(value, "title", context),
    kind: strictOptionalEnum(
      optionalStringField(value, "kind", context),
      isNodeKind,
      `${context}.kind`,
      "feature",
    ),
    milestone: optionalStringField(value, "milestone", context),
    groupName:
      optionalStringField(value, "groupName", context) ??
      optionalStringField(value, "group_name", context) ??
      optionalStringField(value, "group", context),
    projects: optionalStringArrayField(value, "projects", context) ?? [],
    status: strictOptionalEnum(
      optionalStringField(value, "status", context),
      isNodeStatus,
      `${context}.status`,
      "ready",
    ),
    priority: strictOptionalEnum(
      optionalStringField(value, "priority", context),
      isPriority,
      `${context}.priority`,
      "P2",
    ),
    estimatePoints:
      optionalNumberField(value, "estimatePoints", context) ??
      optionalNumberField(value, "estimate_points", context) ??
      optionalNumberField(value, "estimate", context) ??
      1,
    risk: strictOptionalEnum(
      optionalStringField(value, "risk", context),
      isRisk,
      `${context}.risk`,
      "medium",
    ),
    spec: requiredNodeStringField(value, "spec", context),
    acceptance: requiredNodeStringField(value, "acceptance", context),
    validation: optionalStringField(value, "validation", context),
    verification: normalizeVerificationArray(value.verification, `${context}.verification`),
    auditFocus:
      optionalStringArrayField(value, "auditFocus", context) ??
      optionalStringArrayField(value, "audit_focus", context) ??
      [],
    context: optionalStringField(value, "context", context),
    statusReason:
      optionalStringField(value, "statusReason", context) ??
      optionalStringField(value, "status_reason", context),
    checkCommand:
      optionalStringField(value, "checkCommand", context) ??
      optionalStringField(value, "check_command", context),
    ciCommand:
      optionalStringField(value, "ciCommand", context) ??
      optionalStringField(value, "ci_command", context),
    blockedBy:
      optionalEnumField(
        optionalStringField(value, "blockedBy", context) ??
          optionalStringField(value, "blocked_by", context),
        isBlockerType,
        `${context}.blocked_by`,
      ) ?? null,
    blockedReason:
      optionalStringField(value, "blockedReason", context) ??
      optionalStringField(value, "blocked_reason", context),
    blockedOwner:
      optionalStringField(value, "blockedOwner", context) ??
      optionalStringField(value, "blocked_owner", context),
  };
}

export function normalizeNodeUpdate(
  raw: unknown,
  context: string,
): Parameters<typeof updateNode>[2] {
  const value = asRecord(raw, context);
  const blockedByValue = hasOption(value, "blockedBy")
    ? nullableStringField(value, "blockedBy", context)
    : nullableStringField(value, "blocked_by", context);
  const blockedBy = nullableEnumField(blockedByValue, isBlockerType, `${context}.blocked_by`);
  if (blockedBy && !hasOption(value, "blockedReason") && !hasOption(value, "blocked_reason")) {
    throw new Error(`${context}.blocked_reason is required when blocked_by is set`);
  }
  const status = optionalEnumField(
    optionalStringField(value, "status", context),
    isNodeStatus,
    `${context}.status`,
  );
  return stripUndefinedValues({
    title: optionalStringField(value, "title", context),
    kind: optionalEnumField(
      optionalStringField(value, "kind", context),
      isNodeKind,
      `${context}.kind`,
    ),
    milestone: nullableStringField(value, "milestone", context),
    group_name: nullableAliasStringField(value, context, "groupName", "group_name", "group"),
    projects: optionalStringArrayField(value, "projects", context),
    status: blockedBy && !status ? "blocked" : status,
    priority: optionalEnumField(
      optionalStringField(value, "priority", context),
      isPriority,
      `${context}.priority`,
    ),
    estimatePoints:
      optionalNumberField(value, "estimatePoints", context) ??
      optionalNumberField(value, "estimate_points", context) ??
      optionalNumberField(value, "estimate", context),
    risk: optionalEnumField(optionalStringField(value, "risk", context), isRisk, `${context}.risk`),
    spec: optionalStringField(value, "spec", context),
    acceptance: optionalStringField(value, "acceptance", context),
    validation: nullableStringField(value, "validation", context),
    verification:
      value.verification === undefined
        ? undefined
        : normalizeVerificationArray(value.verification, `${context}.verification`),
    audit_focus:
      optionalStringArrayField(value, "auditFocus", context) ??
      optionalStringArrayField(value, "audit_focus", context),
    context: nullableStringField(value, "context", context),
    status_reason: nullableAliasStringField(value, context, "statusReason", "status_reason"),
    check_command: nullableAliasStringField(value, context, "checkCommand", "check_command"),
    ci_command: nullableAliasStringField(value, context, "ciCommand", "ci_command"),
    branch: nullableStringField(value, "branch", context),
    blocked_by: blockedBy,
    blocked_reason: nullableAliasStringField(value, context, "blockedReason", "blocked_reason"),
    blocked_owner: nullableAliasStringField(value, context, "blockedOwner", "blocked_owner"),
  }) as Parameters<typeof updateNode>[2];
}

export function qdNodeFromInput(
  input: AddNodeInput,
  id: string,
  now: string,
): GraphSnapshot["nodes"][number] {
  return {
    id,
    title: input.title,
    kind: input.kind ?? "feature",
    milestone: input.milestone ?? null,
    group_name: input.groupName ?? null,
    projects: input.projects ?? [],
    status: input.status ?? "ready",
    priority: input.priority ?? "P2",
    estimate_points: input.estimatePoints ?? 1,
    risk: input.risk ?? "medium",
    owner: null,
    branch: null,
    spec: input.spec,
    acceptance: input.acceptance,
    validation: input.validation ?? null,
    verification: input.verification ?? [],
    audit_focus: input.auditFocus ?? [],
    context: input.context ?? null,
    status_reason: input.statusReason ?? null,
    check_command: input.checkCommand ?? null,
    ci_command: input.ciCommand ?? null,
    blocked_by: input.blockedBy ?? null,
    blocked_reason: input.blockedReason ?? null,
    blocked_owner: input.blockedOwner ?? null,
    created_at: now,
    updated_at: now,
    claimed_at: null,
    done_at: null,
  };
}

export function registriesFromNodes(
  nodes: GraphSnapshot["nodes"],
  now: string,
): GraphSnapshot["registries"] {
  return {
    groups: [...new Set(nodes.map((node) => node.group_name).filter(isNonEmptyString))]
      .sort()
      .map((name) => ({ name, created_at: now })),
    projects: [...new Set(nodes.flatMap((node) => node.projects))]
      .sort()
      .map((name) => ({ name, created_at: now })),
    milestones: [...new Set(nodes.map((node) => node.milestone).filter(isNonEmptyString))]
      .sort()
      .map((name, index) => ({ name, rank: index + 1, created_at: now })),
  };
}

function normalizeVerificationArray(value: unknown, context: string): VerificationEntry[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  return value.map((entry, index) => {
    if (typeof entry === "string") return parseVerification(entry);
    const record = asRecord(entry, `${context}[${index}]`);
    const type = requiredNodeStringField(record, "type", `${context}[${index}]`);
    if (!isVerificationType(type)) {
      throw new Error(`${context}[${index}].type must be one of ${VERIFICATION_TYPES.join(", ")}`);
    }
    return {
      type,
      value: requiredNodeStringField(record, "value", `${context}[${index}]`),
    };
  });
}

function nullableAliasStringField(
  value: Record<string, unknown>,
  context: string,
  ...fields: string[]
): string | null | undefined {
  for (const field of fields) {
    if (hasOption(value, field)) return nullableStringField(value, field, context);
  }
  return undefined;
}
