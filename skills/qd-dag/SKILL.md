# qd DAG

Use qdcli when project work is too large for one agent pass and too risky to coordinate by memory. qd is not an agent runtime. It is the strict evidence ledger for one central orchestrator agent: what is ready, what is blocked, what has been proven, what has been audited, and what is safe to merge.

Read the repository's qd orchestration method before creating or advancing work. qd's method is not optional: research precedes roadmap, specs are executable contracts, completion requires evidence, audits review evidence, environment/provider/credential failures are blockers, and main stays green.

At setup and after every qd upgrade, run:

```sh
qd method show
qd method acknowledge --agent <orchestrator-name>
qd method status --json
```

Do not work around an acknowledgement failure. It means the active orchestrator
has not acknowledged the current qd method hash.

## Reality Contract

- Do not invent APIs, URLs, schemas, credentials, command output, CI status, files, or evidence.
- Do not create implementation nodes for unknown integrations. Research real product/API/data/environment behavior first, then create exact implementable nodes.
- If required real-world validation cannot run, record a typed blocker or research gap and move to unrelated ready work.
- Mock-only validation is insufficient for real integration work unless the spec explicitly targets a mock, fixture, or adapter boundary.
- Completion means ready for independent audit. It does not mean correct, merged, or safe.
- Audit means checking diff, acceptance, and evidence. CI is a separate gate, not an audit.
- P0/P1 findings block the current node. P2/P3 findings become future DAG shape or require explicit disposition.

## Setup Expectations

Configure qd for the repository's real definition of green:

```sh
qd config set check-command "<fast project check command>"
qd config set ci-command "<full trusted merge gate>"
qd config set merge-strategy "squash"
qd config get ci-command
```

Use qd templates instead of inventing report JSON:

```sh
qd template completion-report > /tmp/completion-report.json
qd template audit-report > /tmp/audit-report.json
qd template blocker-report > /tmp/blocker-report.json
```

`check_command` is a fast preflight. `ci_command` is the full trusted gate; weak CI commands make qd state dishonest. Provider polling is adapter-based. GitHub through `gh` is one adapter, not qd's worldview.

Treat `.qd/qd.db` as a local cache. Commit deterministic JSON exports:

```sh
qd export --deterministic --out roadmap/spec-dag.json
qd sync --from roadmap/spec-dag.json --dry-run --json
qd sync --from roadmap/spec-dag.json --expect-clean --json
```

## Planning Protocol

- Run `qd prompt research` before planning provider/API/database/deployment/browser/runtime work.
- Run `qd prompt plan` to create mergeable, evidence-driven nodes.
- Use milestones for externally meaningful capability phases with exit criteria and validation nodes.
- Use edges only for true technical prerequisites.
- Every implementation node needs concrete acceptance, declared verification, expected evidence, audit focus, risk, and known real-world dependencies.
- Unknown API behavior, missing credentials, unavailable data, or unclear environment state becomes research/blocker work, not a vague implementation spec.

## Orchestration Protocol

1. Run `qd doctor --json`, `qd status --json`, `qd ready --json`, and `qd snapshot --json`.
2. The orchestrator selects ready nodes; workers do not independently pop arbitrary work.
3. Claim delegated work with `qd claim <node> --agent <name> --branch <branch>`.
4. Delegate `qd prompt implement <node> --json` plus project rules.
5. If implementation cannot validate required reality, block/split/research the node instead of completing it.
6. Record completion only with structured evidence for the acceptance criteria.
7. Start independent audit. Use `qd prompt audit <node>`; auditors inspect diff, acceptance, and evidence.
8. Missing required evidence, unreachable required API/provider/environment, or unverified acceptance is P1 unless the spec explicitly excludes that surface.
9. Resolve P0/P1 findings before check/CI. Promote or dispose P2/P3 findings before merge.
10. Run `qd gate <node> --phase ci --json`, `qd check run <node>`, then `qd ci run <node>` or `qd ci poll <node>`.
11. Perform the real repository merge through the repo workflow, then record `qd merge <node> --use-existing-commit <sha>`.

Never bypass the ready queue. If the graph is wrong, fix the graph.

## Periodic Reality Checks

- After about 10 merged nodes, run `qd prompt repo-audit` and add every real finding to qd.
- After about 30 merged nodes, run `qd prompt dag-review` or `qd prompt reality-check` and revise the roadmap.
- Run an immediate reality check after any major API, provider, schema, credential, environment, CI, deployment, or product assumption fails.
