# @cat-cave/qdcli-core

## 0.2.1

### Patch Changes

- 841f3ba: Polish the strict evidence-first workflow before wider trialing.

  - Add `qd method show|status|acknowledge` with a stable method version/hash and a local acknowledgement gate for mutating roadmap and evidence commands.
  - Add `qd template <name>` and `qd schema example <name>` so agents can start from valid structured report/spec/milestone JSON instead of inventing fields.
  - Update README, package README, setup docs, LLM bootstrap docs, and installed skills to show method acknowledgement and valid completion/audit report flows.
  - Fix stale quickstart examples that still used summary-only completion or underspecified clean audit reports.
  - Keep notification language explicitly future-facing until notifier adapters exist.

## 0.2.0

### Minor Changes

- d1f71a5: Ship qd's strict evidence-first orchestration method as the default roadmap model.

  - Add canonical orchestration guidance for research-before-roadmap, executable specs, evidence-backed completion, independent audits, typed blockers, periodic repo audits, and DAG reality reviews.
  - Require structured completion reports for `qd complete` and for `qd advance` when it moves a node into review; summary-only completion now fails loudly.
  - Add strict public schemas for specs, milestones, research reports, completion reports, audit reports, findings, blockers, unblock reports, and reality checks.
  - Add first-class `qd block` and evidence-backed `qd unblock`, with expanded blocker types for environment, credential, provider, data, policy, manual, external, and external-dependency conditions.
  - Harden audit reports so clean audits must include acceptance review, verification evidence review, and real-world validation status; failed or blocked real-world validation requires a P0/P1 finding.
  - Update prompts, help topics, installed skills, and setup/LLM docs so agents repeatedly see the qd reality contract and the one intended workflow.

## 0.1.16

### Patch Changes

- Ship qd 0.1.16 with in-place DB migration support, stale-schema doctor checks, stricter canonical JSON sync dry-runs, v1-to-v2 qd export compatibility, richer viewer layouts, sync drift artifacts, and an 81% mutation-testing release ratchet.

## 0.1.15

### Patch Changes

- Harden qd for orchestrator-driven production use.

  - Split the CLI, graph engine, and viewer into focused modules under the source line cap.
  - Add strict command, schema, import, CI, lifecycle, worktree, and E2E coverage for practical qd flows.
  - Raise repo-wide mutation confidence with Stryker and enforce project-wide source line limits through the Oxlint plugin.
  - Improve CI polling, import mapping, node input, graph reporting, viewer, worktree, policy, and prompt surfaces.

## 0.1.14

### Patch Changes

- Polish the installed viewer and strengthen worktree/diff handoff for audit workflows.

  The viewer now has a triage panel for active blockers and regressed/blocked nodes, clickable dependency navigation in the node detail panel, clearer priority rails on graph nodes, and tighter responsive styling for orchestration dashboards. Worktree status now reports dirty state, changed file counts, merge-base, and ahead/behind counts against a selected base. Worktree env injection is idempotent and replaces qd's marked context block instead of appending duplicate variables.

  `qd diff` now supports explicit optional adapters with `--tool sem` and `--tool inspect`, plus `--working` for uncommitted node worktree changes. The default remains plain `git diff`; semantic/review tools must be requested explicitly and fail loudly when their binaries are unavailable.

## 0.1.13

### Patch Changes

- Add first-class policy evaluation, stronger worktree environment support, a richer responsive viewer, and an 80% mutation testing release ratchet.

  Policies now make qd's default opinions explicit: passed audits and declared verification sign-offs are required before CI, open P2/P3 findings must be disposed before merge, and merge records require the represented commit SHA. Worktree helpers can create conventional paths, record assignments, and inject node-scoped environment files without storing secrets in the DAG. The viewer now surfaces DAG health, milestone progress, active assignments, waves, blockers, latest runs, and richer node detail for orchestration dashboards.

## 0.1.12

### Patch Changes

- Add agent-agnostic orchestration state for assignments and waves, audit run lifecycle helpers, richer gate/readiness output, milestone query commands, typed notes, schema validation commands, verification evidence recording, timeout-aware local run evidence, and tighter state-machine mutation coverage.

## 0.1.11

### Patch Changes

- Harden DAG maintenance and migration workflows.

  - Fix partial `qd node edit` updates and add JSON/file-backed edit inputs.
  - Add first-class manual/external/policy blocker metadata and keep blocked nodes out of `qd ready`.
  - Make `qd nodes add-bulk` transactional and auto-register imported metadata for consistent validation.
  - Add deterministic exports and explicit canonical-export sync/replace workflows.
  - Improve roadmap HTML import scoping, status detection, and dependency extraction.
  - Add advisory `qd doctor` behavior with `qd doctor --strict` enforcement.

## 0.1.10

### Patch Changes

- Replace the installed qd viewer list with an interactive DAG map with zoom, filtering, live refresh, focus highlighting, and richer node detail panels.

## 0.1.9

### Patch Changes

- Make the CLI package build self-contained for publishing by building qdcli-core before embedding the viewer.

## 0.1.8

### Patch Changes

- Ship the qd graph viewer as an embedded part of the installed CLI and serve it through `qd view` without requiring a qdcli source checkout.

## 0.1.7

### Patch Changes

- Fix the Nix flake package dependency closure so the offline pnpm install includes the release tooling required by the package build.

## 0.1.6

### Patch Changes

- Replace the custom release-bump and tarball publish plumbing with Changesets-managed versioning, changelog generation, and pnpm-backed publishing.
