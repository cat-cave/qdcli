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

Publishing requires an npm account with publish permission for the `@cat-cave` scope. Use either:

- an interactive npm login on the release machine, or
- `NPM_TOKEN` configured in the environment or CI.

The first publish for each scoped package must be public.

## Prepublish Validation

Run:

```sh
nix develop -c just ci
nix develop -c just pack
nix develop -c just npm-smoke
nix develop -c just mutation
```

`just npm-smoke` packs the actual core and CLI tarballs, installs them into a temporary npm prefix, and runs the installed `qd` binary through setup, doctor, JSON node creation, finding list, and export.

`just mutation` runs Stryker against `packages/core/src/**/*.ts` with Vitest and the TypeScript checker. The initial release ratchet is `thresholds.break = 45`, set from the first full-core baseline and intended to rise as surviving mutants are intentionally killed.

## Publish Order

Publish core first, then CLI:

```sh
nix develop -c corepack pnpm --filter ./packages/core publish --access public
nix develop -c corepack pnpm --filter ./packages/cli publish --access public
```

After publish, verify the public install path:

```sh
npx @cat-cave/qdcli --version
pnpm dlx @cat-cave/qdcli doctor --json
```
