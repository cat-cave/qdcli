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
  | "blocked"
  | "cancelled";
export type Priority = "P0" | "P1" | "P2" | "P3";
export type Risk = "low" | "medium" | "high";
export type EdgeType = "requires" | "unblocks" | "supersedes" | "related";
export type RunKind = "implement" | "audit" | "resolve" | "ci" | "merge";
export type FindingStatus = "open" | "resolved" | "promoted" | "dismissed";

export interface QdNode {
  id: string;
  title: string;
  kind: NodeKind;
  milestone: string | null;
  status: NodeStatus;
  priority: Priority;
  estimate_points: number;
  risk: Risk;
  owner: string | null;
  branch: string | null;
  spec: string;
  acceptance: string;
  validation: string | null;
  context: string | null;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  done_at: string | null;
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

