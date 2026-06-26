# qdcli

Quick DAG is a thin CLI for orchestrator-led agentic project work. It stores a repo-local DAG of executable spec nodes, dependency edges, audit findings, lifecycle runs, CI state, and merge state.

qd does not run agents or decide where subagents execute. The intended model is one central orchestrator agent keeping the DAG accurate, selecting ready nodes, and delegating implementation or audit work to subagents in worktrees, remote machines, or whatever execution setup fits the project. qd stays simple: dependencies must be respected, specs must be completed, audits must happen, P0/P1 findings must be resolved, P2/P3 findings must enter the DAG, and CI must pass before merge.

## Install

```sh
nix profile install github:cat-cave/qdcli#qd
qd --version
```

## Install For Development

```sh
curl -fsSL https://vite.plus | bash
vp help
nix develop
just install
just ci
```

The Nix shell provides Node 24, git, gh, just, and Corepack-managed pnpm. Project commands run through Vite+ (`vp`), including Oxfmt, Oxlint, Vitest, tsdown, and the TS7/native `tsgo` check lane.

## Quickstart

```sh
qd setup
qd agent install skills-sh
qd config set check-command --value "vp check"
qd config set ci-command --value "vp run ci"
qd config get ci-command
qd group register --name runtime
qd milestone register --name baseline --rank 10
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

For an existing roadmap, import instead of hand-entering nodes:

```sh
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json --dry-run --json
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json
qd validate
```

See `docs/import.md` for strict migration mapping, `statusMap`, folded fields, dependency arrays, and dry-run review.

`qd merge` records qd state only. It does not run git or GitHub merges; keep using the repo's normal merge workflow and use qd to enforce the DAG, audit, and green-CI gate.

Start the read-only viewer:

```sh
qd view
```

## Agent Bootstrap

Install/read the qd DAG skill, run `qd doctor`, inspect `qd status` and `qd ready`, then operate as the orchestrator: keep the DAG clean, delegate ready nodes, audit results, and require green CI before merge.
