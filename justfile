set shell := ["bash", "-eo", "pipefail", "-c"]

default:
  just --list

install:
  corepack pnpm install

build:
  corepack pnpm exec vp run -r build

test:
  corepack pnpm exec vp test

coverage:
  corepack pnpm exec vp test run --coverage

lint:
  corepack pnpm exec vp lint

typecheck:
  corepack pnpm exec vp check

typecheck-tsgo:
  corepack pnpm exec vp run typecheck:tsgo

format:
  corepack pnpm exec vp fmt --write .

format-check:
  corepack pnpm exec vp fmt --check .

ci:
  corepack pnpm exec vp run ci

pack:
  corepack pnpm exec vp run pack

npm-smoke:
  ./scripts/validate-npm-package.sh

mutation:
  corepack pnpm exec stryker run

release-bump BUMP="patch":
  corepack pnpm exec node scripts/release-bump.mjs {{BUMP}}

release-check:
  just ci
  just npm-smoke
  just mutation

release-tag:
  VERSION="$(node -p 'require("./package.json").version')"; git add .github/workflows/publish.yml CHANGELOG.md package.json pnpm-lock.yaml apps/viewer/package.json packages/core/package.json packages/cli/package.json packages/cli/src/index.ts scripts/release-bump.mjs scripts/validate-npm-package.sh docs/publishing.md justfile vitest.config.ts stryker.config.json packages/core/src/*.test.ts; git commit -m "Release v$VERSION"; git tag "v$VERSION"

release-push:
  VERSION="$(node -p 'require("./package.json").version')"; git push origin main "v$VERSION"

view *ARGS:
  corepack pnpm exec vp run @qdcli/viewer#dev -- {{ARGS}}
