# CLI Reference

Global root selection:

- `qd --root <repo> <command>`
- `QD_ROOT=/path/to/repo qd <command>`

If neither is set, qd uses the nearest ancestor `.qd/` directory. If no ancestor exists, it uses the current working directory.

## Core

- `qd init`
- `qd setup`
- `qd method show|status|acknowledge [--agent <name>]`
- `qd migrate`
- `qd doctor [node] [--strict] [--json]`
- `qd status [--json] [--fields nodes,ready,blocked]`
- `qd stats [--json] [--window 7] [--milestone <name>]`
- `qd snapshot [--json] [--milestone <name>]`
- `qd ready [--json] [--fields id,title,priority,status] [--limit 50] [--compact|--tsv|--full]`
- `qd ready --mergeable [--json]`
- `qd monitor [--json]`
- `qd sync-prs [--rebase] [--json]`
- `qd queue status [node] [--json]`
- `qd queue enqueue <node> [--json]`
- `qd queue enqueue --all-ready [--wave <id>] [--limit <n>] [--concurrency <n>] [--json]`
- `qd queue sync [node] [--json]`
- `qd queue watch|drain [node] [--interval <seconds>] [--timeout <seconds>] [--json]`
- `qd queue bisect|cohort <node> [--merge-group <sha>] [--json]`
- `qd graph --format table|json|mermaid|dot`
- `qd validate [--json]`
- `qd export [--out <json>|-] [--deterministic] [--status ready,claimed] [--milestone <name>]`
- `qd export --fields id,title,priority,status [--json|--tsv|--compact]`
- `qd import --from <json> [--schema-mapping <json>] [--adapter roadmap-html|markdown-checklist] [--dry-run] [--verbose] [--allow-defaults] [--replace]`
- `qd sync --from <qd-export.json> [--dry-run] [--expect-clean] [--write-diff <json>]`
- `qd velocity [--window 7]`
- `qd critical-path [--milestone <name>]`
- `qd eta [--window 7] [--milestone <name>]`
- `qd milestone status <name>`
- `qd milestone remaining <name> [--json] [--fields id,title,status]`
- `qd milestone blockers <name> [--json]`
- `qd milestone critical-path <name> [--json]`
- `qd milestone next <name> [--limit 10] [--json]`
- `qd config show [--json]`
- `qd config get <key>`
- `qd config set check-command <command>`
- `qd config set ci-command <command>`
- `qd prompt plan|research|implement|audit|resolve|reality-check|repo-audit|dag-review [node] [--json]`
- `qd template completion-report|audit-report|reconciliation-report|verification-signoff-report|blocker-report|unblock-report|research-report|reality-check|spec|milestone|finding`
- `qd schema print <name>`
- `qd schema example <name>`
- `qd workspace status|ready|graph [--json] [--config <toml>] [--repo <path>]`
- `qd advance <node> --from-report <completion-report.json> [--merge --use-existing-commit <sha>]`
- `qd reconcile <node> --commit <sha> --from-report <reconciliation-report.json>`
- `qd diff <node> [--base main] [--self-only] [--working] [--tool git|sem|inspect] [--format markdown|json|plain]`

Config read/write round trip:

```sh
qd config set ci-command "<full project CI command>"
qd config get ci-command
```

For agent-facing JSON output, see [JSON Contract](./json.md).

## GitHub Pull Requests

Configure the existing GitHub adapter, then link PR identity explicitly or let qd resolve the node branch:

```sh
qd config set ci-provider github --repo owner/repo --auth gh-cli
qd config set merge-queue-mode auto
qd claim <node> --agent <name> --branch spec/<node> --pr <number-or-url>
qd node set-pr <node> <number-or-url>
```

`qd ci status <node>` reads the target branch's applied ruleset or classic protection, then evaluates exactly those required contexts on the PR head. An always-present successful required check is accepted without trying to model its internal path conditions. It reports pass, fail, pending, queued, missing, or no-checks; PR mergeability; and the exact behind count. `qd ci watch <node>` waits for a terminal aggregate result. `qd ci status --all` and `qd monitor` show every in-flight node in one dashboard.

`qd sync-prs` refreshes all in-flight PRs and records a structured GitHub CI pass only when required checks are concluded-success and qd's audit/verification policy is satisfied. Add `--rebase` to request `gh pr update-branch --rebase` for stale branches. When the target has a merge queue, speculative merge-group builds own freshness, so qd reports drift without rebasing or blocking queue eligibility.

`qd ready --mergeable` shows linked nodes that are ledger-mergeable, green, conflict-free, and ready either for direct merge or queue entry. `qd merge <node> --via-pr` directly merges when no queue is active. With a native queue it enables auto-merge with head-SHA protection and moves the ledger to `queued`; GitHub later chooses the merge SHA.

