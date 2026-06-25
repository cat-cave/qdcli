# Agent Protocol

qd is designed for one central orchestrator agent. The orchestrator manages the DAG, keeps its own context clean, and delegates implementation and audit work to subagents. Subagents may work in git worktrees, remote machines, or any other project-specific environment. qd does not manage that execution layer.

qd is the authoritative DAG ledger and quality gate. It works best when the repo has one canonical command that means "green enough to merge", and when main is kept green after every merge.

During setup, configure that command:

```sh
qd config set check-command --value "nix develop -c just ci"
qd config set ci-command --value "nix develop -c just ci"
```

Use the project's equivalent if it is not Nix.

1. The orchestrator runs `qd doctor`.
2. The orchestrator inspects `qd status --json`.
3. The orchestrator inspects `qd ready --json`.
4. The orchestrator selects ready nodes and delegates them.
5. Each delegated node is claimed with `qd claim <node> --agent <name>`.
6. Implementation subagents receive `qd prompt implement <node>` and project context.
7. The orchestrator records completion with `qd complete`.
8. Audit subagents review work; the orchestrator records structured findings.
9. P0/P1 findings are resolved before CI or merge.
10. P2/P3 findings are promoted into future nodes after the current node passes.
11. The orchestrator runs `qd ci run <node>` rather than manually recording a pass.
12. The orchestrator merges only after qd marks the node mergeable.

Never work a blocked node unless the user explicitly changes the DAG.
