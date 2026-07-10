# JSON Contract

Agent-facing qd JSON is versioned at the command payload level with `schemaVersion: 1` when the command returns a composed contract object.

Use `--json` for commands the orchestrator parses:

```sh
qd doctor --json
qd status --json
qd ready --json
qd node list --json
qd node show <id> --json
qd node show <id> --full --json
qd gate <id> --json
qd finding list --open --severity P0,P1 --json
qd promote-findings <id> --json
qd advance <id> --from-report <completion-report.json> --json
qd doctor <id> --json
qd ci status <id> --json
qd ci status --all --json
qd monitor --json
qd sync-prs --json
qd queue enqueue --all-ready --limit 8 --concurrency 4 --json
qd queue sync --json
qd queue drain --json
qd queue bisect <id> --json
qd diff <id> --self-only --base main --json
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

`qd promote-findings <id> --json` returns the source finding id, new node id, and created node:

```ts
interface QdPromoteFindingsResult {
  promoted: Array<{
    findingId: string;
    newNodeId: string;
    node: QdNode;
  }>;
}
```

`qd advance <id> --json` returns a step summary and the node state where the lifecycle stopped:

```ts
interface QdAdvanceResult {
  ok: boolean;
  stoppedAt: string;
  nextAction: string | null;
  nextActions: string[];
  steps: Array<{ step: string; ok: boolean; detail?: unknown }>;
  node: QdNode;
}
```

GitHub PR status payloads include canonical PR identity, branch-policy-derived required checks, aggregate `checkState`, `behind`, GitHub mergeability, `readyToEnqueue`, `readyToMerge`, and a check evidence URL. The nested `queue` object independently reports membership, position, entry state, merge-group SHA, merge-group checks, missing required contexts, and ejection reason. All-node status/monitor payloads retain per-node errors rather than dropping an unavailable PR.

Queue batch commands preserve input priority order and return one result per node. `queue drain` returns only the wave captured when the command began. Merge policy payloads expose stable machine codes `not-enqueued`, `queued`, `ejected-from-queue`, `merge-group-check-failed`, and `queue-required-check-missing`. `qd doctor <id>` continues to use lifecycle reason codes such as `auditRequired`, `verificationRequired`, `ciRequired`, `staleBase`, and `mergeRecordRequired`.
