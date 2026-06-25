# qd DAG

Use qdcli to coordinate agent work through a durable DAG. qd is not an agent runtime; it is the source of truth for task readiness, claims, audits, findings, CI state, and merge state.

## Protocol

1. Run `qd doctor`, `qd status --json`, and `qd ready --json`.
2. Claim exactly one ready node with `qd claim <id> --agent <name>`.
3. Read scoped context with `qd prompt implement <id>`.
4. Implement only the node's spec and acceptance criteria.
5. Record completion with `qd complete <id> --summary "..."`.
6. Audit with `qd audit start <id>` and structured `qd finding add` commands.
7. Treat open P0/P1 findings as blockers. Resolve them before CI or merge.
8. Promote P2/P3 findings with `qd promote-findings <id>` after the gate passes.
9. Use `qd gate <id>`, `qd ci pass <id>`, and `qd merge <id>` to advance the lifecycle.

## DAG Quality

- Nodes must be independently mergeable.
- Edges must represent real prerequisites.
- Acceptance criteria must be checkable.
- Use JSON output for parsing.
- Never bypass the ready queue.

