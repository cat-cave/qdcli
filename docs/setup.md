# qd setup

Install qd, install the agent skills, initialize your repository, then verify that an orchestrator agent can use the DAG correctly.

## 1. Install the CLI

Use the npm package when you want the quickest install:

```sh
pnpm dlx @cat-cave/qdcli --help
pnpm dlx @cat-cave/qdcli setup --print-agent-url
```

Equivalent one-shot runners:

```sh
npx @cat-cave/qdcli --help
bunx @cat-cave/qdcli --help
```

Or install globally:

```sh
npm install -g @cat-cave/qdcli
qd --version
```

On NixOS, nix-darwin, or Home Manager, install the packaged CLI directly:

```sh
nix profile install github:cat-cave/qdcli#qd
```

For Home Manager, add the flake package to `home.packages`:

```nix
inputs.qdcli.url = "github:cat-cave/qdcli";

home.packages = [
  inputs.qdcli.packages.${pkgs.system}.qd
];
```

Source checkout setup is only for qdcli contributors, not for projects adopting qd:

```sh
curl -fsSL https://vite.plus | bash
vp help
nix develop
just install
just ci
```

Verify:

```sh
qd --version
```

## 2. Install agent skills

qd ships instructions for agents because the CLI is only useful when the orchestrator follows the DAG protocol and delegates work without bypassing qd's gates.

Install the skills.sh-compatible skill:

```sh
qd agent install skills-sh
```

The installed skill should teach the orchestrator to:

- use `qd ready` before choosing work to delegate
- use `qd claim` to mark delegated ownership
- use `qd prompt implement <node>` for scoped context
- record progress with `qd complete`
- create audit findings with `qd finding add`
- block merge on P0/P1 findings
- promote P2/P3 findings into future DAG nodes
- prefer `--json` when parsing CLI output

## 3. Initialize the repository

```sh
qd setup --no-hooks
```

`--no-hooks` is accepted for repos that want explicit hook opt-out. qd currently does not install git hooks by default; hooks remain a project-level choice.

This creates:

- `.qd/qd.db`
- `.qd/config.toml`
- `.qd/agents.md`
- `.qd/skills/qd-dag/SKILL.md`

Treat `.qd/qd.db` as a local cache. Do not commit it. For shared state across machines, worktrees, or remote orchestrator hosts, commit a qd JSON export:

```sh
qd export --out roadmap/spec-dag.json
```

On another clone or machine, rebuild the local cache from the committed qd JSON with sync:

```sh
qd setup --no-hooks
qd sync --from roadmap/spec-dag.json --dry-run --json
qd sync --from roadmap/spec-dag.json --dry-run --write-diff roadmap/sync-diff.json --json
qd sync --from roadmap/spec-dag.json
```

`qd export` includes nodes, edges, registries, findings, runs, and node notes. `qd sync` replaces the local cache from qd's canonical export format after validation. Use `qd sync --expect-clean --from roadmap/spec-dag.json --json` in automation when the local cache is expected to already match the committed JSON; qd exits non-zero with a drift summary rather than silently rewriting state. Use `qd import --schema-mapping` only when importing a non-qd source roadmap or bootstrapping an empty qd DAG.

Configure the local preflight command and the canonical green command:

```sh
qd config set check-command "<fast project check command>"
qd config set ci-command "<full project CI command>"
qd config get ci-command
qd config get policy --json
```

Use the repository's real commands. qd is language- and stack-neutral.

`check_command` is the faster local/orchestrator preflight. It runs when the orchestrator calls `qd check run <node>`. A passed check is recorded, but it does not make a node mergeable.

`ci_command` is the full trusted merge gate. It runs when the orchestrator calls `qd ci run <node>`. A passed CI run moves the node to `mergeable`; a failed run blocks it. The intended policy is green main: if CI does not pass, the node does not merge.

The default lifecycle policy is strict because qd is designed to keep main green: audit before CI, declared verification before CI, no undisposed P2/P3 findings before merge, and a real merge commit recorded with `qd merge --use-existing-commit <sha>`. Relax those settings only when the project has an explicit reason and records that reason in its setup notes.

If the repository uses a supported hosted CI adapter, configure it separately from local commands. The first built-in adapter is GitHub through the `gh` CLI:

```sh
qd config set ci-provider github --repo owner/name --workflow ci.yml --auth gh-cli
qd config get ci-provider
```

Provider polling is optional. If no adapter fits the project, keep using `qd ci run` for local trusted CI or `qd ci record-pass` with explicit evidence for externally completed CI.

If the repository uses git worktrees, configure the convention once:

```sh
qd config set worktree-base-dir "../worktrees"
qd config set worktree-env-template ".env.example"
qd config set worktree-env-file ".env"
```

Then the orchestrator can run `qd worktree create <node> --branch spec/<node>` and get a checked-out branch plus a worktree-local env file. qd writes qd context variables into that env file, but it never stores env contents in the DAG database or committed export. Use `qd worktree status <node> --base main --json` to inspect dirty state, changed file count, merge-base, and ahead/behind state before dispatching auditors.

