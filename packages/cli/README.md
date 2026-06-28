# qdcli

Quick DAG is a thin CLI for orchestrator-led agentic project work. It stores a repo-local DAG of executable spec nodes, dependency edges, audit findings, lifecycle runs, CI state, and merge state.

qd does not run agents or decide where subagents execute. The intended model is one central orchestrator agent keeping the DAG accurate, selecting ready nodes, and delegating implementation or audit work to subagents in worktrees, remote machines, or whatever execution setup fits the project. qd stays simple: dependencies must be respected, specs must be completed, audits must happen, P0/P1 findings must be resolved, P2/P3 findings must enter the DAG, and CI must pass before merge.

## Install

```sh
pnpm dlx @cat-cave/qdcli --help
pnpm dlx @cat-cave/qdcli setup --print-agent-url
```

Other package managers:

```sh
npx @cat-cave/qdcli --help
bunx @cat-cave/qdcli --help
npm install -g @cat-cave/qdcli
qd --version
```

Install the package and use the `qd` executable to create a repo-local DAG, claim ready nodes, record audits and findings, gate P0/P1 blockers, track CI/merge state, serve the installed viewer, and inspect the graph.

See https://github.com/cat-cave/qdcli for full documentation.
