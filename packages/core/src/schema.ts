export const migrations = [
  {
    id: "001_initial",
    statements: [
      `create table if not exists schema_migrations (
        id text primary key,
        applied_at text not null
      )`,
      `create table if not exists nodes (
        id text primary key,
        title text not null,
        kind text not null check (kind in ('feature','fix','refactor','test','docs','infra','audit-fix')),
        milestone text,
        status text not null check (status in ('draft','ready','claimed','working','review','fixing','ci','mergeable','done','blocked','cancelled')),
        priority text not null check (priority in ('P0','P1','P2','P3')),
        estimate_points integer not null default 1,
        risk text not null check (risk in ('low','medium','high')),
        owner text,
        branch text,
        spec text not null,
        acceptance text not null,
        validation text,
        context text,
        created_at text not null,
        updated_at text not null,
        claimed_at text,
        done_at text
      )`,
      `create table if not exists edges (
        from_node text not null references nodes(id) on delete cascade,
        to_node text not null references nodes(id) on delete cascade,
        type text not null default 'requires' check (type in ('requires','unblocks','supersedes','related')),
        created_at text not null,
        primary key (from_node, to_node, type),
        check (from_node <> to_node)
      )`,
      `create table if not exists runs (
        id text primary key,
        node_id text not null references nodes(id) on delete cascade,
        kind text not null check (kind in ('implement','audit','resolve','ci','merge')),
        status text not null,
        worktree_path text,
        agent text,
        started_at text not null,
        finished_at text,
        summary text,
        log_path text
      )`,
      `create table if not exists findings (
        id text primary key,
        node_id text not null references nodes(id) on delete cascade,
        run_id text references runs(id) on delete set null,
        severity text not null check (severity in ('P0','P1','P2','P3')),
        status text not null check (status in ('open','resolved','promoted','dismissed')),
        title text not null,
        path text,
        line integer,
        evidence text not null,
        expected text,
        suggested_fix text,
        created_at text not null,
        resolved_at text
      )`,
      `create index if not exists idx_edges_to on edges(to_node)`,
      `create index if not exists idx_edges_from on edges(from_node)`,
      `create index if not exists idx_nodes_status on nodes(status)`,
      `create index if not exists idx_findings_node_status_severity on findings(node_id, status, severity)`,
      `create index if not exists idx_runs_node_kind on runs(node_id, kind)`,
    ],
  },
] as const;

