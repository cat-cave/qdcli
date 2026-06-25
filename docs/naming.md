# Naming

Registry snapshot taken on 2026-06-25 with `npm view`.

## Recommendation

Use:

- Product name: Quick DAG
- npm package: `qdcli`
- executable: `qd`
- repo: `qdcli`

Rationale:

- `qd` is the right command shape for frequent agent/human use.
- `qdcli` is available on npm at the time of checking, while `qd` is already published.
- "Quick DAG" explains the abbreviation without forcing a long command.
- The name stays tool-like and does not imply that qd runs agents itself.

## Availability snapshot

Appeared available on npm:

- `qdcli`
- `quick-dag`
- `quickdag`
- `qdag`
- `dagctl`
- `dagstack`
- `dagqueue`
- `dagboard`
- `dagmate`

Already published on npm:

- `qd`

## Shortlist if `qdcli` is unavailable

1. `qdag`
2. `quick-dag`
3. `dagctl`
4. `dagqueue`
5. `dagstack`

## Names to avoid

- Names centered on "agent" because qd is not an agent runtime.
- Names close to established graph/CI tools such as Dagger.
- Names where the viewer becomes the implied core product, such as `dagboard`, unless the product direction changes.
