# qdcli research and product design

## Scope

`qdcli` is a local-first DAG ledger for orchestrator-led coding agents. It does not run agents, route model calls, or replace Claude/Codex goal mode. It owns the durable state that the orchestrator consults and updates while delegating work:

- project decomposition as a DAG
- dependency-safe task claiming
- implementation/audit/resolve/CI/merge lifecycle, regardless of whether subagents run in worktrees, remote machines, or another setup
- findings and quality gates
- velocity, estimates, and milestone status
- prompts and guardrails that help agents create useful DAGs

The core product should stay thin: a fast CLI, a SQLite-compatible database, a small Vite viewer, and first-class orchestrator-agent skills/instructions.

## Research signals

- Current research on agentic work is converging on explicit DAGs because they make dependencies, replay, auditability, and failure attribution visible. Relevant examples include GraphBit's deterministic graph engine, Verified Multi-Agent Orchestration's plan/execute/verify/replan loop, execution lineage for reproducible AI-native work, and AgentEval's DAG-based root-cause attribution.
- The useful takeaway is not to adopt an agent framework. The useful takeaway is to make qd's graph explicit, typed, inspectable, and hard to mutate casually once work starts.
- Vite+ is relevant as a packaging/tooling direction: a single CLI standardizing runtime, package manager, checks, build, test, and task execution for JS projects. qd should be similarly boring and cohesive: one binary, predictable commands, fast checks.
- Turso is a good fit if the storage layer remains SQLite-first. Turso's current TypeScript guidance recommends `@tursodatabase/database` for local embedded use, `@tursodatabase/sync` when local writes need push/pull cloud sync, and `@tursodatabase/serverless` for remote-only access.
- Drizzle can provide typed schema and migrations over libSQL/Turso, but the CLI's hot path should keep SQL simple and indexed. Avoid ORM abstraction where raw SQL is clearer for graph operations.
- Mergify Stacks is a good onboarding precedent: it installs a CLI, ships agent skills, offers an agent-facing setup page, initializes repo conventions, and includes a verification step. qd should copy that shape without copying its domain.

## Opinionated model

Every DAG node is an executable spec, not a vague task. A node must be small enough to be completed, audited, fixed, CI-checked, and merged independently.

Node contract:

- `id`: stable slug or generated id
- `title`: one-line imperative outcome
- `kind`: `feature`, `fix`, `refactor`, `test`, `docs`, `infra`, `audit-fix`
- `milestone`: optional grouping
- `status`: `draft`, `ready`, `claimed`, `working`, `review`, `fixing`, `ci`, `mergeable`, `done`, `blocked`, `cancelled`
- `priority`: `P0`, `P1`, `P2`, `P3`
- `estimate_points`: small integer, preferably 1, 2, 3, 5, 8
- `risk`: `low`, `medium`, `high`
- `owner`: human or agent label
- `branch`: suggested branch/worktree name
- `spec`: concrete implementation instructions
- `acceptance`: checkable acceptance criteria
- `validation`: commands or manual checks expected before audit
- `context`: concise pointers to files, docs, decisions, constraints
- `created_at`, `updated_at`, `claimed_at`, `done_at`

Edge contract:

- `from_node` blocks `to_node`
- edge types: `requires`, `unblocks`, `supersedes`, `related`
- only `requires` participates in readiness/topological scheduling
- cycles are rejected at write time

Finding contract:

- belongs to a node and audit run
- severity `P0` through `P3`
- `P0`: blocks merge, data loss/security/build break/incorrect core behavior
- `P1`: blocks merge, important regression or missing required acceptance
- `P2`: non-blocking but should become a new DAG node
- `P3`: polish/future improvement, optionally new DAG node
- contains file path, line if known, reproduction, expected behavior, suggested fix, and evidence

## Suggested SQLite schema