`qd queue sync` reconciles queued PRs. A merged PR moves to `done` with GitHub's merge commit; a queue ejection moves to `fixing` and preserves merge-group SHA and failure reason. `qd queue drain` repeats reconciliation for only the wave that was queued when it started. `qd monitor` exposes queue membership, position, entry state, merge-group SHA, and merge-group checks separately from PR-head checks. `qd queue bisect` groups every node sharing a failed merge-group SHA into deterministic, point-balanced halves for an orchestrator to re-enqueue and isolate.

`qd policy evaluate <node> --phase merge` includes stable queue codes: `not-enqueued`, `queued`, `ejected-from-queue`, `merge-group-check-failed`, and `queue-required-check-missing`. `merge_queue_mode` is `auto` by default; use `required` to reject non-queue integration or `off` for repositories without a native queue. `ci_workflow` remains available only for legacy workflow polling. The existing `--use-existing-commit` mode never runs git or GitHub operations.

## Method and Templates

qd mutating commands require the active orchestrator to acknowledge the current
method hash first:

```sh
qd method show
qd method acknowledge --agent codex
qd method status --json
```

This writes `.qd/method-acknowledgement.json`. After a qd upgrade changes the
method hash, mutation commands fail until the orchestrator rereads and
acknowledges the method again.

Use templates when authoring structured qd reports:

```sh
qd template completion-report > /tmp/completion-report.json
qd template audit-report > /tmp/audit-report.json
qd schema example blocker-report
qd schema print completion-report
```

Templates are valid starting points, not evidence. The orchestrator must edit
node ids, evidence paths, command logs, real-world validation, and findings to
match the actual work before recording state.

## Migration

Run `qd migrate` after upgrading qd when `qd doctor` reports that the local DB schema is older than the current binary:

```sh
qd doctor --json
qd migrate --json
qd doctor --json
```

`qd migrate` applies pending qd DB migrations in place. It is not a DAG import and it does not replace `.qd/qd.db` from JSON. Use it before normal commands when a stale local cache would otherwise report `DB schema is older than this qd binary`.

## Import

Use `qd export` for qd-native shared state:

```sh
qd export --deterministic
qd sync --from roadmap/spec-dag.json --dry-run --json
qd sync --from roadmap/spec-dag.json --dry-run --write-diff roadmap/sync-diff.json --json
qd sync --from roadmap/spec-dag.json
```

The exported JSON is the committed source of truth for sharing qd state across machines. `.qd/qd.db` remains a local rebuildable cache and should stay gitignored.

qd-native exports include registries, nodes, edges, findings, runs, and node notes. They sync without a mapping file.

`qd export` writes `roadmap/spec-dag.json` by default; add `--deterministic` for a committed stable snapshot and use `--out -` for explicit stdout. Use `qd sync --from <qd-export.json> --dry-run --json` to validate the canonical export and inspect live-only, export-only, and changed nodes before replacing the local cache. Add `--write-diff <json>` when an orchestrator should leave a reviewable drift artifact. Add `--expect-clean` in automation when the local cache must already match the committed JSON. Use `qd import --replace` only for authoritative replacement from a non-qd or mapped import source; deprecated `--merge` is a compatibility alias. Plain `qd import` remains empty-DAG-only.

Use `qd import` for existing DAGs:

```sh
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json --dry-run --json
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json --dry-run --verbose
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json
```

The import path is strict and transactional: unknown statuses require `statusMap`, malformed arrays fail, required fields must resolve, dependency arrays can create edges, and qd checks duplicate ids, missing edge endpoints, and `requires` cycles before writing. Bulk imports and bulk mints auto-register referenced groups, projects, and milestones so later validation is consistent. Non-dry-run imports fail if mapped nodes need defaulted fields unless `--allow-defaults` is passed intentionally.

Reference adapters normalize common roadmap formats into qd's canonical import JSON:

```sh
qd import --from docs/ROADMAP.html --adapter roadmap-html --dry-run --json
qd import --from roadmap.md --adapter markdown-checklist --dry-run --json
```

Adapters are intentionally small. For project-specific roadmap formats, write a project-local normalizer that emits `{ "nodes": [...], "edges": [...] }`, then import that JSON with qd's strict importer.

See [Importing An Existing DAG](./import.md) for the full `ImportMapping` schema.

## DAG

