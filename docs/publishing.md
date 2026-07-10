# Publishing qdcli

qd publishes two npm packages:

- `@cat-cave/qdcli-core`: the graph/database engine used by the CLI and viewer.
- `@cat-cave/qdcli`: the user-facing package that installs the `qd` binary.

Users install only the CLI package:

```sh
pnpm dlx @cat-cave/qdcli --help
npx @cat-cave/qdcli --help
npm install -g @cat-cave/qdcli
```

## Required Access

Manual publishing requires an npm account with publish permission for the `@cat-cave` scope. Use an interactive npm login with 2FA.

Automated publishing uses npm Trusted Publishing from `.github/workflows/publish.yml`. Do not use a long-lived npm publish token for qdcli releases.

The first publish for each scoped package must be public.

## Repository Governance

Normal changes arrive through pull requests. `.github/workflows/ci.yml` exposes two required contexts, `quality` and `package`, on both `pull_request` and `merge_group`. The tracked `.github/rulesets/main.json` protects `main`, permits squash merges only, requires resolved review threads and both contexts, and enables a bounded native merge queue.

After the workflow exists on the default branch, an administrator can apply the tracked repository merge settings and ruleset idempotently:

```sh
scripts/configure-github-repository.sh cat-cave/qdcli
```

The bootstrap change that first adds `merge_group` support must merge through an ordinary checked PR before enabling the queue; otherwise GitHub cannot run the required workflow for its speculative merge group. Once enabled, feature and release PRs use the same queue and required checks.

## Prepublish Validation

Run:

```sh
nix develop -c just release-check
```

`just release-check` runs the same required quality gate as pull requests plus the npm tarball smoke. It intentionally does not run mutation testing.

`just npm-smoke` packs the actual core and CLI tarballs, installs them into a temporary npm prefix, and runs the installed `qd` binary through setup, doctor, JSON node creation, finding list, and export.

`just mutation` runs Stryker across qd's core and CLI source, excluding tests, public barrel exports, and embedded prompt prose. The current ratchet is `thresholds.break = 81`. Mutation is a scheduled and manually dispatchable depth signal in `.github/workflows/mutation.yml`; it is not a required PR check and cannot hold a package release hostage. String-literal and regex mutants are excluded because qd's parser-heavy import/config code creates low-signal churn there; state-machine, conditional, arithmetic, object, array, and method mutants remain in scope.

## Queue-Orchestration Release Checklist

Before cutting 0.3.0, validate the package surface, evidence contracts, reconciliation flow, concurrent ledger reads, and fake-`gh` PR integration harness:

```sh
nix develop -c corepack pnpm exec vp check
nix develop -c corepack pnpm exec vp test run --coverage
nix develop -c corepack pnpm exec vp test run packages/cli/src/cli-strict-method.e2e.test.ts packages/cli/src/cli-reconcile-reliability.e2e.test.ts packages/cli/src/cli-github-pr.e2e.test.ts
nix develop -c just npm-smoke
nix build .#packages.x86_64-linux.qd
nix develop -c corepack pnpm exec vp run pack
```

Mutation can be run separately when investigating the scheduled signal:

```sh
nix develop -c just mutation
```

For the release itself, use the approved Changesets and pull-request flow. Add the changeset to the feature PR. Prepare generated version files on a release branch, open a release PR, and merge it through the same required checks. Tag only the resulting commit on `main`:

```sh
nix develop -c just changeset
nix develop -c just release-version # on a release branch
nix develop -c just release-check
nix develop -c just release-tag     # after the release PR is on main
nix develop -c just release-push
```

After the Trusted Publishing workflow completes, verify the public package:

```sh
npm view @cat-cave/qdcli version
npx @cat-cave/qdcli@latest --version
npx @cat-cave/qdcli@latest schema list --json
```

The E2E targets must prove that weak evidence paths fail, reconciliation is atomic, JSON output remains parseable around noisy checks, GitHub passes are observed through `gh`, stale PRs remain visible, and PR-driven merges record GitHub's actual commit SHA.

## Changesets Release Flow

qd uses Changesets for package versioning, changelog generation, internal workspace dependency updates, and publish selection. Do not edit package versions or changelog sections by hand for normal releases.

For a change that should be released, add a changeset before merging:

```sh
nix develop -c just changeset
```

When preparing a release, run versioning on a release branch and submit the generated package/changelog/lockfile changes as a PR:

```sh
nix develop -c just release-version
nix develop -c just release-check
nix develop -c just release-tag
nix develop -c just release-push
```

`just release-version` runs `changeset version` and refreshes the pnpm lockfile. After the release PR merges, `just release-tag` requires a clean tree and creates the exact `v<@cat-cave/qdcli version>` tag on that `main` commit. Pushing the tag triggers `.github/workflows/publish.yml`.

The core and CLI packages are configured as a fixed Changesets group, so they version together. The viewer app remains a private workspace package, but its built static assets are embedded into the published CLI package.

## Manual Publish

Manual publishing should be rare. Prefer Trusted Publishing.

For a local bootstrap or emergency manual publish, run the same Changesets publish command after `just release-version` and `just release-check`:

```sh
nix develop -c just release-publish
```

After any publish, verify the public install path:

```sh
npx @cat-cave/qdcli --version
pnpm dlx @cat-cave/qdcli doctor --json
```

## Trusted Publishing

Each npm package must trust the GitHub Actions workflow named `publish.yml`:

- `@cat-cave/qdcli-core`
- `@cat-cave/qdcli`

Configure each package on npmjs.com under package Settings -> Trusted Publishing:

- Provider: GitHub Actions
- Organization or user: `cat-cave`
- Repository: `qdcli`
- Workflow filename: `publish.yml`
- Allowed action: `npm publish`

The workflow runs the same required quality and package-smoke gates, then lets Changesets publish the core and CLI packages through pnpm using npm's OIDC trusted publisher flow. Mutation testing remains on its independent scheduled/manual workflow.

The workflow runs `changeset publish --no-git-tag`. Changesets detects pnpm and publishes only packages whose local version is newer than npm, while pnpm handles workspace dependency rewriting. Git tags are owned by qd's `v<version>` release tags, so package-specific Changesets tags are disabled.
