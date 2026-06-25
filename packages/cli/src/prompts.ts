export function promptText(kind: string, node?: unknown): string {
  if (kind === "plan") {
    return `Build a qd DAG from mergeable, acceptance-driven nodes.

Rules:
- Split by independently mergeable behavior, not files or layers.
- Add requires edges only for true technical prerequisites.
- Every node needs concrete spec, acceptance, validation, risk, priority, and estimate.
- Use milestones for product phases; use edges for dependency truth.
- Mark unknowns as discovery nodes with explicit outputs.`;
  }

  if (kind === "audit") {
    return `Audit the node against its spec and acceptance criteria.

Create structured findings:
- P0: security/data loss/build break/core behavior failure.
- P1: important regression or missing required acceptance.
- P2: non-blocking follow-up that should become a new node.
- P3: polish or future improvement.

Use qd finding add for each issue. P0/P1 block qd gate.`;
  }

  if (kind === "resolve") {
    return `Resolve only open P0/P1 findings for this node.

Protocol:
- Inspect qd prompt implement <node> and current findings.
- Make the smallest fix that satisfies the finding.
- Mark each fixed finding with qd finding resolve.
- Re-run qd gate before CI.`;
  }

  return `Implement the claimed qd node.

Protocol:
- Run qd doctor, qd status, and qd ready before starting.
- Claim exactly one ready node before editing.
- Respect requires edges; do not work blocked nodes.
- Use the node spec and acceptance as the scope boundary.
- Record completion with qd complete.
- Prefer --json when parsing command output.

Node context:
${node ? JSON.stringify(node, null, 2) : "Run qd prompt implement <node> for node-specific context."}`;
}

export const skillText = `# qd DAG

Use qdcli to coordinate agent work through a durable DAG. qd is not an agent runtime; it is the source of truth for task readiness, claims, audits, findings, CI state, and merge state.

## Protocol

1. Run \`qd doctor\`, \`qd status --json\`, and \`qd ready --json\`.
2. Claim exactly one ready node with \`qd claim <id> --agent <name>\`.
3. Read scoped context with \`qd prompt implement <id>\`.
4. Implement only the node's spec and acceptance criteria.
5. Record completion with \`qd complete <id> --summary "..."\`.
6. Audit with \`qd audit start <id>\` and structured \`qd finding add\` commands.
7. Treat open P0/P1 findings as blockers. Resolve them before CI or merge.
8. Promote P2/P3 findings with \`qd promote-findings <id>\` after the gate passes.
9. Use \`qd gate <id>\`, \`qd ci pass <id>\`, and \`qd merge <id>\` to advance the lifecycle.

## DAG quality

- Nodes must be independently mergeable.
- Edges must represent real prerequisites.
- Acceptance criteria must be checkable.
- Use JSON output for parsing.
- Never bypass the ready queue.
`;