- `qd group register --name <name>`
- `qd project register --name <name>`
- `qd milestone register --name <name> --rank <number>`
- `qd node add --from-json <node.json>`
- `qd node add --title <text> --spec-file <path> --acceptance-file <path>`
- `qd nodes add-bulk --from-json <plan.json>`
- `qd node add ... --group <name> --project <name> --project <name>`
- `qd node add ... --milestone <name> --verify type=command,value="just ci" --audit-focus <text>`
- `qd node list`
- `qd node list --milestone alpha --status ready,claimed --fields priority,status,id,title`
- `qd node list --project web --priority P0,P1 --status ready --json`
- `qd node show <id>`
- `qd node show <id> --full`
- `qd node show <id> --include findings,notes,audits,runs`
- `qd node edit <id> [--title] [--spec] [--acceptance]`
- `qd node edit <id> --from-json <patch.json>`
- `qd node edit <id> --spec-file <path> --acceptance-file <path>`
- `qd node edit <id> --branch <branch>`
- `qd block <id> --type environment|credential|provider|data|manual|policy|external-dependency --reason <text> --owner <name> --needed <text> --evidence <path-or-proof>`
- `qd block <id> --from-report <blocker-report.json>`
- `qd unblock <id> --summary <text> --evidence <path-or-proof>`
- `qd unblock <id> --from-report <unblock-report.json>`
- `qd node note <id> --text <text>`
- `qd node note <id> --mode list`
- `qd note add <id> --text <text>`
- `qd note list <id>`
- `qd edge add <from> <to> [--type requires]`
- `qd claim [node] --agent <name> [--branch <branch>]`
- `qd complete <node> --from-report <completion-report.json>`
- `qd assignment add <node> --role worker --owner external:<id> [--branch <branch>] [--worktree <path>] [--scope <text>]`
- `qd assignment add --from-json <assignment.json>`
- `qd assignment complete <assignment> --summary <text> [--commit <sha>] [--evidence <path>]`
- `qd assignment complete <assignment> --from-json <result.json>`
- `qd assignment list [--node <node>] [--status open|complete|failed|cancelled]`
- `qd wave start --kind implementation --summary <text>`
- `qd wave add-node <wave> <node>`
- `qd wave add-assignment <wave> <assignment>`
- `qd wave complete <wave> --summary <text>`
- `qd wave status [--json]`

## Policies

qd has first-class lifecycle policy checks. Use them to make the intended workflow executable instead of relying on chat memory:

```sh
qd policy evaluate <node> --phase ci --json
qd policy evaluate <node> --phase merge --json
```

Default policy is intentionally strict:

- a passed audit is required before CI
- declared verification entries must have passed evidence before CI
- open P2/P3 findings must be promoted, resolved, or dismissed before merge
- merge recording requires the real merge commit SHA

Configure policy with:

```sh
qd config get policy --json
qd config set policy-require-audit-before-ci true
qd config set policy-require-verification-before-ci true
qd config set policy-require-p2-p3-disposition-before-merge true
qd config set policy-require-merge-commit true
```

These policies are generic. qd does not care whether the worker used a local worktree, remote host, CI job, or human review. It cares that the DAG state contains the evidence needed to safely advance the node.

## Method And Reality

qd has one intended roadmap model: research first, structured specs,
evidence-backed completion, independent audits, typed blockers for real
environment/provider/credential/data failures, trusted CI, and green main.

Useful discovery commands:

```sh
qd help method
qd help reality
qd help specs
qd help milestones
qd help audits
qd help blockers
qd help evidence
qd prompt research
qd prompt reality-check
qd prompt repo-audit
qd prompt dag-review
```

Run `qd prompt research` before creating implementation nodes for external APIs,
SDKs, databases, browsers, queues, deployment targets, credentials, or provider
behavior. If research cannot verify the real surface, create research/blocker
work instead of implementation work.

Completion should carry evidence for each acceptance criterion. A summary-only
completion is not an adequate proof of correctness. Audit reports should inspect
diff, acceptance, and evidence. CI passing is required later, but CI is not the
audit.

Use JSON or file-backed node creation when generated specs contain shell-sensitive text:

```sh
qd node add --from-json roadmap/new-node.json
qd nodes add-bulk --from-json roadmap/mint-plan.json
qd node add --title "Audit cleanup" --spec-file /tmp/spec.md --acceptance-file /tmp/acceptance.md
```

Bulk mint plans may be either a node array or an object with `nodes[]` and optional `edges[]`. Node JSON is strict and uses the same typed fields as qd nodes: malformed strings, arrays, enums, or verification entries fail instead of being silently dropped.

`qd nodes add-bulk` is all-or-nothing. qd validates every node and edge, registers referenced metadata for the batch, then writes in one transaction. If any node or edge is invalid, no partial DAG is left behind.

