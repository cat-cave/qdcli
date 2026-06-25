# qd DAG

Use qdcli when project work is too large for one agent pass and too risky to coordinate by memory. qd is not an agent runtime. It is the durable agreement between the user and one central orchestrator agent about what is ready, what is blocked, what has been checked, and what is safe to merge.

The intended model is orchestrator-led. The orchestrator keeps its own context clean by using qd as the ledger, then delegates implementation and audit work to subagents. Those subagents can work in git worktrees, remote machines, or another project-specific setup. qd does not manage or police that execution environment. qd enforces the work contract: dependency chains are respected, specs are completed, audits are recorded, findings are resolved or promoted into the DAG, and CI is green before merge.

The point is not to make every subagent independently choose work from qd. The point is to prevent the common failure modes: starting blocked work, losing audit findings, treating review comments as prose instead of state, forgetting which checks define "green", or merging work that has not passed the same gate the project normally trusts.

## Operating Beliefs

- A node is only worth doing if its acceptance criteria can be checked.
- A dependency edge should mean "this cannot be safely done before that", not "I happen to prefer this order".
- A project needs one canonical command that means "this work is green enough to merge".
- Main should stay green. Allowing known-bad code onto main makes every future merge decision ambiguous.
- P0/P1 findings are current-node blockers. P2/P3 findings are future DAG shape.
- The orchestrator should parse qd with `--json`, but humans should be able to scan qd output quickly.

## Setup Expectations

During setup, configure qd for the repository's real definition of green:

```sh
qd config set check-command --value "nix develop -c just ci"
qd config set ci-command --value "nix develop -c just ci"
qd config set merge-strategy --value "squash"
```

Use the project's equivalent command if it is not Nix. Good commands run formatting checks, lint, typecheck, tests, build, and any repo-specific architecture or schema gates. Weak commands make the DAG look healthier than the project really is.

The default opinion is strict:

- `require_gate_before_ci = true`: open P0/P1 findings block check runs.
- `require_ci_before_merge = true`: merge requires the latest CI run to pass.
- `require_clean_worktree = true`: checks run only from a clean worktree, excluding qd's own `.qd/` state.

Change these only when the repository genuinely needs a different operating model, and record why in the node or project docs.

## Agent Protocol

1. The orchestrator runs `qd doctor --json`, `qd status --json`, and `qd ready --json`.
2. The orchestrator chooses one or more ready nodes and delegates them to subagents.
3. Each delegated node is claimed with `qd claim <id> --agent <name>` so ownership is visible.
4. Implementation subagents receive `qd prompt implement <id>` plus any project-specific context.
5. The orchestrator records completion with `qd complete <id> --summary "..."`.
6. Audit subagents review the completed node and the orchestrator records structured findings.
7. P0/P1 findings are resolved before checks. P2/P3 findings are promoted after the current node passes the gate.
8. The orchestrator runs `qd ci run <id>`; `qd ci pass` is only for recording an externally completed check.
9. The orchestrator uses `qd merge <id>` only after qd marks the node mergeable.

Never bypass the ready queue. If the graph is wrong, fix the graph.
