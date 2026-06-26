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

For qdcli development from source, install Vite+ first:

```sh
curl -fsSL https://vite.plus | bash
vp help
```

Vite+ is not required for normal npm package usage.

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

Current install from a clone:

```sh
vp install
vp run -r build
vp pm --filter qdcli link --global
```

When developing qd itself, use the flake dev shell:

```sh
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

On another clone or machine, rebuild the local cache from the committed JSON:

```sh
qd setup --no-hooks
qd import --from roadmap/spec-dag.json
```

`qd export` includes nodes, edges, registries, findings, runs, and node notes. `qd import` restores qd's canonical export format without a mapping file. Use `--schema-mapping` only when importing a non-qd source roadmap.

Configure the local preflight command and the canonical green command:

```sh
qd config set check-command --value "<fast project check command>"
qd config set ci-command --value "<full project CI command>"
qd config get ci-command
```

Use the repository's real commands. qd is language- and stack-neutral.

`check_command` is the faster local/orchestrator preflight. It runs when the orchestrator calls `qd check run <node>`. A passed check is recorded, but it does not make a node mergeable.

`ci_command` is the full trusted merge gate. It runs when the orchestrator calls `qd ci run <node>`. A passed CI run moves the node to `mergeable`; a failed run blocks it. The intended policy is green main: if CI does not pass, the node does not merge.

For qdcli itself, `vp run ci` is the full green command; other projects should configure their own equivalent.

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

`qd doctor` should check:

- CLI binary is available
- database schema is current
- repo has a qd config
- agent instruction files are present
- graph has no cycles
- every non-draft node has acceptance criteria

An installed CLI may report `runtime.viewer = "source-checkout-only"`; that is expected unless you are running from the qdcli source checkout. Empty `check_command` or `ci_command` values are setup warnings. Configure them before starting real orchestration.

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

Start the Vite viewer from a qdcli source checkout:

```sh
qd view
```

Installed npm/Nix binaries currently support DAG commands; `qd view` requires running from the qdcli source checkout until viewer assets are shipped with the installed CLI.

The first viewer should be read-only and focused on:

- DAG topology
- ready queue
- node detail
- findings
- milestones
- critical path
- velocity and ETA