Use structured blockers for project state outside dependency edges:

```sh
qd block xp3-fixture \
  --type manual \
  --reason "Fixture provenance review pending" \
  --owner trevor \
  --needed "Owner approves fixture provenance and redaction notes." \
  --evidence reports/xp3-fixture-provenance-blocker.md
qd unblock xp3-fixture \
  --summary "Fixture provenance and redaction notes approved." \
  --evidence reports/xp3-fixture-provenance-approved.md
```

Blocked nodes are excluded from `qd ready` by default even when all dependencies are complete. Blockers record reality that prevents honest progress, such as manual signoff, external dependency, policy no-go, environment failure, credential problem, provider outage, or missing data. They are not a replacement for dependency edges, audit findings, or failed CI runs. Unblocking requires evidence that the condition changed.

`qd gate <node> --json` returns stable `explanations[]` reason codes for practical blockers:

- `blockingFinding`: an open P0/P1 finding exists.
- `runningAudit`: an audit run is still running.
- `nodeBlocked`: the node has explicit manual, external, or policy blocker metadata.
- `blockedDependency`: a required dependency is not done.

By default, `qd gate` reports the structural gate: P0/P1 findings, running audits, explicit blockers, and dependency blockers. Use `qd gate <node> --phase ci --json` or `qd gate <node> --phase merge --json` when deciding whether lifecycle policy allows that phase. In phase mode, `ok` includes both structural blockers and the selected policy report; `structuralOk` preserves the lower-level gate result.

## Workspace

Workspace commands are read-only roll-ups across repo-local qd DAGs. They do not create nodes, claim work, record findings, or mutate another repository's DAG.

Use a workspace config:

```toml
repos = [
  "/home/trevor/projects/app-a",
  "/home/trevor/projects/app-b",
]
```

By default qd reads `$QD_WORKSPACE_CONFIG`, then `$XDG_CONFIG_HOME/qd/workspaces.toml`, then `~/.config/qd/workspaces.toml`.

Commands:

```sh
qd workspace status --json
qd workspace ready --json
qd workspace graph --json
```

For scripts or one-off checks, pass repos directly:

```sh
qd workspace status --repo /path/to/repo-a --repo /path/to/repo-b --json
```

## Worktrees

Worktree commands are git helpers for orchestrators that use one branch/worktree per active spec. They are optional; qd still works with remote workers or any other execution model.

```sh
qd worktree create <node> --branch spec/<node>
qd worktree create <node> --path ../worktrees/<node> --env-template .env.example --env QD_CACHE=/tmp/qd-cache
qd worktree env <node> --env-template .env.example --env QD_CACHE=/tmp/qd-cache
qd worktree status <node> --base main --json
qd worktree cleanup <node> --merged-only
```

`qd worktree create` defaults to `[worktree].base_dir/<node>` from `.qd/config.toml`, records the branch on the node, and refuses duplicate branch/path checkouts. `qd worktree status` reports dirty state, changed file count, merge-base, and ahead/behind counts against `--base`.

Env injection writes the configured env file inside the worktree and adds qd context variables such as `QD_ROOT`, `QD_NODE_ID`, `QD_BRANCH`, and `QD_WORKTREE`. qd owns a marked context block and replaces that block on later runs, so repeated `qd worktree env` calls do not duplicate qd variables. qd returns the env file path, but it does not store env values in the database or export.

## Audit

- `qd audit start <node>`
- `qd finding add <node> --severity P1 --title <text> --evidence <text>`
- `qd finding add [node] --from-report <audit-report.json>`
- `qd finding list [--open] [--severity P0,P1] [--node <id>]`
- `qd finding resolve <finding>`
- `qd finding dispose <finding> --disposition resolved|follow-up-node|promoted|dismissed|accepted-risk --rationale <text>`
- `qd finding promote <finding> [--title <text>] [--acceptance <text>] [--verification type=command,value="<cmd>"]`
- `qd promote-findings <node>`
- `qd gate <node> [--phase ci|merge]`
- `qd check run <node>`
- `qd ci run <node>`
- `qd ci status <node>|--all`
- `qd ci watch <node> [--interval 10] [--timeout 1800]`
- `qd ci poll <node> [--sha <commit>]`
- `qd audit pass <node> --from-report <audit-report.json>`
- `qd audit fail <node> --from-report <audit-report.json>`
- `qd audit cancel <node> --run-id <run> --rationale <text>`
- `qd audit supersede <node> --run-id <run> --rationale <text>`
- `qd audit validate <audit-report.json>`
- `qd verification list <node>`
- `qd verification sign-off <node> --index <n> --note <text> [--evidence <path>]`
- `qd verification sign-off <node> --all --from-report <verification-signoff-report.json>`
- `qd verification run <node> [--only <command>]`
- `qd verification record --from-json <verification-report.json>`
- `qd verification validate <verification-report.json>`
- `qd schema list`
- `qd schema print audit-report|finding-import|assignment|verification|external-ci|wave`

