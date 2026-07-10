# Agent Protocol

qd is designed for one central orchestrator agent. The orchestrator manages the DAG, keeps its own context clean, and delegates implementation and audit work to subagents. Subagents may work in git worktrees, remote machines, or any other project-specific environment. qd does not manage that execution layer.

qd is the authoritative DAG ledger and quality gate. It works best when the repo has one canonical command that means "green enough to merge", and when main is kept green after every merge.

The qd method is mandatory for orchestrators. Read `docs/orchestration.md` or
`qd help method` before planning or advancing work. qd expects research before
roadmap, executable specs, evidence-backed completion, independent audits,
typed blockers for environment/provider/credential/data failures, and green main.

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
7. If implementation cannot validate required real-world behavior, the orchestrator blocks, splits, or revises the node instead of completing it.
8. The orchestrator records completion only with evidence for the node's acceptance criteria.
9. Audit subagents review diff, acceptance, and evidence; the orchestrator records structured findings with `qd audit pass <node> --from-report <file>` for clean audits or `qd audit fail <node> --from-report <file>` for failed audits.
10. Missing required evidence, unreachable required APIs/providers/environments, or unverified acceptance is P1 unless the spec explicitly excludes that surface.
11. P0/P1 findings are resolved before CI or merge.
12. P2/P3 findings are promoted into future nodes after the current node passes.
13. Declared verification is inspected with `qd verification list <node>` and signed off by exact index with `qd verification sign-off <node> --index <n> --note "..." --evidence <path>`.
14. The orchestrator runs `qd check run <node>` when a fast preflight is useful.
15. For linked GitHub PRs, the orchestrator uses `qd ci status|watch`, `qd monitor`, or `qd sync-prs`; branch-rule-required checks are observed rather than manually asserted.
16. The orchestrator uses `qd ready --mergeable` to select a bounded wave and `qd queue enqueue --all-ready --wave <wave-id> --limit <n> --concurrency <n>` to admit parallel PRs without serial polling.
17. `qd queue drain` reconciles queue-produced commits. Ejected nodes return to `fixing`; `qd queue bisect <node>` supplies deterministic, point-balanced failure cohorts instead of guessing which concurrent PR caused a merge-group regression.
18. For a single linked PR, `qd merge <node> --via-pr` either integrates directly or enqueues, depending on branch policy. For non-PR integrations, the orchestrator records `qd merge <node> --use-existing-commit <sha>` only after qd marks the node mergeable.
19. Shared qd state is exported with `qd export --deterministic --out roadmap/spec-dag.json`; another clone restores the local cache with `qd sync --from roadmap/spec-dag.json`.

After about 10 merged nodes, run a repo-wide audit and add every real finding to
qd. After about 30 merged nodes, run a DAG reality review and revise milestones,
dependencies, blockers, or specs that no longer match reality.

Never work a blocked node unless the user explicitly changes the DAG.
