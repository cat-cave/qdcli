# Quick DAG Orchestrator Bootstrap

Quick DAG (`qdcli`, executable `qd`) is a CLI for orchestrator-led agentic software work. It does not run agents and it is not tied to any language, framework, package manager, CI vendor, or hosting model. It gives one central orchestrator agent a durable DAG ledger for specs, dependency edges, claims, audits, findings, check/CI state, merge state, velocity, critical path, and ETA.

The intended model:

- One orchestrator agent manages the DAG and keeps its own context clean.
- The orchestrator selects ready nodes and delegates implementation/audit to subagents.
- Subagents may work in git worktrees, remote machines, or any project-specific setup.
- qd does not manage or police the execution environment.
- qd enforces the work contract: dependencies are respected, specs are completed, audits happen, P0/P1 findings are resolved, P2/P3 findings enter the DAG, and CI passes before merge.
- Main should stay green. If CI does not pass, the node does not merge.

Before creating or advancing work, read the qd method:

```sh
qd help method
qd help reality
qd method show
```

If this repository includes the qdcli docs, also read `docs/orchestration.md`.
The method is part of the contract, not optional background: research precedes
roadmap, specs are executable contracts, completion requires evidence, audits
review evidence, environment/provider/credential failures are blockers, and main
stays green.

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
qd method show
qd method acknowledge --agent <orchestrator-name>
```

qd stores its working cache in `.qd/qd.db`, but that binary DB is local state. The portable source of truth is a committed JSON export.

Mutation commands that create roadmap state or record evidence refuse to run
until the current method hash is acknowledged. After upgrading qd, reread
`qd method show` and run `qd method acknowledge` again.

For a new qd DAG, start empty and export when state should be shared:

```sh
qd export --out roadmap/spec-dag.json
```

For another clone, worktree, or remote execution host that already has a committed qd export, rebuild the local cache with sync:

```sh
qd sync --from roadmap/spec-dag.json --dry-run --json
qd sync --from roadmap/spec-dag.json --dry-run --write-diff roadmap/sync-diff.json --json
qd sync --from roadmap/spec-dag.json
```

Use `qd import` for migration from non-qd roadmap formats or for bootstrapping an empty qd DAG. Use `qd sync` for replacing the local cache from committed qd JSON. Treat changed, live-only, and export-only nodes from dry-run output as reviewable migration output. Use `qd sync --expect-clean --from roadmap/spec-dag.json --json` before orchestration when the local cache must already match the committed JSON; if it fails, stop and inspect the drift instead of starting work from ambiguous state. Do not ask the user to commit `.qd/qd.db`. After qd mutations that should be shared, export and commit the JSON snapshot:

```sh
qd export --deterministic --out roadmap/spec-dag.json
git add roadmap/spec-dag.json
git commit -m "Update qd DAG"
```

Before creating work, configure the repository's real commands:

```sh
qd config set check-command "<fast local check command>"
qd config set ci-command "<full green command>"
qd config set merge-strategy "squash"
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
qd doctor --strict --json
qd status --json
qd ready --json
qd snapshot --json
```

If `qd doctor` reports stale schema, run `qd migrate --json` and rerun doctor
before any normal DAG command. If `qd doctor` reports config or graph errors,
fix those before delegating work. Before real orchestration, use
`qd doctor --strict` and treat warnings such as unregistered metadata or
incomplete blocker records as work to fix, not optional noise.

You may run qd from a subdirectory. qd resolves `--root`, then `QD_ROOT`, then the nearest ancestor `.qd/` directory.

For a multi-repo view, use workspace commands only for read-only planning:

```sh
qd workspace status --json
qd workspace ready --json
qd workspace graph --json
```

Workspace roll-up is not a distributed executor. It helps the orchestrator decide where attention is needed, then the orchestrator should enter the target repo and use normal qd commands there.

## Build The DAG

Create nodes as executable specs, not vague todos. Each node should be
independently mergeable and include concrete acceptance criteria, declared
verification, expected evidence, audit focus, risk, and known real-world
dependencies.

Research comes before roadmap shape. Do not create implementation nodes for an
unknown integration, provider, API, database, deployment target, browser/runtime
surface, credential model, or data source. First run:

```sh
qd prompt research
```

Research output should identify the real URLs, SDK calls, schemas, credentials,
fixture provenance, response examples, failure modes, and environment
requirements. If those facts cannot be verified, create research/blocker nodes.
Do not write a node such as "figure out Stripe integration" and pretend it is
implementation work.

Useful commands:

```sh
qd node add --from-json roadmap/nodes/<id>.json
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

Read `docs/import.md` in the qdcli repository before migrating an existing DAG. Treat import errors as graph problems to fix before orchestration. Review dry-run defaults, warnings, and dropped fields; do not assume a field was intentionally ignored unless the mapping makes that explicit. Import and bulk minting are transactional; if qd rejects the plan, fix the plan and retry rather than cleaning up partial state.

Use registered metadata when the project has real scheduling lanes, product areas, or strict milestone ordering:

