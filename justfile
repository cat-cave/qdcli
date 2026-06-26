set shell := ["bash", "-eo", "pipefail", "-c"]

default:
  just --list

install:
  corepack pnpm install

build:
  corepack pnpm exec vp run -r build

test:
  corepack pnpm exec vp test

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

view *ARGS:
  corepack pnpm exec vp run @qdcli/viewer#dev -- {{ARGS}}
