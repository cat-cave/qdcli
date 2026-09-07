set shell := ["bash", "-eo", "pipefail", "-c"]

default:
  just --list

install:
	corepack pnpm install

build: install
	corepack pnpm exec vp run -r build

test: build
	corepack pnpm exec vp test

coverage: build
	corepack pnpm exec vp test run --coverage

lint: build
	corepack pnpm exec vp lint

typecheck: build
	corepack pnpm exec vp check

typecheck-tsgo: build
	corepack pnpm exec vp run typecheck:tsgo

format:
  corepack pnpm exec vp fmt --write .

format-check:
  corepack pnpm exec vp fmt --check .

ci: install
	corepack pnpm exec vp run ci

pack:
  corepack pnpm exec vp run pack

npm-smoke:
  ./scripts/validate-npm-package.sh

mutation:
  corepack pnpm exec stryker run

changeset:
  corepack pnpm exec changeset

release-version:
  corepack pnpm exec changeset version
  corepack pnpm install --lockfile-only

release-check:
  just ci
  just npm-smoke

release-tag:
  git diff --quiet
  git diff --cached --quiet
  VERSION="$(node -p 'require("./packages/cli/package.json").version')"; git tag "v$VERSION"

release-push:
  VERSION="$(node -p 'require("./packages/cli/package.json").version')"; git push origin main "v$VERSION"

release-publish:
  corepack pnpm exec changeset publish --no-git-tag

view *ARGS:
  corepack pnpm exec vp run @qdcli/viewer#dev -- {{ARGS}}
