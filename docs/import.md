# Importing An Existing DAG

Use `qd import` when a project already has a roadmap or spec DAG. Do not migrate a large DAG by replaying hundreds of `qd node add` commands.

The import command is strict by design:

- `nodesPath` must resolve to an array.
- Every imported node must resolve an `id`, `spec`, and `acceptance`.
- Unknown source statuses fail unless `statusMap` maps them.
- Malformed arrays fail instead of dropping invalid entries.
- Duplicate node ids, missing edge endpoints, and `requires` cycles fail before qd writes anything.
- Real imports require an empty qd node table. Register groups, projects, and milestones first, but import before creating qd nodes.
- `--dry-run` uses the same mapping path and reports defaults, unmapped top-level fields, warnings, planned nodes, and planned edges.

## Recommended Migration Flow

1. Normalize the source DAG if needed.

   If the existing roadmap has mixed shapes, write a small project-local preprocessor first. qd should receive predictable JSON, not a pile of special cases.

2. Register strict project metadata.

   ```sh
   qd milestone register --name baseline --rank 10
   qd milestone register --name alpha --rank 20
   qd group register --name agent-runtime
   qd project register --name web
   qd project register --name core
   ```

3. Create an import mapping.

   Keep it in the repo, for example `roadmap/qd-import-map.json`.

4. Dry-run the import.

   ```sh
   qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json --dry-run --json
   qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json --dry-run --verbose
   ```

   Fix every error. Review every default and dropped field. A dropped field is not automatically wrong, but it should be intentional.

5. Import and validate.

   ```sh
   qd import --from roadmap/spec-dag.json --schema-mapping roadmap/qd-import-map.json
   qd doctor
   qd status
   qd ready
   ```

6. Trial one ready node end to end before expanding orchestration.

   Claim it, delegate it, audit it, resolve or promote findings, run CI, and record merge only after qd marks it mergeable.

## ImportMapping Schema

All path fields are dotted paths relative to each source object.

```ts
interface ImportMapping {
  nodesPath?: string; // default: "nodes"; required to resolve to an array
  edgesPath?: string; // default: "edges"; absent means no top-level edges
  id?: string; // default: "id"; required per node
  title?: string; // default: "title"; defaults to id and reports that default
  kind?: string; // default: "kind"; defaults to feature
  milestone?: string; // default: "milestone"
  group?: string; // default: "group"
  projects?: string; // default: "projects"; string or string[]
  status?: string; // default: "status"; defaults to ready only when missing
  priority?: string; // default: "priority"; defaults to P2
  estimate?: string; // default: "estimate"; defaults to 1
  risk?: string; // default: "risk"; defaults to medium
  spec?: TextMapping; // default: "spec"; required per node
  acceptance?: TextMapping; // default: "acceptance"; required per node
  validation?: string; // default: "validation"
  verification?: string; // default: "verification"; array of strings or {type,value}
  auditFocus?: string; // default: "auditFocus"; string or string[]
  context?: string; // default: "context"
  statusReason?: string; // default: "statusReason"
  statusMap?: Record<string, NodeStatus>;
  nodeEdges?: {
    path: string;
    edgeDirection: "deps-block-this-node" | "this-node-blocks-deps";
    edgeType?: EdgeType; // default: requires
  };
  edgeFrom?: string; // default: "from"; for top-level edges
  edgeTo?: string; // default: "to"; for top-level edges
  edgeType?: string; // default: "type"; defaults to requires
}

type TextMapping =
  | string
  | {
      concat: string[];
      separator?: string;
      preamble?: Record<string, string>;
    };
```

## Realistic Mapping Example

This shape works well for DAGs that store node dependencies on each node:

```json
{
  "nodesPath": "nodes",
  "id": "id",
  "title": "title",
  "kind": "kind",
  "group": "parallelGroup",
  "projects": "projects",
  "milestone": "target",
  "status": "status",
  "statusMap": {
    "planned": "ready",
    "in_progress": "working",
    "complete": "done",
    "cancelled": "cancelled",
    "regressed": "regressed"
  },
  "priority": "priority",
  "estimate": "estimatePoints",
  "risk": "risk",
  "spec": {
    "concat": ["summary", "deliverables"],
    "separator": "\n- ",
    "preamble": {
      "deliverables": "\n\nDeliverables:\n- "
    }
  },
  "acceptance": {
    "concat": ["acceptanceCriteria"],
    "separator": "\n- ",
    "preamble": {
      "acceptanceCriteria": "- "
    }
  },
  "verification": "verification",
  "auditFocus": "auditFocus",
  "statusReason": "statusReason",
  "nodeEdges": {
    "path": "dependsOn",
    "edgeDirection": "deps-block-this-node",
    "edgeType": "requires"
  }
}
```

With `"edgeDirection": "deps-block-this-node"`, each id in `dependsOn` becomes `dependency -> current node`.

With `"edgeDirection": "this-node-blocks-deps"`, each id in the array becomes `current node -> referenced node`.

## Status Mapping

qd statuses are intentionally project-lifecycle specific. If a source status is not already a qd `NodeStatus`, map it explicitly:

```json
{
  "statusMap": {
    "planned": "ready",
    "in_progress": "working",
    "complete": "done",
    "regressed": "regressed"
  }
}
```

If `statusMap` is omitted and qd sees an unknown source status, import fails. This prevents a migrated DAG from accidentally treating every unfamiliar node as ready.
