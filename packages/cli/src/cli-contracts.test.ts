import { describe, expect, it } from "vite-plus/test";
import {
  ASSIGNMENT_ROLES,
  ASSIGNMENT_STATUSES,
  BLOCKER_TYPES,
  EDGE_TYPES,
  FINDING_STATUSES,
  IMPORT_ADAPTERS,
  MERGE_STRATEGIES,
  NODE_KINDS,
  NODE_STATUSES,
  NOTE_KINDS,
  POLICY_PHASES,
  PRIORITIES,
  RISKS,
  RUN_KINDS,
  VERIFICATION_TYPES,
  WAVE_KINDS,
  importAdapter,
  isAssignmentRole,
  isAssignmentStatus,
  isBlockerType,
  isEdgeType,
  isFindingStatus,
  isMergeStrategy,
  isNodeKind,
  isNodeStatus,
  isNoteKind,
  isPolicyPhase,
  isPriority,
  isRisk,
  isRunKind,
  isVerificationType,
  isWaveKind,
  nullableEnumField,
  optionalEnumField,
  strictEnum,
  strictEnumOpt,
  strictOptionalEnum,
  validValuesFor,
} from "./enums.js";

describe("CLI contracts", () => {
  it("keeps enum values exact and guard functions strict", () => {
    expect(NODE_KINDS).toEqual([
      "feature",
      "fix",
      "refactor",
      "test",
      "docs",
      "infra",
      "audit-fix",
    ]);
    expect(IMPORT_ADAPTERS).toEqual(["roadmap-html", "markdown-checklist"]);
    expect(NODE_STATUSES).toEqual([
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
    ]);
    expect(PRIORITIES).toEqual(["P0", "P1", "P2", "P3"]);
    expect(RISKS).toEqual(["low", "medium", "high"]);
    expect(EDGE_TYPES).toEqual(["requires", "unblocks", "supersedes", "related"]);
    expect(FINDING_STATUSES).toEqual(["open", "resolved", "promoted", "dismissed"]);
    expect(VERIFICATION_TYPES).toEqual(["command", "manual", "url", "note"]);
    expect(MERGE_STRATEGIES).toEqual(["squash", "merge", "rebase"]);
    expect(BLOCKER_TYPES).toEqual(["manual", "external", "policy"]);
    expect(RUN_KINDS).toEqual([
      "implement",
      "audit",
      "resolve",
      "check",
      "ci",
      "verification",
      "merge",
    ]);
    expect(ASSIGNMENT_ROLES).toEqual([
      "planner",
      "worker",
      "auditor",
      "repair",
      "reviewer",
      "explorer",
    ]);
    expect(ASSIGNMENT_STATUSES).toEqual(["open", "complete", "failed", "cancelled"]);
    expect(WAVE_KINDS).toEqual(["implementation", "audit", "repair", "planning", "release"]);
    expect(NOTE_KINDS).toContain("operator-instruction");
    expect(POLICY_PHASES).toEqual(["completion", "ci", "merge"]);

    const guards = [
      [isNodeKind, "feature", "bogus", NODE_KINDS],
      [isNodeStatus, "ready", "waiting", NODE_STATUSES],
      [isPriority, "P1", "P4", PRIORITIES],
      [isRisk, "high", "critical", RISKS],
      [isEdgeType, "requires", "blocks", EDGE_TYPES],
      [isFindingStatus, "open", "closed", FINDING_STATUSES],
      [isMergeStrategy, "squash", "direct", MERGE_STRATEGIES],
      [isBlockerType, "manual", "owner", BLOCKER_TYPES],
      [isVerificationType, "command", "script", VERIFICATION_TYPES],
      [isRunKind, "audit", "deploy", RUN_KINDS],
      [isAssignmentRole, "worker", "driver", ASSIGNMENT_ROLES],
      [isAssignmentStatus, "complete", "done", ASSIGNMENT_STATUSES],
      [isWaveKind, "repair", "wave", WAVE_KINDS],
      [isNoteKind, "risk-acceptance", "comment", NOTE_KINDS],
      [isPolicyPhase, "merge", "publish", POLICY_PHASES],
    ] as const;
    for (const [guard, valid, invalid, values] of guards) {
      expect(guard(valid)).toBe(true);
      expect(guard(invalid)).toBe(false);
      expect(validValuesFor(guard)).toBe(values);
    }
    expect(validValuesFor(() => false)).toEqual([]);
  });

  it("parses enum options without silent fallback", () => {
    expect(strictEnumOpt("P2", isPriority, "--priority", "P1")).toBe("P2");
    expect(strictEnumOpt(undefined, isPriority, "--priority", "P1")).toBe("P1");
    expect(strictEnumOpt(undefined, isPriority, "--priority")).toBeUndefined();
    expect(() => strictEnumOpt("P9", isPriority, "--priority")).toThrow(/--priority/);
    expect(strictOptionalEnum(undefined, isRisk, "--risk", "medium")).toBe("medium");
    expect(strictOptionalEnum("low", isRisk, "--risk", "medium")).toBe("low");
    expect(() => strictOptionalEnum("none", isRisk, "--risk", "medium")).toThrow(/--risk/);
    expect(optionalEnumField(undefined, isNodeKind, "kind")).toBeUndefined();
    expect(optionalEnumField("docs", isNodeKind, "kind")).toBe("docs");
    expect(() => optionalEnumField("doc", isNodeKind, "kind")).toThrow(/kind/);
    expect(nullableEnumField(null, isBlockerType, "blocked_by")).toBeNull();
    expect(nullableEnumField(undefined, isBlockerType, "blocked_by")).toBeUndefined();
    expect(nullableEnumField("policy", isBlockerType, "blocked_by")).toBe("policy");
    expect(() => nullableEnumField("soft", isBlockerType, "blocked_by")).toThrow(/or null/);
    expect(strictEnum("manual", isVerificationType, "type")).toBe("manual");
    expect(() => strictEnum("human", isVerificationType, "type")).toThrow(/type/);
    expect(importAdapter("roadmap-html")).toBe("roadmap-html");
    expect(() => importAdapter("json")).toThrow(/--adapter/);
  });
});
