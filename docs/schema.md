# Schema

qd stores local state in `.qd/qd.db`.

## Nodes

Nodes are executable specs. They include title, kind, milestone, status, priority, estimate, risk, branch, spec, acceptance, validation, context, and timestamps.

## Edges

Edges connect nodes. Only `requires` edges participate in readiness.

## Runs

Runs record implementation, audit, resolve, CI, and merge lifecycle events.

## Findings

Findings belong to a node and can be P0, P1, P2, or P3.

- P0/P1 block the gate.
- P2/P3 can be promoted into future nodes after the gate passes.