```sql
create table nodes (
  id text primary key,
  title text not null,
  kind text not null check (kind in ('feature','fix','refactor','test','docs','infra','audit-fix')),
  milestone text,
  status text not null,
  priority text not null check (priority in ('P0','P1','P2','P3')),
  estimate_points integer not null default 1,
  risk text not null check (risk in ('low','medium','high')),
  owner text,
  branch text,
  spec text not null,
  acceptance text not null,
  validation text,
  context text,
  created_at text not null,
  updated_at text not null,
  claimed_at text,
  done_at text
);

create table edges (
  from_node text not null references nodes(id) on delete cascade,
  to_node text not null references nodes(id) on delete cascade,
  type text not null default 'requires',
  created_at text not null,
  primary key (from_node, to_node, type),
  check (from_node <> to_node)
);

create table runs (
  id text primary key,
  node_id text not null references nodes(id) on delete cascade,
  kind text not null check (kind in ('implement','audit','resolve','ci','merge')),
  status text not null,
  worktree_path text,
  agent text,
  started_at text not null,
  finished_at text,
  summary text,
  log_path text
);

create table findings (
  id text primary key,
  node_id text not null references nodes(id) on delete cascade,
  run_id text references runs(id) on delete set null,
  severity text not null check (severity in ('P0','P1','P2','P3')),
  status text not null check (status in ('open','resolved','promoted','dismissed')),
  title text not null,
  path text,
  line integer,
  evidence text not null,
  expected text,
  suggested_fix text,
  created_at text not null,
  resolved_at text
);

create index idx_edges_to on edges(to_node);
create index idx_edges_from on edges(from_node);
create index idx_nodes_status on nodes(status);
create index idx_findings_node_status_severity on findings(node_id, status, severity);
create index idx_runs_node_kind on runs(node_id, kind);
```

Readiness query:

```sql
select n.*
from nodes n
where n.status in ('ready', 'blocked')
  and not exists (
    select 1
    from edges e
    join nodes dep on dep.id = e.from_node
    where e.to_node = n.id
      and e.type = 'requires'
      and dep.status <> 'done'
  )
order by
  case n.priority when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 else 3 end,
  n.estimate_points asc,
  n.created_at asc;
```

## CLI shape

Core graph:

- `qd init`
- `qd node add`
- `qd node edit <id>`
- `qd edge add <from> <to> --type requires`
- `qd validate` checks schema, missing acceptance, cycles, orphaned nodes, blocked-ready inconsistencies
- `qd ready` lists dependency-unblocked work
- `qd claim [id] --agent <name> --worktree`
- `qd status`
- `qd graph --format table|json|mermaid|dot`

Lifecycle:

- `qd start <id>` records implementation run
- `qd complete <id> --summary ...`
- `qd audit start <id>`
- `qd finding add <id> --severity P1 --path ...`
- `qd finding resolve <finding-id>`
- `qd promote-findings <id>` converts open P2/P3 findings into new nodes
- `qd gate <id>` fails if open P0/P1 findings exist
- `qd ci start <id> --cmd "vp check && vp test"`
- `qd ci pass <id>`
- `qd merge <id> --strategy squash`

Planning and reporting:

- `qd plan import plan.md|json`
- `qd plan export --format markdown|json`
- `qd milestone status`
- `qd velocity --window 7d`
- `qd eta --milestone <name>`
- `qd stats`

Agent prompt helpers:

- `qd prompt plan` prints the DAG-construction rubric
- `qd prompt implement <id>` prints current node, dependencies, acceptance, validation, and update protocol
- `qd prompt audit <id>` prints audit rubric and finding schema
- `qd prompt resolve <id>` prints only P0/P1 findings plus relevant implementation context

Agent enablement:

- `qd agent install codex` installs or prints instructions for the Codex skill pack
- `qd agent install claude` installs or prints instructions for the Claude skill/plugin pack
- `qd agent install skills-sh` installs a skills.sh-compatible skill
- `qd agent doctor` verifies that the CLI is on PATH, the repo is initialized, the database exists, and the relevant agent instruction files are discoverable
- `qd setup` initializes the repo, database, optional git hooks, and agent-facing docs
- `qd setup --print-agent-url` prints a single URL or local file path an agent can read to bootstrap itself