`qd promote-findings` prints `{ "promoted": [...] }` with the source finding id and new node id. It refuses while P0/P1 findings are open and includes the blocking finding ids and titles in the error.

`qd audit pass` is the clean audit composite: it imports a structured audit report, fails with `auditNotClean` if P0/P1 findings remain open, and promotes P2/P3 findings into future nodes when the current node is clean.

`qd verification list` shows stable 1-based indices, exact declared values, and signed state. Prefer `--index` to avoid whitespace or escaping drift. Batch sign-off requires a complete `verification-signoff-report`; it rejects missing, duplicated, reordered, or non-matching entries and records one evidence-backed run per declared gate.

## Advance And Diff

`qd advance` runs only lifecycle steps whose evidence already exists, then reports `stoppedAt`, all unsatisfied gates, and ordered next actions. It never manufactures audit, verification, CI, or repository-merge evidence. Child command output is logged rather than mixed into `--json` output.

For a commit already integrated into the current `HEAD`, `qd reconcile` validates one composite report containing completion, independent audit, exact verification, and trusted CI evidence. It verifies the commit and CI SHA, then records the clean lifecycle atomically. A valid failed audit records its findings and stops at review; invalid input makes no ledger changes.

`qd doctor <node> --json` explains why a node cannot finish using stable reason codes and exact next commands, including unsigned verification indices.

`qd diff <node> --self-only --base main` prints a diff from the node branch's merge-base with `main` to the node branch. This is useful when audit subagents need the branch's own change set without unrelated movement from an ahead main branch.

`qd diff <node> --working` finds the node's recorded worktree and prints uncommitted working-tree changes. Add `--staged` for staged-only worktree changes.

By default qd uses `git diff`. For semantic audit handoff, qd can call optional local adapters explicitly:

```sh
qd diff <node> --self-only --base main --tool sem --format markdown
qd diff <node> --self-only --base main --tool inspect --format json
qd prompt audit <node> --diff-tool sem
```

`sem` is useful for entity-level diffs and changed-function context. `inspect` is useful for review triage when the project has installed and configured it. qd does not install, vendor, or silently fall back for these tools; if `--tool sem` or `--tool inspect` is requested and the binary is missing, qd fails loudly.

`qd export --status ready,claimed,review --milestone alpha --json` prints a filtered canonical export for session resume and status handoff. Filtering preserves only matching nodes and their matching edges, runs, findings, and notes.

## Lifecycle

- `qd ci record-pass <node> --summary <text> (--log-path <path>|--url <url>|--external-id <id>)`
- `qd ci fail <node>`
- `qd ci poll <node> [--provider github] [--repo owner/name] [--workflow ci.yml] [--sha <commit>]`
- `qd merge <node> --use-existing-commit <sha> [--strategy squash|merge|rebase]`
- `qd merge <node> --via-pr [--strategy squash|merge|rebase]`

`qd merge` always enforces the ledger merge gate. In `--via-pr` mode it verifies branch-policy-required checks and either performs the direct GitHub merge or records asynchronous queue entry. `qd queue sync|drain` records the queue-produced commit and marks the node `done`. In `--use-existing-commit` mode it only records an integration already performed elsewhere.

For direct-to-main or external merge workflows, pass `--use-existing-commit <sha>` after the real merge has happened. qd stores that commit in the merge run's structured `git_sha`. In `--via-pr` mode, `--strategy` is passed to `gh pr merge`; in existing-commit mode it remains recorded workflow metadata.

Provider polling is adapter-based. The first adapter is GitHub through the `gh` CLI:

```sh
qd config set ci-provider github --repo owner/name --auth gh-cli
qd ci poll <node> --sha <commit>
```

Legacy `ci poll` can still pin `--workflow ci.yml`; PR status, monitor, sync, and queue commands derive their required contexts from branch rules instead. Unsupported providers fail loudly. Configure local commands with `ci_command` when a provider adapter is not available.

## Installed CLI Notes

`qd setup` and `qd agent install skills-sh` work from installed binaries because the qd DAG skill is embedded in the CLI.

`qd doctor --json` reports `runtime.viewer = "embedded"` when the installed CLI includes the packaged dashboard. `qd view` serves that dashboard locally and exposes read-only `/api/graph` and `/api/analytics` endpoints backed by the current qd database.
