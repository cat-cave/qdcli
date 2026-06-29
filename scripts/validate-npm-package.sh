#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

corepack pnpm --dir "$repo_root" --filter ./packages/core pack --pack-destination "$tmpdir"
corepack pnpm --dir "$repo_root" --filter ./packages/cli pack --pack-destination "$tmpdir"

prefix="$tmpdir/prefix"
npm install --prefix "$prefix" "$tmpdir"/*.tgz

qd="$prefix/node_modules/.bin/qd"
expected_version="$(node -e 'console.log(require(process.argv[1] + "/packages/cli/package.json").version)' "$repo_root")"
actual_version="$("$qd" --version)"
test "$actual_version" = "$expected_version"
printf '%s\n' "$actual_version"
"$qd" view --check --json

project="$tmpdir/project"
mkdir -p "$project"
cd "$project"
"$qd" setup --no-hooks --json
"$qd" method acknowledge --agent npm-smoke --json
"$qd" config set ci-command --value "true" --json
"$qd" doctor --json

cat > node.json <<'JSON'
{
  "id": "smoke-node",
  "title": "Smoke node",
  "spec": "Create a smoke-test node from JSON.",
  "acceptance": "The node exists and can be listed.",
  "priority": "P2",
  "risk": "low"
}
JSON

"$qd" node add --from-json node.json --json
"$qd" finding list --json
"$qd" export --out roadmap/spec-dag.json --json
