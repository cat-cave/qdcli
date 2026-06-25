set shell := ["bash", "-eo", "pipefail", "-c"]

default:
  just --list

install:
  corepack pnpm install

build:
  corepack pnpm run build

test:
  corepack pnpm run test

lint:
  corepack pnpm run lint

typecheck:
  corepack pnpm run typecheck

format:
  corepack pnpm run format

format-check:
  corepack pnpm run format:check

ci:
  corepack pnpm run ci

pack:
  corepack pnpm run pack

view *ARGS:
  corepack pnpm --filter @qdcli/viewer dev {{ARGS}}
