# CLI Reference

Global root selection:

- `qd --root <repo> <command>`
- `QD_ROOT=/path/to/repo qd <command>`

If neither is set, qd uses the nearest ancestor `.qd/` directory. If no ancestor exists, it uses the current working directory.

## Core

- `qd init`
- `qd setup`
- `qd doctor [--json]`
- `qd status [--json]`
- `qd stats [--json] [--window 7] [--milestone <name>]`
- `qd snapshot [--json] [--milestone <name>]`
- `qd ready [--json]`
- `qd graph --format table|json|mermaid|dot`
- `qd export [--out <json>]`
- `qd import --from <json> [--schema-mapping <json>] [--adapter roadmap-html|markdown-checklist] [--dry-run] [--verbose]`
- `qd velocity [--window 7]`
- `qd critical-path [--milestone <name>]`
- `qd eta [--window 7] [--milestone <name>]`
- `qd milestone status [--milestone <name>]`
- `qd config show [--json]`
- `qd config get <key>`
- `qd config set check-command --value <command>`
- `qd config set ci-command --value <command>`
- `qd prompt plan|implement|audit|resolve [node] [--json]`
- `qd workspace status|ready|graph [--json] [--config <toml>] [--repo <path>]`
- `qd advance <node> --summary <text> [--merge]`
- `qd diff <node> [--base main] [--self-only] [--name-only]`

Config read/write round trip:

```sh
qd config set ci-command --value "<full project CI command>"
qd config get ci-command
```

For agent-facing JSON output, see [JSON Contract](./json.md).

## Import

Use `qd export` for qd-native shared state:

```sh
qd export --out roadmap/spec-dag.json
qd import --from roadmap/spec-dag.json
```

The exported JSON is the committed source of truth for sharing qd state across machines. `.qd/qd.db` remains a local rebuildable cache and should stay gitignored.

qd-native exports include registries, nodes, edges, findings, runs, and node notes. They import without a mapping file.

Use `qd import` for existing DAGs:

```sh
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json --dry-run --json
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json --dry-run --verbose
qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json
```

The import path is strict: unknown statuses require `statusMap`, malformed arrays fail, required fields must resolve, dependency arrays can create edges, and qd checks duplicate ids, missing edge endpoints, and `requires` cycles before writing.

Reference adapters normalize common roadmap formats into qd's canonical import JSON:

```sh
qd import --from docs/ROADMAP.html --adapter roadmap-html --dry-run --json
qd import --from roadmap.md --adapter markdown-checklist --dry-run --json
```

Adapters are intentionally small. For project-specific roadmap formats, write a project-local normalizer that emits `{ "nodes": [...], "edges": [...] }`, then import that JSON with qd's strict importer.

See [Importing An Existing DAG](./import.md) for the full `ImportMapping` schema.

## DAG

- `qd group register --name <name>`
- `qd project register --name <name>`
- `qd milestone register --name <name> --rank <number>`
- `qd node add --title <text> --spec <text> --acceptance <text>`
- `qd node add --from-json <node.json>`
- `qd node add --title <text> --spec-file <path> --acceptance-file <path>`
- `qd nodes add-bulk --from-json <plan.json>`
- `qd node add ... --group <name> --project <name> --project <name>`
- `qd node add ... --milestone <name> --verify type=command,value="just ci" --audit-focus <text>`
- `qd node list`
- `qd node show <id>`
- `qd node show <id> --full`
- `qd node show <id> --include findings,notes,audits,runs`
- `qd node edit <id> [--title] [--spec] [--acceptance]`
- `qd node edit <id> --branch <branch>`
- `qd node note <id> --text <text>`
- `qd node note <id> --mode list`
- `qd note add <id> --text <text>`
- `qd note list <id>`
- `qd edge add <from> <to> [--type requires]`
- `qd claim [node] --agent <name> [--branch <branch>]`
- `qd complete <node> --summary <text>`

Use JSON or file-backed node creation when generated specs contain shell-sensitive text:

```sh
qd node add --from-json roadmap/new-node.json
qd nodes add-bulk --from-json roadmap/mint-plan.json
qd node add --title "Audit cleanup" --spec-file /tmp/spec.md --acceptance-file /tmp/acceptance.md
```

Bulk mint plans may be either a node array or an object with `nodes[]` and optional `edges[]`. Node JSON is strict and uses the same typed fields as qd nodes: malformed strings, arrays, enums, or verification entries fail instead of being silently dropped.

## Workspace

Workspace commands are read-only roll-ups across repo-local qd DAGs. They do not create nodes, claim work, record findings, or mutate another repository's DAG.

Use a workspace config:

```toml
repos = [
  "/home/trevor/projects/app-a",
  "/home/trevor/projects/app-b",
]
```

By default qd reads `$QD_WORKSPACE_CONFIG`, then `$XDG_CONFIG_HOME/qd/workspaces.toml`, then `~/.config/qd/workspaces.toml`.

Commands:

```sh
qd workspace status --json
qd workspace ready --json
qd workspace graph --json
```

For scripts or one-off checks, pass repos directly:

```sh
qd workspace status --repo /path/to/repo-a --repo /path/to/repo-b --json
```

## Audit

- `qd audit start <node>`
- `qd finding add <node> --severity P1 --title <text> --evidence <text>`
- `qd finding add [node] --from-report <audit-report.json>`
- `qd finding list [--open] [--severity P0,P1] [--node <id>]`
- `qd finding resolve <finding>`
- `qd promote-findings <node>`
- `qd gate <node>`
- `qd check run <node>`
- `qd ci run <node>`

`qd promote-findings` prints `{ "promoted": [...] }` with the source finding id and new node id. It refuses while P0/P1 findings are open and includes the blocking finding ids and titles in the error.

## Advance And Diff

`qd advance <node> --summary "..."` is a lifecycle shortcut for orchestrators. It records completion when needed, runs the P0/P1 gate, runs configured `check_command` and `ci_command` when present, and reports the step where it stopped. It does not perform a git or GitHub merge. Pass `--merge` only after the real repository merge has been performed or when recording qd's state transition is intentionally the next step.

`qd diff <node> --self-only --base main` prints a diff from the node branch's merge-base with `main` to the node branch. This is useful when audit subagents need the branch's own change set without unrelated movement from an ahead main branch.

## Lifecycle

- `qd ci start <node> --cmd <command>`
- `qd ci pass <node>`
- `qd ci fail <node>`
- `qd merge <node> --strategy squash`

`qd merge` is a qd state transition, not a git operation and not a GitHub PR operation. It records a merge run and marks the node `done` only after qd confirms the node is mergeable, P0/P1 findings are closed, and the latest CI passed when `require_ci_before_merge = true`. Do the actual git merge, squash, rebase, or PR merge in your normal repo workflow before or around this command.

## Installed CLI Notes

`qd setup` and `qd agent install skills-sh` work from installed binaries because the qd DAG skill is embedded in the CLI.

`qd doctor --json` reports `runtime.viewer = "source-checkout-only"` when the CLI is installed without the qdcli monorepo. That is not an error; DAG commands remain available. `qd view` currently requires running from the qdcli source checkout because the Vite viewer assets are not shipped as a static installed asset yet.
