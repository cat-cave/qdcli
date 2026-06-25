# qdcli

Quick DAG is a thin CLI for agent-readable project orchestration. It stores a repo-local DAG of executable spec nodes, dependency edges, audit findings, lifecycle runs, CI state, and merge state.

qd does not run agents. It gives Codex, Claude, and other agents a durable protocol for choosing ready work, claiming it, auditing it, resolving P0/P1 findings, promoting P2/P3 findings, and tracking velocity.

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
```

Start the read-only viewer:

```sh
qd view
```

## Agent Bootstrap

Install/read the qd DAG skill, run `qd doctor`, inspect `qd status` and `qd ready`, then help build or complete the DAG.
