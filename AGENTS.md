# AGENTS.md

qdcli — Quick DAG: repo-local DAG of executable spec nodes for orchestrator-led agentic project work (pnpm monorepo over Vite+: `packages/core`, `packages/cli`, `apps/viewer`).

- Agent protocol is mandatory: read `docs/agents.md` before planning; the method (`docs/orchestration.md`) before advancing any node.
- Acceptance (fresh tree): `nix develop -c just install`, then `nix develop -c just ci` (build + `vp check` [fmt+lint+types] + tests with coverage thresholds 75/90/88/86 + tsgo lane). Release gate: `just release-check` (ci + npm-smoke). Full command surface: `just --list`.
- Conventions: changesets for releases (no manual version edits); coverage/mutation thresholds are floors — raise only with evidence; new prose docs go under `docs/`.
- Roadmap/state: GitHub issues only. Cross-project view: Linear project `qdcli` (team PORT, workspace Cat Cave).
- ADLC wiring: issues labeled `adlc` are candidates for the autonomous agent-ops build loop (GitHub per-repo work, t56 verdict); the loop acts on this repo only after it moves from `adlc.repos-pending` to `adlc.repos-enabled` in agent-ops `nix/facts.nix` (gate: agent-ops #93 loop green). Until then the label marks intent only.
