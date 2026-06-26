# qd setup

Install qd, install the agent skills, initialize your repository, then verify that an orchestrator agent can use the DAG correctly.

## 1. Install the CLI

Install Vite+ first:

```sh
curl -fsSL https://vite.plus | bash
vp help
```

Current install from a clone:

```sh
vp install
vp run -r build
vp pm --filter qdcli link --global
```

On Nix, use the flake dev shell while trialing:

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

Start the Vite viewer:

```sh
qd view
```

The first viewer should be read-only and focused on:

- DAG topology
- ready queue
- node detail
- findings
- milestones
- critical path
- velocity and ETA
