# Schema

qd stores local cache state in `.qd/qd.db`. Do not commit the binary DB.

The portable, committed source of truth is the qd JSON export:

```sh
qd export --out roadmap/spec-dag.json
```

That export has `schema_version`, `exported_at`, `registries`, `nodes`, `edges`, `findings`, `runs`, and `node_notes`. A fresh clone can rebuild its local DB cache with:

```sh
qd setup --no-hooks
qd import --from roadmap/spec-dag.json
```

## Nodes

Nodes are executable specs. They include title, kind, typed milestone, group, projects, status, priority, estimate, risk, branch, spec, acceptance, validation text, typed verification entries, audit focus guidance, context, status reason, per-node check override, and timestamps.

If groups, projects, or milestones have been registered, qd validates node values against those registries. This lets a project define strict scheduling lanes, product areas, and milestone ranks without hard-coding one universal taxonomy.

Minimal one-node JSON for `qd node add --from-json <file>`:

```json
{
  "id": "docs-audit",
  "title": "Audit documentation setup path",
  "kind": "docs",
  "status": "ready",
  "priority": "P2",
  "risk": "low",
  "estimatePoints": 1,
  "spec": "Review setup docs for a first-time adopter.",
  "acceptance": "The docs explain install, setup, checks, CI, and first node orchestration.",
  "verification": [{ "type": "manual", "value": "Read README and docs/setup.md end to end." }],
  "auditFocus": [
    "Look for language-specific assumptions.",
    "Check qd merge semantics are explicit."
  ]
}
```

Bulk mint plan for `qd nodes add-bulk --from-json <file>`:

```json
{
  "nodes": [
    {
      "id": "core-setup",
      "title": "Initialize qd setup",
      "spec": "Configure qd for this repository.",
      "acceptance": "qd doctor passes after check and CI commands are configured."
    },
    {
      "id": "first-feature",
      "title": "Implement first feature",
      "spec": "Deliver the first scoped feature.",
      "acceptance": "The feature passes the configured CI gate."
    }
  ],
  "edges": [{ "from": "core-setup", "to": "first-feature", "type": "requires" }]
}
```

## Edges

Edges connect nodes. Only `requires` edges participate in readiness.

## Runs

Runs record implementation, audit, resolve, CI, and merge lifecycle events.

`qd check run <node>` runs the configured `check_command` or the node's `check_command` override, writes a log under `.qd/logs/`, and records a check run. A passed check does not make the node mergeable.

`qd ci run <node>` runs the configured `ci_command`, writes a log under `.qd/logs/`, records a pass/fail run, and updates the node to `mergeable` or `blocked`.

`qd merge <node>` records qd state only. It does not run `git merge`, open a pull request, squash commits, or push anything. Repositories should perform the actual git/GitHub merge through their normal workflow and use `qd merge` to record that the node satisfied qd's gate.

## Findings

Findings belong to a node and can be P0, P1, P2, or P3.

- P0/P1 block the gate.
- P2/P3 can be promoted into future nodes after the gate passes.

Structured audit reports can be imported with `qd finding add --from-report <file>`. The report must contain `nodeId` or `node_id` unless the node id is passed positionally, plus a `findings` array with severity, title, evidence, and optional path, line, expected, and suggested fix fields.

Minimal audit report:

```json
{
  "nodeId": "first-feature",
  "findings": [
    {
      "severity": "P1",
      "title": "Acceptance criterion is not implemented",
      "evidence": "The required behavior is absent from the tested workflow.",
      "expected": "The acceptance criterion passes under the configured check command.",
      "suggestedFix": "Implement the missing behavior and rerun qd gate."
    },
    {
      "severity": "P2",
      "title": "Add a regression test",
      "evidence": "The behavior works manually but lacks automated coverage.",
      "suggested_fix": "Promote this into a follow-up test node."
    }
  ]
}
```

## Enums

### NodeKind

- `feature`: user-visible or project-visible behavior.
- `fix`: correction to existing behavior.
- `refactor`: internal change that should preserve behavior.
- `test`: test coverage or test infrastructure.
- `docs`: documentation-only work.
- `infra`: build, CI, tooling, deployment, or repo plumbing.
- `audit-fix`: follow-up work promoted from an audit finding.

### NodeStatus

- `draft`: not ready for orchestration.
- `ready`: dependencies are expected to be satisfiable; ready queue may include it.
- `claimed`: selected by the orchestrator and assigned to an implementer.
- `working`: implementation is in progress.
- `review`: implementation completed and awaiting audit.
- `fixing`: P0/P1 finding resolution is in progress.
- `ci`: full CI gate is running or expected next.
- `mergeable`: latest CI gate passed and qd can record merge after final checks.
- `done`: qd has recorded the node as merged/done.
- `regressed`: previously completed or assumed-good work was reopened by a later audit or regression.
- `blocked`: blocked by failed check/CI or unresolved project state.
- `cancelled`: intentionally abandoned.

### Priority

- `P0`: critical issue such as security, data loss, build break, or severe wrong behavior.
- `P1`: important regression or missing required acceptance.
- `P2`: non-blocking follow-up that should become planned work.
- `P3`: polish, cleanup, or future improvement.

### Risk

- `low`: localized, routine, or easily reversible.
- `medium`: meaningful behavior or integration risk.
- `high`: broad blast radius, migration risk, security-sensitive, data-sensitive, or hard to validate.

### EdgeType

- `requires`: `from_node` must be `done` before `to_node` is ready.
- `unblocks`: informational scheduling edge; does not affect readiness.
- `supersedes`: one node replaces another.
- `related`: informational relationship.

Only `requires` participates in ready-queue and cycle validation.

### VerificationType

- `command`: executable verification command.
- `manual`: human or agent manual verification.
- `url`: external page, dashboard, PR, issue, or artifact to inspect.
- `note`: textual verification instruction.

### FindingStatus

- `open`: unresolved finding.
- `resolved`: fixed or otherwise closed.
- `promoted`: converted into future DAG work.
- `dismissed`: intentionally not acted on.

### RunKind

- `implement`: implementation work.
- `audit`: audit/review work.
- `resolve`: P0/P1 finding resolution work.
- `check`: fast preflight command run.
- `ci`: full trusted gate run.
- `merge`: qd merge-state record.