## DAG quality rubric

Agents creating the DAG should be told:

- Split by mergeable behavioral increments, not by files or layers.
- Each node needs a testable acceptance contract.
- A node should depend only on real prerequisites, not vague sequencing preferences.
- Prefer narrower nodes with explicit integration points over broad "build X" nodes.
- Avoid parallel nodes that edit the same high-churn files unless the dependency relationship is explicit.
- Add context links instead of copying whole documents into every node.
- Use milestones for product phases; use edges for technical necessity.
- Mark unknowns as discovery nodes with clear outputs.
- Treat P2/P3 findings as future work only after the current node is mergeable.

## Stack recommendation

- Language: TypeScript first, because the tool is mostly CLI, schema, text IO, and small web UI.
- Runtime/package flow: Vite+ when stable enough for the repo; otherwise pnpm + tsdown/Vitest/Oxlint as the low-friction equivalent.
- CLI framework: `commander` or `clipanion`; prefer predictable subcommands over clever interactive flows.
- Storage: local SQLite/Turso Database by default. Optional Turso Sync for cross-machine agent state. Do not require cloud.
- Schema: Drizzle migrations are useful, but keep scheduling queries as explicit SQL.
- Output: default human tables, `--json` for agents, `--format mermaid|dot` for graph rendering.
- Visualizer: build later as a read-only Vite app over the same database/export JSON. Do not let the visualizer become the product.

## Viewer

The viewer should be a small Vite app, not a terminal TUI. Its job is to provide a clean viewpoint over the DAG:

- graph canvas with status/priority coloring
- node detail drawer with spec, acceptance, dependencies, findings, runs, and CI state
- milestone lane or filter
- ready queue view
- critical path and ETA view
- velocity and cycle-time panels
- export/share current view

The viewer should be read-only for the first version. Writes stay in the CLI so agents have one authoritative mutation interface. The viewer can consume:

- `qd view --serve` local HTTP server
- `qd graph --json`
- direct read-only SQLite connection in local mode

## Agent skills and setup

qd should ship an agent enablement pack as a first-class artifact, similar in spirit to Mergify's Stacks setup flow.

Package layout:

```text
packages/cli/
apps/viewer/
skills/
  codex/qd-dag/SKILL.md
  claude/qd-dag.md
  skills-sh/qd-dag/SKILL.md
docs/
  setup.md
  agents.md
```

Setup flow:

1. Install the CLI.
2. Install the agent skill/instructions.
3. Run `qd setup` in the repository.
4. Run `qd doctor`.
5. Tell the agent: "Read the qd DAG skill, inspect `qd status`, and help me build or complete the DAG."

The skills should teach behavior, not just list commands:

- never work a node whose `requires` dependencies are incomplete
- always call `qd ready` or `qd prompt implement <id>` before starting work
- claim exactly one node before editing files
- write implementation summaries back to qd
- create structured audit findings instead of prose-only reviews
- route P0/P1 to resolver work before CI/merge
- promote P2/P3 into new DAG nodes only after the current node passes the gate
- use `--json` output when parsing CLI responses
- keep node specs concrete and acceptance-driven during planning

The single agent bootstrap page should be short and operational:

- install/check CLI
- install/check skill
- initialize/check repo
- create or inspect DAG
- claim ready node
- audit and gate
- CI and merge

## Sources

- GraphBit: https://arxiv.org/abs/2605.13848
- Verified Multi-Agent Orchestration: https://arxiv.org/abs/2603.11445
- Execution Lineage: https://arxiv.org/abs/2605.06365
- AgentEval: https://arxiv.org/abs/2604.23581
- Vite+: https://viteplus.dev/
- VoidZero tooling direction: https://voidzero.dev/posts/announcing-voidzero-inc
- Turso TypeScript quickstart: https://docs.turso.tech/sdk/ts/quickstart
- Drizzle Turso guide: https://orm.drizzle.team/docs/get-started/turso-new
- Mergify Stacks setup pattern: https://docs.mergify.com/stacks/setup/
