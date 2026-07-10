# qdcli

Quick DAG is a thin CLI for orchestrator-led agentic project work. It stores a repo-local DAG of executable spec nodes, dependency edges, audit findings, lifecycle runs, CI state, and merge state.

qd does not run agents or decide where subagents execute. The intended model is one central orchestrator agent keeping the DAG accurate, selecting ready nodes, and delegating implementation or audit work to many subagents in simultaneous worktrees. qd links each node to its PR, derives required checks from GitHub branch rules, monitors PR-head and merge-group state, admits bounded batches to a native merge queue, reconciles asynchronous merges/ejections, and produces deterministic failure cohorts for bisection. Dependencies, evidence, audits, findings, verification, and CI remain mandatory at speed.

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

First project setup should acknowledge qd's strict method before mutating roadmap state:

```sh
qd setup --no-hooks
qd method show
qd method acknowledge --agent codex
qd template completion-report
qd template audit-report
qd template reconciliation-report
```

See https://github.com/cat-cave/qdcli for full documentation.
