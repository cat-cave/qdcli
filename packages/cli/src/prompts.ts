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

Use qdcli when project work is too large for one agent pass and too risky to coordinate by memory. qd is not an agent runtime. It is the durable agreement between the user, orchestrator agent, implementer agents, and auditor agents about what is ready, what is blocked, what has been checked, and what is safe to merge.

The point is not to make agents type more commands. The point is to prevent the common failure modes: agents starting blocked work, losing audit findings, treating review comments as prose instead of state, forgetting which checks define "green", or merging work that has not passed the same gate the project normally trusts.

## Operating Beliefs

- A node is only worth doing if its acceptance criteria can be checked.
- A dependency edge should mean "this cannot be safely done before that", not "I happen to prefer this order".
- A project needs one canonical command that means "this work is green enough to merge".
- P0/P1 findings are current-node blockers. P2/P3 findings are future DAG shape.
- Agents should parse qd with \`--json\`, but humans should be able to scan qd output quickly.

## Setup Expectations

During setup, configure qd for the repository's real definition of green:

\`\`\`sh
qd config set check-command --value "nix develop -c just ci"
qd config set ci-command --value "nix develop -c just ci"
qd config set merge-strategy --value "squash"
\`\`\`

Use the project's equivalent command if it is not Nix. Good commands run formatting checks, lint, typecheck, tests, build, and any repo-specific architecture or schema gates. Weak commands make the DAG look healthier than the project really is.

The default opinion is strict:

- \`require_gate_before_ci = true\`: open P0/P1 findings block check runs.
- \`require_ci_before_merge = true\`: merge requires the latest CI run to pass.
- \`require_clean_worktree = true\`: checks run only from a clean worktree, excluding qd's own \`.qd/\` state.

Change these only when the repository genuinely needs a different operating model, and record why in the node or project docs.

## Agent Protocol

1. Run \`qd doctor --json\`, \`qd status --json\`, and \`qd ready --json\`.
2. Claim exactly one ready node with \`qd claim <id> --agent <name>\`.
3. Read scoped context with \`qd prompt implement <id>\`.
4. Implement only the node's spec and acceptance criteria.
5. Record completion with \`qd complete <id> --summary "..."\`.
6. Audit with \`qd audit start <id>\` and structured \`qd finding add\` commands.
7. Resolve P0/P1 findings before checks.
8. Run \`qd ci run <id>\`; do not use \`qd ci pass\` unless recording an externally completed check.
9. Promote P2/P3 findings with \`qd promote-findings <id>\` after the gate passes.
10. Use \`qd merge <id>\` only after qd marks the node mergeable.

Never bypass the ready queue. If the graph is wrong, fix the graph.
`;
