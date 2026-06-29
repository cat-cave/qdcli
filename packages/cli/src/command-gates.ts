export function requiresMethodAcknowledgement(
  group: string,
  action: string | undefined,
  options: Record<string, string | string[] | boolean>,
): boolean {
  if (READ_ONLY_GROUPS.has(group)) return false;
  if (group === "import" && options["dry-run"]) return false;
  if (group === "sync" && (options["dry-run"] || options["expect-clean"])) return false;
  if (group === "node" && (action === "show" || action === "list" || !action)) return false;
  if (group === "edge" && (action === "list" || !action)) return false;
  if (group === "note" && (action === "list" || !action)) return false;
  if (group === "run" && (action === "show" || action === "list" || !action)) return false;
  if (group === "audit" && (action === "validate" || action === "list" || !action)) return false;
  if (group === "finding" && (action === "list" || !action)) return false;
  if (group === "verification" && (action === "list" || action === "validate" || !action)) {
    return false;
  }
  if (group === "milestone" && (action === "status" || action === "next" || !action)) return false;
  return true;
}

const READ_ONLY_GROUPS = new Set([
  "init",
  "setup",
  "doctor",
  "migrate",
  "upgrade",
  "status",
  "ready",
  "graph",
  "validate",
  "config",
  "export",
  "workspace",
  "policy",
  "velocity",
  "critical-path",
  "eta",
  "stats",
  "snapshot",
  "prompt",
  "agent",
  "view",
  "env",
  "schema",
  "template",
  "method",
  "diff",
  "gate",
  "completion-ready",
  "merge-ready",
]);
