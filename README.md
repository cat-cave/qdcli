# qdcli

Quick DAG is a thin CLI for orchestrator-led agentic project work. It stores a repo-local DAG of executable spec nodes, dependency edges, audit findings, lifecycle runs, CI state, and merge state.

qd does not run agents or decide where subagents execute. The intended model is one central orchestrator agent keeping the DAG accurate, selecting ready nodes, and delegating implementation or audit work to subagents in worktrees, remote machines, or whatever execution setup fits the project. qd stays simple: dependencies must be respected, specs must be completed, audits must happen, P0/P1 findings must be resolved, P2/P3 findings must enter the DAG, and CI must pass before merge.

## Install For Development

```sh
nix develop
just install
just build
```

The Nix shell provides Node 24, git, gh, just, and Corepack-managed pnpm in `.corepack/bin`.

## Quickstart

```sh
qd setup
qd config set ci-command --value "nix develop -c just ci"
qd node add --id scaffold --title "Scaffold project" --spec "Create the project skeleton." --acceptance "The project builds."
qd ready
qd claim scaffold --agent codex
qd prompt implement scaffold
qd complete scaffold --summary "Implemented the scaffold."
qd audit start scaffold
qd gate scaffold
qd ci run scaffold
qd merge scaffold
qd stats
qd critical-path
qd eta
```

Start the read-only viewer:

```sh
qd view
```

## Agent Bootstrap

Install/read the qd DAG skill, run `qd doctor`, inspect `qd status` and `qd ready`, then operate as the orchestrator: keep the DAG clean, delegate ready nodes, audit results, and require green CI before merge.
