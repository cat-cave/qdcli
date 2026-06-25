# Agent Protocol

Agents should treat qd as the authoritative project DAG and quality gate. qd works best when the repo has one canonical command that means "green enough to merge".

During setup, configure that command:

```sh
qd config set check-command --value "nix develop -c just ci"
qd config set ci-command --value "nix develop -c just ci"
```

Use the project's equivalent if it is not Nix.

1. Run `qd doctor`.
2. Inspect `qd status --json`.
3. Inspect `qd ready --json`.
4. Claim exactly one ready node.
5. Read `qd prompt implement <node>`.
6. Implement only the node's spec and acceptance criteria.
7. Record completion with `qd complete`.
8. Audit with structured findings.
9. Resolve P0/P1 findings before CI or merge.
10. Run `qd ci run <node>` rather than manually recording a pass.
11. Promote P2/P3 findings into future nodes after the gate passes.

Never work a blocked node unless the user explicitly changes the DAG.