```sh
qd group register --name "runtime"
qd project register --name "web"
qd milestone register --name "baseline" --rank 10
qd nodes add-bulk --from-json roadmap/mint-plan.json
```

Rules:

- Split by mergeable behavioral increments, not files or layers.
- Use `requires` edges only for true technical prerequisites.
- Use milestones for externally meaningful capability phases, not dependency truth.
- Give milestones entry criteria, exit criteria, and validation nodes.
- Add research/blocker nodes when unknowns must be resolved before implementation.
- Treat warnings, known failures, and "pre-existing" failures as work or blockers unless they are explicitly accepted with rationale.

## Orchestrate Work

The orchestrator loop:

```sh
qd ready --json
qd snapshot --json
qd claim <node> --agent <subagent-name>
qd prompt implement <node> --json
```

The orchestrator owns node selection. Subagents should not independently pop arbitrary ready work unless the user intentionally designs a distributed execution harness around qd's ownership records. In the normal workflow, the orchestrator chooses a bounded set of ready nodes, delegates those specs, then records results. Delegate the implementation prompt and project context to a subagent.

Completion is not a status assertion. It is an evidence-backed handoff to audit.
The implementer must show what changed, which acceptance criteria were exercised,
which real APIs/services/providers/databases/browsers/deployment targets were
used, which commands ran, and where the logs/artifacts live. If required
validation cannot run, block, split, or revise the node instead of completing
it.

When delegation needs durable ownership records, use assignments. Assignment owners are opaque strings; examples may be `human:trevor`, `external:worker-1`, `github-actions:<run-id>`, or any other harness-owned identifier. qd records ownership and evidence, but it does not launch or control that worker.

```sh
qd assignment add <node> --role worker --owner external:worker-1 --branch worker/<node> --worktree /scratch/worktrees/<repo>-worker-<node>
qd assignment complete <assignment-id> --summary "<what changed>" --commit <sha> --evidence <path-or-url>
qd assignment list --status open --json
```

Use waves when the orchestrator is dispatching batches and needs an audit cadence that survives chat context:

```sh
qd wave start --kind implementation --summary "<wave goal>"
qd wave add-node <wave-id> <node>
qd wave add-assignment <wave-id> <assignment-id>
qd wave complete <wave-id> --summary "<what landed>"
qd wave status --json
```

If a node is blocked by a manual, external, policy, environment, credential,
provider, or data condition, record that explicitly instead of leaving it in the
ready queue:

```sh
qd block <node> \
  --type credential \
  --reason "<specific blocker>" \
  --owner "<owner>" \
  --needed "<exact action needed to unblock>" \
  --evidence "<path-or-proof>"
qd unblock <node> \
  --summary "<what changed so work is valid again>" \
  --evidence "<path-or-proof>"
```

Blocked nodes are not ready work, even when dependencies are complete. Do not use blocker metadata for dependency truth; use `requires` edges for that. If the blocker is a no-go policy, physical-presence requirement, external dependency, owner decision, missing credential, bad URL, unavailable provider, or absent data source, keep it blocked until that condition changes. Unblock only with evidence that the condition is gone. `qd gate <node> --json` reports `nodeBlocked` with the blocker type, reason, and owner so the orchestrator can stop instead of trying to advance it.

Start audit only after implementation evidence exists:

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
- P1: important regression, missing required acceptance, missing required real-world validation, or environment/provider/credential issue that prevents required validation.
- P2: non-blocking follow-up that should become a DAG node.
- P3: polish or future improvement.

An audit is independent evidence review. It is not CI and it is not a summary
rewrite. The auditor must inspect the diff, the spec, every acceptance
criterion, completion evidence, verification logs, real API responses or
fixtures when relevant, mock/stub boundaries, failure paths, and regression
risk. A clean audit that did not inspect required evidence is not clean.

P0/P1 findings block CI and merge. P2/P3 findings should be promoted into future nodes after the current node passes the gate:

```sh
qd gate <node> --json
qd promote-findings <node>
```

Read `qd gate`'s `explanations[]`; it distinguishes open P0/P1 findings, running audits, explicit node blockers, and incomplete dependencies. Use `qd gate <node> --phase ci --json` before CI and `qd gate <node> --phase merge --json` before merge when you need policy included in `ok`. `qd promote-findings` returns the finding id and new node id for every promoted P2/P3, and the new node records where it came from. Use `qd finding promote <finding>` for a single finding, or `qd finding dispose <finding> --disposition accepted-risk --rationale "<why>"` when the project intentionally accepts the risk. Preserve that trail when explaining why follow-up nodes exist.

Before advancing to CI or merge, ask qd for the policy view instead of guessing:

```sh
qd policy evaluate <node> --phase ci --json
qd policy evaluate <node> --phase merge --json
```

Treat policy violations as the next piece of work, not optional advice. The default policy encodes qd's intended workflow: a passed audit before CI, declared verification evidence before CI, P2/P3 disposition before merge, and a real merge commit recorded after the repository merge. If a project intentionally relaxes a policy, record why in project setup notes so future orchestrators do not infer the wrong standard.

