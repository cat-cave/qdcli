# Changelog

All notable qdcli changes are recorded here.

## v0.1.2 - 2026-06-26

- Fix the Trusted Publishing workflow so fresh GitHub runners install workspace dependencies before running CI and publishing.

## v0.1.1 - 2026-06-26

- Add core Vitest coverage tracking and make coverage part of the CI gate.
- Expand orchestration tests around claiming, failed checks, failed CI, node notes, validation warnings, imports, analytics, and workspace parsing.
- Raise the Stryker mutation testing ratchet from 45 to 55 after improving the score above the new threshold.
- Fix packaged `qd --version` to read the installed CLI package version instead of a hardcoded value.
- Add release automation for coordinated workspace version bumps, changelog updates, lockfile refreshes, release validation, tagging, and trusted publishing.
