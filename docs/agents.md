# Agent Protocol

qd is designed for one central orchestrator agent. The orchestrator manages the DAG, keeps its own context clean, and delegates implementation and audit work to subagents. Subagents may work in git worktrees, remote machines, or any other project-specific environment. qd does not manage that execution layer.

qd is the authoritative DAG ledger and quality gate. It works best when the repo has one canonical command that means "green enough to merge", and when main is kept green after every merge.

During setup, configure a fast preflight and the full green gate:

```sh
qd config set check-command "<fast project check command>"
qd config set ci-command "<full project CI command>"
```

`qd check run` records preflight evidence without making a node mergeable. `qd ci run` or `qd ci poll` is the merge gate. Use `qd gate <node> --json` to inspect structural blockers; its `explanations[]` tell the orchestrator whether a node is blocked by dependencies, running audits, explicit manual/external/policy blockers, or P0/P1 findings. Use `qd gate <node> --phase ci --json` or `qd gate <node> --phase merge --json` when deciding whether policy allows the next lifecycle phase.

1. The orchestrator runs `qd doctor`.
2. The orchestrator inspects `qd status --json`.
3. The orchestrator inspects `qd ready --json`.
4. The orchestrator selects ready nodes and delegates them.
5. Each delegated node is claimed with `qd claim <node> --agent <name>`.
6. Implementation subagents receive `qd prompt implement <node>` and project context.
7. The orchestrator records completion with `qd complete`.
8. Audit subagents review work; the orchestrator records structured findings with `qd audit pass <node> --from-report <file>` for clean audits or `qd audit fail <node> --from-report <file>` for failed audits.
9. P0/P1 findings are resolved before CI or merge.
10. P2/P3 findings are promoted into future nodes after the current node passes.
11. Declared manual verification is signed off with `qd verification sign-off <node> --type manual --note "..." --evidence <path>`.
12. The orchestrator runs `qd check run <node>` when a fast preflight is useful.
13. The orchestrator runs `qd ci run <node>` or `qd ci poll <node>` rather than manually recording a pass when qd can observe the provider.
14. The orchestrator performs the repo's actual git/GitHub merge through the normal workflow.
15. The orchestrator records `qd merge <node> --use-existing-commit <sha>` only after qd marks the node mergeable.
16. Shared qd state is exported with `qd export --deterministic --out roadmap/spec-dag.json`; another clone restores the local cache with `qd sync --from roadmap/spec-dag.json`.

Never work a blocked node unless the user explicitly changes the DAG.
