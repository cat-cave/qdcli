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

## Prepublish Validation

Run:

```sh
nix develop -c just release-check
```

`just release-check` runs the full CI gate, npm tarball smoke, and Stryker mutation ratchet.

`just npm-smoke` packs the actual core and CLI tarballs, installs them into a temporary npm prefix, and runs the installed `qd` binary through setup, doctor, JSON node creation, finding list, and export.

`just mutation` runs Stryker across qd's core and CLI source, excluding tests, public barrel exports, and embedded prompt prose. The current release ratchet is `thresholds.break = 81`. String-literal and regex mutants are excluded because qd's parser-heavy import/config code creates low-signal churn there; state-machine, conditional, arithmetic, object, array, and method mutants remain in scope.

## 0.3.0 Reliability Release Checklist

Before cutting 0.3.0, validate the package surface, evidence contracts, reconciliation flow, concurrent ledger reads, and fake-`gh` PR integration harness:

```sh
nix develop -c corepack pnpm exec vp check
nix develop -c corepack pnpm exec vp test run --coverage
nix develop -c corepack pnpm exec vitest run packages/cli/src/cli-strict-method.e2e.test.ts packages/cli/src/cli-reconcile-reliability.e2e.test.ts packages/cli/src/cli-github-pr.e2e.test.ts
nix develop -c just npm-smoke
nix develop -c just mutation
nix build .#packages.x86_64-linux.qd
nix develop -c corepack pnpm exec vp run pack
```

For the release itself, use the approved Changesets flow:

```sh
nix develop -c just changeset
nix develop -c just release-version
nix develop -c just release-check
nix develop -c just release-tag
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

When preparing a release:

```sh
nix develop -c just release-version
nix develop -c just release-check
nix develop -c just release-tag
nix develop -c just release-push
```

`just release-version` runs `changeset version` and refreshes the pnpm lockfile. `just release-tag` commits the generated package version/changelog changes and creates `v<@cat-cave/qdcli version>`. `just release-push` pushes `main` and the exact version tag, which triggers `.github/workflows/publish.yml`.

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

The workflow runs the same full `release-check` gate, including mutation testing, then lets Changesets publish the core and CLI packages through pnpm using npm's OIDC trusted publisher flow.

The workflow runs `changeset publish --no-git-tag`. Changesets detects pnpm and publishes only packages whose local version is newer than npm, while pnpm handles workspace dependency rewriting. Git tags are owned by qd's `v<version>` release tags, so package-specific Changesets tags are disabled.
