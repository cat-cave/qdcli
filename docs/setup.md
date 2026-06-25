# qd setup

Install qd, install the agent skills, initialize your repository, then verify that agents can use the DAG correctly.

## 1. Install the CLI

Planned quick install:

```sh
curl -fsSL https://qdcli.dev/install.sh | sh
```

Local development install:

```sh
pnpm install
pnpm build
pnpm link --global
```

Verify:

```sh
qd --version
```

## 2. Install agent skills

qd ships instructions for agents because the CLI is only useful when agents follow the DAG protocol.

Planned commands:

```sh
qd agent install codex
qd agent install claude
qd agent install skills-sh
```

The installed skill should teach the agent to:

- use `qd ready` before choosing work
- use `qd claim` before editing files
- use `qd prompt implement <node>` for scoped context
- record progress with `qd complete`
- create audit findings with `qd finding add`
- block merge on P0/P1 findings
- promote P2/P3 findings into future DAG nodes
- prefer `--json` when parsing CLI output

## 3. Initialize the repository

```sh
qd setup
```

This should create:

- `.qd/qd.db`
- `.qd/config.toml`
- `.qd/agents.md`
- optional git hooks that warn when a claimed node is not linked to the current branch

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

Give the agent one operational instruction:

```text
Read the qd DAG skill, run qd doctor, inspect qd status and qd ready, then help me build or complete the DAG.
```

For a single-link bootstrap, planned command:

```sh
qd setup --print-agent-url
```

The printed page should walk the agent through installing/checking the CLI, loading the skill, initializing the repo, and using the DAG lifecycle.

## 6. View the DAG

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
