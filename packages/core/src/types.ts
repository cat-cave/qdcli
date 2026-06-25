export type NodeKind = "feature" | "fix" | "refactor" | "test" | "docs" | "infra" | "audit-fix";
export type NodeStatus =
  | "draft"
  | "ready"
  | "claimed"
  | "working"
  | "review"
  | "fixing"
  | "ci"
  | "mergeable"
  | "done"
  | "regressed"
  | "blocked"
  | "cancelled";
export type Priority = "P0" | "P1" | "P2" | "P3";
export type Risk = "low" | "medium" | "high";
export type EdgeType = "requires" | "unblocks" | "supersedes" | "related";
export type RunKind = "implement" | "audit" | "resolve" | "check" | "ci" | "merge";
export type FindingStatus = "open" | "resolved" | "promoted" | "dismissed";
export type VerificationType = "command" | "manual" | "url" | "note";

export interface VerificationEntry {
  type: VerificationType;
  value: string;
}

export interface QdNode {
  id: string;
  title: string;
  kind: NodeKind;
  milestone: string | null;
  group_name: string | null;
  projects: string[];
  status: NodeStatus;
  priority: Priority;
  estimate_points: number;
  risk: Risk;
  owner: string | null;
  branch: string | null;
  spec: string;
  acceptance: string;
  validation: string | null;
  verification: VerificationEntry[];
  audit_focus: string[];
  context: string | null;
  status_reason: string | null;
  check_command: string | null;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  done_at: string | null;
}

export interface NodeNote {
  id: string;
  node_id: string;
  text: string;
  created_at: string;
}

export interface RegistryEntry {
  name: string;
  rank?: number;
  created_at: string;
}

export interface QdEdge {
  from_node: string;
  to_node: string;
  type: EdgeType;
  created_at: string;
}

export interface QdRun {
  id: string;
  node_id: string;
  kind: RunKind;
  status: string;
  worktree_path: string | null;
  agent: string | null;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
  log_path: string | null;
}

export interface QdFinding {
  id: string;
  node_id: string;
  run_id: string | null;
  severity: Priority;
  status: FindingStatus;
  title: string;
  path: string | null;
  line: number | null;
  evidence: string;
  expected: string | null;
  suggested_fix: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface GraphSnapshot {
  nodes: QdNode[];
  edges: QdEdge[];
  findings: QdFinding[];
  runs: QdRun[];
}

export interface VelocityReport {
  windowDays: number;
  completedNodes: number;
  completedPoints: number;
  pointsPerDay: number;
  averageCycleHours: number | null;
}

export interface CriticalPathNode {
  id: string;
  title: string;
  status: NodeStatus;
  estimatePoints: number;
  remainingPoints: number;
}

export interface CriticalPathReport {
  milestone: string | null;
  totalRemainingPoints: number;
  criticalPathPoints: number;
  criticalPath: CriticalPathNode[];
}

export interface EtaReport {
  milestone: string | null;
  remainingPoints: number;
  velocityPointsPerDay: number;
  etaDays: number | null;
  etaDate: string | null;
  criticalPathPoints: number;
}

export interface AnalyticsReport {
  stats: Record<string, unknown>;
  velocity: VelocityReport;
  criticalPath: CriticalPathReport;
  eta: EtaReport;
}
