# AGENTS.md

qdcli — Quick DAG: repo-local DAG of executable spec nodes for orchestrator-led agentic project work (pnpm monorepo over Vite+: `packages/core`, `packages/cli`, `apps/viewer`).

- Agent protocol is mandatory: read `docs/agents.md` before planning; the method (`docs/orchestration.md`) before advancing any node.
- Acceptance (fresh tree): `nix develop -c just install`, then `nix develop -c just ci` (build + `vp check` [fmt+lint+types] + tests with coverage thresholds 75/90/88/86 + tsgo lane). Release gate: `just release-check` (ci + npm-smoke). Full command surface: `just --list`.
- Conventions: changesets for releases (no manual version edits); coverage/mutation thresholds are floors — raise only with evidence; new prose docs go under `docs/`.
- Roadmap/state: GitHub issues only. Cross-project view: Linear project `qdcli` (team PORT, workspace Cat Cave).
- CI billing (t132): this repo is **public**, so GitHub-hosted runners are already $0 — qdcli deliberately stays on `ubuntu-latest` and is NOT moved to the org's self-hosted `cat-cave` runners (public-repo self-hosted is the classic fork-PR pawn vector, and `publish.yml` needs hosted OIDC `id-token` for npm). The org rule "never pay a dollar to GitHub Actions" (vault `agent-ops/index.md`, law of 2026-09-09) is satisfied here at $0 hosted; the org's $150 Actions spending limit is an emergency ceiling, never headroom. Keep the CI anti-trigger law intact: `on: push` on `main` (or tags) only — never all branches — and the PR-lane concurrency group with cancel-in-progress stays in `ci.yml`.
- ADLC wiring: issues labeled `adlc` are candidates for the autonomous agent-ops build loop (GitHub per-repo work, t56 verdict); the loop acts on this repo only after it moves from `adlc.repos-pending` to `adlc.repos-enabled` in agent-ops `nix/facts.nix` (gate: agent-ops #93 loop green). Until then the label marks intent only.
