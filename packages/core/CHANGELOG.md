# @cat-cave/qdcli-core

## 0.1.8

### Patch Changes

- Ship the qd graph viewer as an embedded part of the installed CLI and serve it through `qd view` without requiring a qdcli source checkout.

## 0.1.7

### Patch Changes

- Fix the Nix flake package dependency closure so the offline pnpm install includes the release tooling required by the package build.

## 0.1.6

### Patch Changes

- Replace the custom release-bump and tarball publish plumbing with Changesets-managed versioning, changelog generation, and pnpm-backed publishing.
