# CLI Reference

## Core

- `qd init`
- `qd setup`
- `qd doctor [--json]`
- `qd status [--json]`
- `qd ready [--json]`
- `qd graph --format table|json|mermaid|dot`
- `qd config show [--json]`
- `qd config set check-command --value <command>`
- `qd config set ci-command --value <command>`

## DAG

- `qd node add --title <text> --spec <text> --acceptance <text>`
- `qd node list`
- `qd node show <id>`
- `qd node edit <id> [--title] [--spec] [--acceptance]`
- `qd edge add <from> <to> [--type requires]`
- `qd claim [node] --agent <name>`
- `qd complete <node> --summary <text>`

## Audit

- `qd audit start <node>`
- `qd finding add <node> --severity P1 --title <text> --evidence <text>`
- `qd finding resolve <finding>`
- `qd promote-findings <node>`
- `qd gate <node>`
- `qd check run <node>`
- `qd ci run <node>`

## Lifecycle

- `qd ci start <node> --cmd <command>`
- `qd ci pass <node>`
- `qd ci fail <node>`
- `qd merge <node> --strategy squash`
