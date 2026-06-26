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

Use qdcli when project work is too large for one agent pass and too risky to coordinate by memory. qd is not an agent runtime. It is the durable agreement between the user and one central orchestrator agent about what is ready, what is blocked, what has been checked, and what is safe to merge.

The intended model is orchestrator-led. The orchestrator keeps its own context clean by using qd as the ledger, then delegates implementation and audit work to subagents. Those subagents can work in git worktrees, remote machines, or another project-specific setup. qd does not manage or police that execution environment. qd enforces the work contract: dependency chains are respected, specs are completed, audits are recorded, findings are resolved or promoted into the DAG, and CI is green before merge.

The point is not to make every subagent independently choose work from qd. The point is to prevent the common failure modes: starting blocked work, losing audit findings, treating review comments as prose instead of state, forgetting which checks define "green", or merging work that has not passed the same gate the project normally trusts.

## Operating Beliefs

- A node is only worth doing if its acceptance criteria can be checked.
- A dependency edge should mean "this cannot be safely done before that", not "I happen to prefer this order".
- A project needs one canonical command that means "this work is green enough to merge".
- Main should stay green. Allowing known-bad code onto main makes every future merge decision ambiguous.
- P0/P1 findings are current-node blockers. P2/P3 findings are future DAG shape.
- The orchestrator should parse qd with \`--json\`, but humans should be able to scan qd output quickly.

## Setup Expectations

During setup, configure qd for the repository's real definition of green:

\`\`\`sh
qd config set check-command --value "<fast project check command>"
qd config set ci-command --value "<full project CI command>"
qd config set merge-strategy --value "squash"
qd config get ci-command
\`\`\`

\`check_command\` is the faster preflight used by \`qd check run\`; it records evidence but does not make a node mergeable. \`ci_command\` is the full trusted gate used by \`qd ci run\`; a pass makes the node mergeable. Good CI commands run the checks the repository actually trusts before merge. Weak commands make the DAG look healthier than the project really is.

The default opinion is strict:

- \`require_gate_before_ci = true\`: open P0/P1 findings block check runs.
- \`require_ci_before_merge = true\`: merge requires the latest CI run to pass.
- \`require_clean_worktree = true\`: checks run only from a clean worktree, excluding qd's own \`.qd/\` state.

Change these only when the repository genuinely needs a different operating model, and record why with \`qd node note <id> --text "..."\` or in project docs.

Use \`qd snapshot --json\` when the orchestrator needs a compact state refresh with status, ready nodes, open findings, and critical path. Use \`qd prompt implement <id> --json\` when delegating so the subagent gets both the prompt text and structured node context.

For mature projects, import existing DAG state instead of recreating it manually:

\`\`\`sh
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json --dry-run --json
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json
qd validate
\`\`\`

When importing, review every dry-run error, default, warning, and dropped field. Unknown source statuses must be mapped with \`statusMap\`; qd should not turn unfamiliar lifecycle states into ready work by accident.

Register strict metadata before import when the project relies on it:

\`\`\`sh
qd group register --name "agent-runtime"
qd project register --name "itotori"
qd milestone register --name "baseline" --rank 10
\`\`\`

## Agent Protocol

1. The orchestrator runs \`qd doctor --json\`, \`qd status --json\`, and \`qd ready --json\`.
2. The orchestrator chooses one or more ready nodes and delegates them to subagents.
3. Each delegated node is claimed with \`qd claim <id> --agent <name>\` so ownership is visible.
4. Implementation subagents receive \`qd prompt implement <id>\` plus any project-specific context.
5. The orchestrator records completion with \`qd complete <id> --summary "..."\`.
6. Audit subagents review the completed node and the orchestrator records structured findings.
7. P0/P1 findings are resolved before checks. P2/P3 findings are promoted after the current node passes the gate.
8. The orchestrator runs \`qd check run <id>\` when a fast local preflight is useful.
9. The orchestrator runs \`qd ci run <id>\` for the full merge gate; \`qd ci pass\` is only for recording an externally completed CI check.
10. The orchestrator performs the repo's real git/GitHub merge through the normal workflow, then uses \`qd merge <id>\` only after qd marks the node mergeable.

\`qd merge\` records qd state only. It does not run \`git merge\`, squash commits, rebase, push, or open/merge a GitHub PR.

Never bypass the ready queue. If the graph is wrong, fix the graph.
`;
