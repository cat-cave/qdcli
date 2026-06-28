# qdcli

Quick DAG is a thin CLI for orchestrator-led agentic project work. It stores a repo-local DAG of executable spec nodes, dependency edges, audit findings, lifecycle runs, CI state, and merge state.

qd does not run agents or decide where subagents execute. The intended model is one central orchestrator agent keeping the DAG accurate, selecting ready nodes, and delegating implementation or audit work to subagents in worktrees, remote machines, or whatever execution setup fits the project. qd stays simple: dependencies must be respected, specs must be completed, audits must happen, P0/P1 findings must be resolved, P2/P3 findings must enter the DAG, and CI must pass before merge.

## Install

Universal npm package install:

```sh
pnpm dlx @cat-cave/qdcli --help
pnpm dlx @cat-cave/qdcli setup --print-agent-url
```

Other package managers work too:

```sh
npx @cat-cave/qdcli --help
bunx @cat-cave/qdcli --help
npm install -g @cat-cave/qdcli
qd --version
```

Nix install:

```sh
nix profile install github:cat-cave/qdcli#qd
qd --version
```

## Contributor Setup

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
qd config set check-command "<fast project check command>"
qd config set ci-command "<full project CI command>"
qd config get ci-command
qd group register --name runtime
qd milestone register --name baseline --rank 10
qd node add --id scaffold --title "Scaffold project" --spec "Create the project skeleton." --acceptance "The project builds."
qd ready
qd claim scaffold --agent codex
qd prompt implement scaffold
qd complete scaffold --summary "Implemented the scaffold."
printf '{"findings":[]}\n' > /tmp/qd-clean-audit.json
qd audit start scaffold
qd audit pass scaffold --from-report /tmp/qd-clean-audit.json
qd gate scaffold
qd ci run scaffold
# Perform the real git/GitHub merge using this repository's normal workflow.
qd merge scaffold --use-existing-commit <merge-commit-sha>
qd stats
qd critical-path
qd eta
```

For an existing non-qd roadmap, migrate instead of hand-entering nodes:

```sh
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json --dry-run --json
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json
qd validate
```

See `docs/import.md` for strict migration mapping, `statusMap`, folded fields, dependency arrays, and dry-run review.

For a repo that already commits a qd export, restore the local cache with `qd sync --from roadmap/spec-dag.json --dry-run --json` and then `qd sync --from roadmap/spec-dag.json`.

`qd merge` records qd state only. It does not run git or GitHub merges; keep using the repo's normal merge workflow and use qd to enforce the DAG, audit, and green-CI gate.

Start the installed read-only viewer:

```sh
qd view
```

`qd view` serves an embedded local dashboard at `http://127.0.0.1:5173` by default. It reads the same DAG database as the CLI and does not mutate project state.

## Agent Bootstrap

Install/read the qd DAG skill, run `qd doctor`, inspect `qd status` and `qd ready`, then operate as the orchestrator: keep the DAG clean, delegate ready nodes, audit results, and require green CI before merge.
