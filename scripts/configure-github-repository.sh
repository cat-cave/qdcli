#!/usr/bin/env bash
set -euo pipefail

repo="${1:-cat-cave/qdcli}"
root="$(git rev-parse --show-toplevel)"
ruleset="$root/.github/rulesets/main.json"

gh api --method PATCH "repos/$repo" \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F allow_squash_merge=true \
  -F delete_branch_on_merge=true >/dev/null

ruleset_id="$(
  gh api "repos/$repo/rulesets" --paginate --jq \
    '.[] | select(.name == "qdcli main queue") | .id' | head -n 1
)"

if [[ -n "$ruleset_id" ]]; then
  gh api --method PUT "repos/$repo/rulesets/$ruleset_id" --input "$ruleset" >/dev/null
  printf 'Updated ruleset %s for %s\n' "$ruleset_id" "$repo"
else
  gh api --method POST "repos/$repo/rulesets" --input "$ruleset" >/dev/null
  printf 'Created ruleset for %s\n' "$repo"
fi
