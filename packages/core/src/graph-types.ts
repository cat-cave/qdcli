import type {
  BlockerType,
  EdgeType,
  NodeKind,
  NodeStatus,
  Priority,
  QdAssignment,
  Risk,
  RunKind,
  VerificationEntry,
} from "./types.js";

export interface AddNodeInput {
  id?: string;
  title: string;
  kind?: NodeKind;
  milestone?: string | null;
  groupName?: string | null;
  projects?: string[];
  status?: NodeStatus;
  priority?: Priority;
  estimatePoints?: number;
  risk?: Risk;
  spec: string;
  acceptance: string;
  validation?: string | null;
  verification?: VerificationEntry[];
  auditFocus?: string[];
  context?: string | null;
  statusReason?: string | null;
  checkCommand?: string | null;
  ciCommand?: string | null;
  blockedBy?: BlockerType | null;
  blockedReason?: string | null;
  blockedOwner?: string | null;
}

export interface BulkEdgeInput {
  from: string;
  to: string;
  type?: EdgeType;
}

export interface AddAssignmentInput {
  nodeId: string;
  role: QdAssignment["role"];
  owner: string;
  branch?: string | null;
  worktreePath?: string | null;
  scope?: string | null;
}

export interface ListAssignmentFilters {
  nodeId?: string | null;
  status?: QdAssignment["status"] | null;
}

export interface ListRunFilters {
  nodeId?: string | null;
  status?: string | null;
  kind?: RunKind | null;
}

export interface GateExplanation {
  code: "blockingFinding" | "runningAudit" | "nodeBlocked" | "blockedDependency";
  message: string;
  node_id: string;
  evidence?: unknown;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface ValidateGraphOptions {
  strict?: boolean;
}
