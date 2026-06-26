# Quick DAG Orchestrator Bootstrap

Quick DAG (`qdcli`, executable `qd`) is a CLI for orchestrator-led agentic software work. It does not run agents and it is not tied to any language, framework, package manager, CI vendor, or hosting model. It gives one central orchestrator agent a durable DAG ledger for specs, dependency edges, claims, audits, findings, check/CI state, merge state, velocity, critical path, and ETA.

The intended model:

- One orchestrator agent manages the DAG and keeps its own context clean.
- The orchestrator selects ready nodes and delegates implementation/audit to subagents.
- Subagents may work in git worktrees, remote machines, or any project-specific setup.
- qd does not manage or police the execution environment.
- qd enforces the work contract: dependencies are respected, specs are completed, audits happen, P0/P1 findings are resolved, P2/P3 findings enter the DAG, and CI passes before merge.
- Main should stay green. If CI does not pass, the node does not merge.

## Install

From the project that wants to use Quick DAG, make sure the `qd` executable is available. The source repository is:

```text
https://github.com/cat-cave/qdcli
```

If `qd` is not available, follow the install instructions in that repository, then verify:

```sh
qd --version
```

## Setup In The Target Repo

Run from the repository that will use qd:

```sh
qd setup
qd agent install skills-sh
```

qd stores its working cache in `.qd/qd.db`, but that binary DB is local state. The portable source of truth is a committed JSON export:

```sh
qd export --out roadmap/spec-dag.json
qd import --from roadmap/spec-dag.json
```

Use this export/import path when moving between machines, worktrees, or remote execution hosts. Do not ask the user to commit `.qd/qd.db`.

Before creating work, configure the repository's real commands:

```sh
qd config set check-command --value "<fast local check command>"
qd config set ci-command --value "<full green command>"
qd config set merge-strategy --value "squash"
qd config get ci-command
```

Pick commands by meaning, not by tool name:

- `check_command` is a fast preflight used by `qd check run <node>`. It should catch obvious breakage before an auditor or resolver spends more time on the node. A passed check is useful evidence, but it does not make a node mergeable.
- `ci_command` is the full trusted gate used by `qd ci run <node>`. It should be the command the project relies on before merge. A passed CI run moves the node to `mergeable`; qd merge requires that latest pass by default.

The two commands may be the same for small projects. They should be different when the project has a cheap preflight and a slower complete gate.

## Validate Setup

Run:

```sh
qd doctor --json
qd status --json
qd ready --json
qd snapshot --json
```

If `qd doctor` reports config or graph errors, fix those before delegating work.

You may run qd from a subdirectory. qd resolves `--root`, then `QD_ROOT`, then the nearest ancestor `.qd/` directory.

For a multi-repo view, use workspace commands only for read-only planning:

```sh
qd workspace status --json
qd workspace ready --json
qd workspace graph --json
```

Workspace roll-up is not a distributed executor. It helps the orchestrator decide where attention is needed, then the orchestrator should enter the target repo and use normal qd commands there.

## Build The DAG

Create nodes as executable specs, not vague todos. Each node should be independently mergeable and include concrete acceptance criteria.

Useful commands:

```sh
qd node add --id <id> --title "<title>" --spec "<spec>" --acceptance "<acceptance>"
qd edge add <dependency-node> <blocked-node>
qd validate
qd graph --format mermaid
```

For existing projects, import the roadmap instead of manually adding hundreds of nodes:

```sh
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json --dry-run --json
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json
qd validate
```

Read `docs/import.md` in the qdcli repository before migrating an existing DAG. Treat import errors as graph problems to fix before orchestration. Review dry-run defaults, warnings, and dropped fields; do not assume a field was intentionally ignored unless the mapping makes that explicit.

Use registered metadata when the project has real scheduling lanes, product areas, or strict milestone ordering:

```sh
qd group register --name "runtime"
qd project register --name "web"
qd milestone register --name "baseline" --rank 10
qd node add --id <id> --title "<title>" --spec "<spec>" --acceptance "<acceptance>" \
  --group "runtime" \
  --project "web" \
  --milestone "baseline" \
  --verify type=command,value="<node-specific verification command>" \
  --audit-focus "Check the risky path and failure states."
```

Rules:

- Split by mergeable behavioral increments, not files or layers.
- Use `requires` edges only for true technical prerequisites.
- Use milestones for product phases, not dependency truth.
- Add discovery nodes when unknowns must be resolved before implementation.

## Orchestrate Work

The orchestrator loop:

```sh
qd ready --json
qd snapshot --json
qd claim <node> --agent <subagent-name>
qd prompt implement <node> --json
```

Delegate the implementation prompt and project context to a subagent. When the subagent completes work, record it:

```sh
qd complete <node> --summary "<what changed>"
```

Start audit:

```sh
qd audit start <node>
```

Record findings as structured state:

```sh
qd finding add <node> --severity P1 --title "<issue>" --evidence "<evidence>"
qd finding add <node> --from-report roadmap/audit-report.json
qd finding resolve <finding-id>
```

Use `qd finding list --open --severity P0,P1 --json` for a dashboard of active blockers across the DAG. Use `qd node show <node> --full --json` when a delegate or auditor needs the node plus findings, notes, and runs in one payload.

Severity policy:

- P0: security, data loss, build break, or critical incorrect behavior.
- P1: important regression or missing required acceptance.
- P2: non-blocking follow-up that should become a DAG node.
- P3: polish or future improvement.

P0/P1 findings block CI and merge. P2/P3 findings should be promoted into future nodes after the current node passes the gate:

```sh
qd gate <node>
qd promote-findings <node>
```

`qd promote-findings` returns the finding id and new node id for every promoted P2/P3, and the new node records where it came from. Preserve that trail when explaining why follow-up nodes exist.

## Run Checks And Merge

Normal path:

```sh
qd gate <node>
qd check run <node>
qd ci run <node>
qd merge <node>
```

For a clean happy path, `qd advance <node> --summary "<what changed>"` can run completion, gate, configured check, and configured CI in sequence. Add `--merge` only when it is correct to record qd's merge state. qd still does not perform the real git or GitHub merge.

`qd ci run` runs the configured `ci_command`, streams output, writes a log under `.qd/logs/`, records pass/fail, and moves the node to `mergeable` or `blocked`.

`qd check run` runs the configured `check_command` or the node's `check_command` override. It records a check run and log, but it does not mark the node mergeable. If the check fails, qd blocks the node.

Do not use `qd ci pass` unless recording a full CI gate that was already completed outside qd.

`qd merge` records the merge only after qd confirms:

- no open P0/P1 findings
- node is `mergeable`
- latest CI run passed, when `require_ci_before_merge = true`

`qd merge` does not perform a git merge, squash, rebase, push, or GitHub PR operation. The orchestrator should use the repo's normal merge workflow for git state, and use `qd merge` to record that the node cleared qd's gate. Keep main green; do not use qd to excuse a known-bad merge.

## Inspect Progress

Use:

```sh
qd snapshot --json
qd stats --json
qd velocity --window 7
qd critical-path
qd eta
qd milestone status --milestone "<name>"
qd view
```

These show ready work, completed points, remaining points, velocity, critical path, and ETA.

When audit context depends on branch diffs, prefer `qd diff <node> --self-only --base main` over ad hoc `main..branch` prompts. It uses the node's recorded branch and merge-base to avoid including unrelated movement from main.

## First Trial Goal

For a first adoption trial, get one real but low-risk node from ready to done:

1. create or select a ready node
2. claim it for a subagent
3. complete implementation
4. audit it
5. resolve P0/P1 findings
6. promote P2/P3 findings
7. run `qd ci run`
8. merge only after qd marks it mergeable

If the graph is wrong, fix the graph. Do not bypass the ready queue.
