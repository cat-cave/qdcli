# JSON Contract

Agent-facing qd JSON is versioned at the command payload level with `schemaVersion: 1` when the command returns a composed contract object.

Use `--json` for commands the orchestrator parses:

```sh
qd doctor --json
qd status --json
qd ready --json
qd node list --json
qd node show <id> --json
qd milestone status --json
qd velocity --json
qd critical-path --json
qd eta --json
qd prompt implement <id> --json
qd snapshot --json
```

`qd snapshot --json` is the compact orchestration read model:

```ts
interface QdSnapshotV1 {
  schemaVersion: 1;
  status: Record<string, unknown>;
  ready: QdNode[];
  openFindings: QdFinding[];
  criticalPath: CriticalPathReport;
}
```

`qd prompt ... --json` returns:

```ts
interface QdPromptV1 {
  schemaVersion: 1;
  kind: string;
  nodeId: string | null;
  node: QdNode | null;
  prompt: string;
}
```

Commands that already return a single domain object or array, such as `qd ready --json`, keep that native shape. Prefer `qd snapshot --json` when an orchestrator needs a lean one-call summary instead of repeatedly loading the full graph.
