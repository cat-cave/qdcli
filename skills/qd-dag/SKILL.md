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
qd config set check-command "<fast project check command>"
qd config set ci-command "<full project CI command>"
qd config set merge-strategy "squash"
qd config set ci-provider github --repo owner/name --workflow ci.yml --auth gh-cli
qd config get ci-command
```

`check_command` is the faster preflight used by `qd check run`; it records evidence but does not make a node mergeable. `ci_command` is the full trusted gate used by `qd ci run`; a pass makes the node mergeable. Node-level `check_command` and `ci_command` overrides are for scoped checks that are still honest for that node. Good CI commands run the checks the repository actually trusts before merge. Weak commands make the DAG look healthier than the project really is.

Provider polling is adapter-based. GitHub via the `gh` CLI is one adapter, not a qd worldview. If a repository uses another provider, use `qd ci run` or `qd ci record-pass` with evidence until a provider adapter exists.

The default opinion is strict:

- `require_gate_before_ci = true`: open P0/P1 findings block check runs.
- `require_ci_before_merge = true`: merge requires the latest CI run to pass.
- `require_clean_worktree = true`: checks run only from a clean worktree, excluding qd's own `.qd/` state.

Change these only when the repository genuinely needs a different operating model, and record why with `qd node note <id> --text "..."` or in project docs.

Treat `.qd/qd.db` as a local cache. The durable shared artifact is qd's deterministic JSON export:

```sh
qd export --deterministic --out roadmap/spec-dag.json
qd sync --from roadmap/spec-dag.json --dry-run --json
qd sync --from roadmap/spec-dag.json --expect-clean --json
```

Use `qd sync --expect-clean` before starting orchestration from a committed export when the local cache should already match it. If qd reports drift, inspect the dry-run output or write a diff artifact with `--write-diff <json>`; do not start delegating work from ambiguous DAG state. Use plain `qd sync --from <file>` only when intentionally replacing the local cache from the committed JSON.

For mature projects, migrate non-qd roadmap state instead of recreating it manually:

```sh
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json
qd validate
```

Register strict metadata before import when the project relies on it:

```sh
qd group register --name "agent-runtime"
qd project register --name "app"
qd milestone register --name "baseline" --rank 10
```

## Agent Protocol

1. The orchestrator runs `qd doctor --json`, `qd status --json`, and `qd ready --json`.
2. The orchestrator chooses one or more ready nodes and delegates them to subagents.
3. Each delegated node is claimed with `qd claim <id> --agent <name>` so ownership is visible.
4. Implementation subagents receive `qd prompt implement <id>` plus any project-specific context.
5. The orchestrator records completion with `qd complete <id> --summary "..."`.
6. Audit subagents review the completed node and the orchestrator records structured findings, preferably with `qd audit pass <id> --from-report <file>`.
7. P0/P1 findings are resolved before checks. P2/P3 findings are promoted after the current node passes the gate.
8. Manual verification gates are signed off with `qd verification sign-off` when the node declares them.
9. The orchestrator runs `qd gate <id> --phase ci --json` before CI when policy must be included in `ok`.
10. The orchestrator runs `qd check run <id>` when a fast local preflight is useful.
11. The orchestrator runs `qd ci run <id>` or `qd ci poll <id>` for the full merge gate; `qd ci record-pass` is only for recording an externally completed CI check with evidence.
12. The orchestrator runs `qd gate <id> --phase merge --json` before recording merge state.
13. The orchestrator performs the repo's real git/GitHub merge through the normal workflow, then uses `qd merge <id> --use-existing-commit <sha>` only after qd marks the node mergeable.

`qd merge` records qd state only. It does not run `git merge`, squash commits, rebase, push, or open/merge a GitHub PR. For direct-to-main workflows, use `qd merge <id> --use-existing-commit <sha>` after the real merge so qd records the commit it represents.

Never bypass the ready queue. If the graph is wrong, fix the graph.