Semantic diff/review tools are optional project tooling. If the project wants entity-level audit context, install the tool in that project environment and call it explicitly through qd:

```sh
qd diff <node> --tool sem --format markdown --self-only --base main
qd diff <node> --tool inspect --format json --self-only --base main
```

qd does not silently fall back from `sem` or `inspect` to plain git output. Missing adapter binaries are setup errors, not degraded success.

After qd state changes that should be shared, export and commit the portable DAG snapshot:

```sh
qd export --out roadmap/spec-dag.json
git add roadmap/spec-dag.json
git commit -m "Update qd DAG"
```

Do this after planned DAG edits, imported roadmaps, finding promotion, and merge-state recording when another clone, machine, or orchestrator needs the updated state.

## 4. Verify it works

```sh
qd doctor
qd status
qd ready
```

If doctor reports that the DB schema is older than the current qd binary, run:

```sh
qd migrate --json
qd doctor --json
```

`qd migrate` applies pending schema changes in place. It is the normal upgrade path for existing `.qd/qd.db` caches; do not delete the DB and reimport unless the user explicitly chooses that recovery path.

`qd doctor` should check:

- CLI binary is available
- database schema is current
- repo has a qd config
- agent instruction files are present
- graph has no cycles
- every non-draft node has acceptance criteria

An installed CLI should report `runtime.viewer = "embedded"`. Empty `check_command` or `ci_command` values are setup warnings. Configure them before starting real orchestration.

## 5. Hand off to an agent

Give the orchestrator agent one operational instruction:

```text
Read the qd DAG skill, run qd doctor, inspect qd status and qd ready, then orchestrate the DAG: delegate ready nodes, record audits and findings, require CI green, and merge only qd-mergeable work.
```

For a single-link bootstrap:

```sh
qd setup --print-agent-url
```

The printed page walks the agent through installing/checking the CLI, loading the skill, initializing the repo, and using the DAG lifecycle.

## 6. Import An Existing DAG

For an existing project, do not create hundreds of nodes one at a time. Import the current roadmap JSON:

```sh
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json --dry-run --json
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json
qd validate
```

Before importing, register any strict groups, projects, and milestones that your mapping will reference. Dry-run first and review errors, defaults, warnings, and dropped fields. qd will not silently map unknown statuses; use `statusMap` when migrating from another lifecycle.

Mapping files are JSON. Simple fields are dotted paths in your source objects. `spec` and `acceptance` can also fold multiple string or string-array fields into one qd field:

```json
{
  "nodesPath": "nodes",
  "id": "id",
  "title": "title",
  "spec": {
    "concat": ["summary", "deliverables"],
    "separator": "\n- ",
    "preamble": {
      "deliverables": "\n\nDeliverables:\n- "
    }
  },
  "acceptance": {
    "concat": ["acceptanceCriteria"],
    "separator": "\n- ",
    "preamble": {
      "acceptanceCriteria": "- "
    }
  },
  "group": "parallelGroup",
  "projects": "projects",
  "milestone": "target",
  "status": "status",
  "statusMap": {
    "planned": "ready",
    "in_progress": "working",
    "complete": "done",
    "cancelled": "cancelled",
    "regressed": "regressed"
  },
  "verification": "verification",
  "auditFocus": "auditFocus",
  "nodeEdges": {
    "path": "dependsOn",
    "edgeDirection": "deps-block-this-node"
  }
}
```

See [Importing An Existing DAG](./import.md) for the full mapping schema.

`qd graph --format json` emits the same shape qd imports by default, so export/import works for backup and re-tiering.

Prefer `qd export --out roadmap/spec-dag.json` for committed shared state. `qd graph --format json` is still useful for read-only inspection.

qd resolves the project root by checking `--root`, then `QD_ROOT`, then the nearest ancestor `.qd/` directory. This means agents can run `qd status`, `qd ready`, and node commands from subdirectories after setup.

## 7. Workspace Roll-Up

For multiple repositories, keep each repo's qd DAG local to that repo. Use workspace commands only for read-only planning:

```toml
# ~/.config/qd/workspaces.toml
repos = [
  "/home/trevor/projects/app-a",
  "/home/trevor/projects/app-b",
]
```

```sh
qd workspace status --json
qd workspace ready --json
qd workspace graph --json
```

Workspace roll-up does not claim nodes, write findings, run CI, or merge. The orchestrator still enters each repo and uses normal qd commands for work.

## 8. View the DAG

Start the installed read-only viewer:

```sh
qd view
```

`qd view` serves an embedded local dashboard at `http://127.0.0.1:5173` by default. Use `qd view --port <n>` to choose a different port, `qd view --open` to launch a browser, and `qd view --check --json` to verify packaged viewer assets in automation.

The viewer is read-only and focused on:

- DAG topology
- ready queue
- node detail
- findings
- milestones
- critical path
- velocity and ETA
