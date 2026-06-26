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

`just mutation` runs Stryker against `packages/core/src/**/*.ts` with Vitest and the TypeScript checker. The current release ratchet is `thresholds.break = 55`, and it should only rise after tests kill enough mutants to earn the higher threshold.

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

The workflow validates the repo, then lets Changesets publish the core and CLI packages through pnpm using npm's OIDC trusted publisher flow.

The workflow runs `changeset publish --no-git-tag`. Changesets detects pnpm and publishes only packages whose local version is newer than npm, while pnpm handles workspace dependency rewriting. Git tags are owned by qd's `v<version>` release tags, so package-specific Changesets tags are disabled.