If the project uses worktrees, use qd's helper to make the branch/path/env convention repeatable:

```sh
qd worktree create <node> --branch spec/<node>
qd worktree env <node> --env-template .env.example --env QD_CACHE=/tmp/qd-cache
qd worktree status <node> --base main --json
```

Do not put secrets in qd notes, node specs, findings, or exports. Worktree env injection writes files in the worktree and reports the file path; qd does not store env values in the DAG. Re-running `qd worktree env` replaces qd's marked context block instead of appending duplicate variables.

## Run Checks And Merge

Normal path:

```sh
qd gate <node> --phase ci --json
qd check run <node>
qd ci run <node>
# perform the repository's real merge, then record it
qd merge <node> --use-existing-commit <sha>
```

Lifecycle shortcuts are only safe when they record the same evidence-backed state
as the explicit commands. Add `--merge --use-existing-commit <sha>` only after
the real repository merge has happened and it is correct to record qd's merge
state. qd still does not perform the real git or GitHub merge.

`qd ci run` runs the configured `ci_command`, streams output, writes a log under `.qd/logs/`, records pass/fail, and moves the node to `mergeable` or `blocked`.

`qd check run` runs the configured `check_command` or the node's `check_command` override. `qd ci run` uses the node's `ci_command` override when present, otherwise the configured `ci_command`. Checks record a run and log, but only CI marks a node mergeable.

Do not record an external CI pass unless the full trusted gate already completed outside qd. Use `qd ci record-pass <node> --summary "..." --url <ci-url>` or another evidence flag.

When a supported provider adapter is configured, use qd to wait for external CI instead of hand-written polling:

```sh
qd config set ci-provider github --repo owner/name --workflow ci.yml --auth gh-cli
qd ci poll <node> --sha <commit>
```

The GitHub adapter shells out to `gh`. Other providers should be added as adapters, not as assumptions baked into the DAG model. If no adapter exists, use explicit evidence with `qd ci record-pass` or run the trusted command through `qd ci run`.

For manual verification gates declared on a node, record the signoff:

```sh
qd verification sign-off <node> --type manual --note "<what was checked>" --evidence <path-or-url>
```

For clean structured audits, prefer the composite:

```sh
qd audit pass <node> --from-report <audit-report.json>
```

It imports findings, fails on open P0/P1 findings, and promotes P2/P3 findings when the current node is clean.

`qd merge` records the merge only after qd confirms:

- no open P0/P1 findings
- node is `mergeable`
- latest CI run passed, when `require_ci_before_merge = true`

`qd merge` does not perform a git merge, squash, rebase, push, or GitHub PR operation. The orchestrator should use the repo's normal merge workflow for git state, and use `qd merge` to record that the node cleared qd's gate. In direct-to-main workflows, run `qd merge <node> --use-existing-commit <sha>` after the real merge so qd can record the commit it represents. Keep main green; do not use qd to excuse a known-bad merge.

## Inspect Progress

Use:

```sh
qd snapshot --json
qd stats --json
qd velocity --window 7
qd critical-path
qd eta
qd milestone status --milestone "<name>"
qd export --status ready,claimed,review --milestone "<name>" --json
qd view
```

These show ready work, completed points, remaining points, velocity, critical path, and ETA.

`qd view` serves the embedded read-only dashboard from the installed CLI. Use it for human inspection, but keep all state changes in CLI commands so the DAG remains auditable.

Run periodic reality checks as part of normal orchestration:

```sh
qd prompt repo-audit
qd prompt dag-review
qd prompt reality-check
```

After about 10 merged nodes, run a general repo audit and add every real finding
to qd. After about 30 merged nodes, review the DAG and milestone plan itself.
Run an immediate reality check after any major API, provider, schema,
credential, environment, CI, deployment, or product assumption fails. A reality
check that does not inspect real evidence is just another rubber stamp.

When audit context depends on branch diffs, prefer `qd diff <node> --self-only --base main` over ad hoc `main..branch` prompts. It uses the node's recorded branch and merge-base to avoid including unrelated movement from main. For uncommitted worktree changes, use `qd diff <node> --working`.

If the project has installed semantic diff tooling, use it explicitly in the audit handoff:

```sh
qd diff <node> --self-only --base main --tool sem --format markdown
qd prompt audit <node> --diff-tool sem
```

`sem` is a good fit for entity-level changed-function context. `inspect` can be useful for review triage when installed and configured, especially on large changes. Treat both as optional adapters. qd should fail loudly if a requested adapter is missing; do not silently replace semantic audit context with a plain diff and pretend the requested review happened.

## First Trial Goal

For a first adoption trial, get one real but low-risk node from ready to done:

1. create or select a ready node
2. claim it for a subagent
3. complete implementation with evidence
4. audit diff, acceptance, and evidence
5. resolve P0/P1 findings
6. promote P2/P3 findings
7. run `qd ci run`
8. merge only after qd marks it mergeable

If the graph is wrong, fix the graph. Do not bypass the ready queue.
