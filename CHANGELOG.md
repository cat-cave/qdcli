# Changelog

All notable qdcli changes are recorded here.

## v0.1.4 - 2026-06-26

- Fix Trusted Publishing tarball paths so workflow-packed npm artifacts are published from the repository workspace instead of an unresolved glob.

## v0.1.3 - 2026-06-26

- Add adapter-based CI provider configuration and `qd ci poll` for GitHub Actions via the `gh` CLI.
- Add manual verification signoff, composite `qd audit pass`, filtered export, per-node CI command overrides, and merge recording with an existing commit SHA.
- Teach prompts, docs, and the installable qd DAG skill about project rules files, self-only audit diffs, provider adapters, and the orchestrator-led workflow.
- Keep public node JSON clean by removing internal DB metadata columns from hydrated node output.
- Fix fresh-runner CI by building workspace package outputs before `vp check`.

## v0.1.2 - 2026-06-26

- Fix the Trusted Publishing workflow so fresh GitHub runners install workspace dependencies before running CI and publishing.

## v0.1.1 - 2026-06-26

- Add core Vitest coverage tracking and make coverage part of the CI gate.
- Expand orchestration tests around claiming, failed checks, failed CI, node notes, validation warnings, imports, analytics, and workspace parsing.
- Raise the Stryker mutation testing ratchet from 45 to 55 after improving the score above the new threshold.
- Fix packaged `qd --version` to read the installed CLI package version instead of a hardcoded value.
- Add release automation for coordinated workspace version bumps, changelog updates, lockfile refreshes, release validation, tagging, and trusted publishing.
