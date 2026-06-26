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
        status text not null check (status in ('draft','ready','claimed','working','review','fixing','ci','mergeable','done','regressed','blocked','cancelled')),
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
        kind text not null check (kind in ('implement','audit','resolve','check','ci','merge')),
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
  {
    id: "002_node_metadata",
    statements: [
      `alter table nodes add column group_name text`,
      `alter table nodes add column projects_json text not null default '[]'`,
      `alter table nodes add column verification_json text not null default '[]'`,
      `alter table nodes add column audit_focus_json text not null default '[]'`,
      `alter table nodes add column status_reason text`,
      `alter table nodes add column check_command text`,
      `create table if not exists groups (
        name text primary key,
        created_at text not null
      )`,
      `create table if not exists projects (
        name text primary key,
        created_at text not null
      )`,
      `create table if not exists milestones (
        name text primary key,
        rank integer not null unique,
        created_at text not null
      )`,
      `create table if not exists node_notes (
        id text primary key,
        node_id text not null references nodes(id) on delete cascade,
        text text not null,
        created_at text not null
      )`,
      `create index if not exists idx_nodes_group on nodes(group_name)`,
      `create index if not exists idx_node_notes_node on node_notes(node_id)`,
    ],
  },
  {
    id: "003_check_runs",
    statements: [
      `alter table findings rename to findings_old`,
      `alter table runs rename to runs_old`,
      `create table runs (
        id text primary key,
        node_id text not null references nodes(id) on delete cascade,
        kind text not null check (kind in ('implement','audit','resolve','check','ci','merge')),
        status text not null,
        worktree_path text,
        agent text,
        started_at text not null,
        finished_at text,
        summary text,
        log_path text
      )`,
      `insert into runs (id, node_id, kind, status, worktree_path, agent, started_at, finished_at, summary, log_path)
        select id, node_id, kind, status, worktree_path, agent, started_at, finished_at, summary, log_path from runs_old`,
      `create table findings (
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
      `insert into findings (id, node_id, run_id, severity, status, title, path, line, evidence, expected, suggested_fix, created_at, resolved_at)
        select id, node_id, run_id, severity, status, title, path, line, evidence, expected, suggested_fix, created_at, resolved_at from findings_old`,
      `drop table runs_old`,
      `drop table findings_old`,
      `create index if not exists idx_runs_node_kind on runs(node_id, kind)`,
      `create index if not exists idx_findings_node_status_severity on findings(node_id, status, severity)`,
    ],
  },
  {
    id: "004_regressed_status",
    statements: [
      `pragma foreign_keys = off`,
      `alter table edges rename to edges_old`,
      `alter table runs rename to runs_old`,
      `alter table findings rename to findings_old`,
      `alter table node_notes rename to node_notes_old`,
      `alter table nodes rename to nodes_old`,
      `create table nodes (
        id text primary key,
        title text not null,
        kind text not null check (kind in ('feature','fix','refactor','test','docs','infra','audit-fix')),
        milestone text,
        status text not null check (status in ('draft','ready','claimed','working','review','fixing','ci','mergeable','done','regressed','blocked','cancelled')),
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
        done_at text,
        group_name text,
        projects_json text not null default '[]',
        verification_json text not null default '[]',
        audit_focus_json text not null default '[]',
        status_reason text,
        check_command text
      )`,
      `insert into nodes (
        id, title, kind, milestone, status, priority, estimate_points, risk, owner, branch,
        spec, acceptance, validation, context, created_at, updated_at, claimed_at, done_at,
        group_name, projects_json, verification_json, audit_focus_json, status_reason, check_command
      )
        select id, title, kind, milestone, status, priority, estimate_points, risk, owner, branch,
          spec, acceptance, validation, context, created_at, updated_at, claimed_at, done_at,
          group_name, projects_json, verification_json, audit_focus_json, status_reason, check_command
        from nodes_old`,
      `create table edges (
        from_node text not null references nodes(id) on delete cascade,
        to_node text not null references nodes(id) on delete cascade,
        type text not null default 'requires' check (type in ('requires','unblocks','supersedes','related')),
        created_at text not null,
        primary key (from_node, to_node, type),
        check (from_node <> to_node)
      )`,
      `insert into edges (from_node, to_node, type, created_at)
        select from_node, to_node, type, created_at from edges_old`,
      `create table runs (
        id text primary key,
        node_id text not null references nodes(id) on delete cascade,
        kind text not null check (kind in ('implement','audit','resolve','check','ci','merge')),
        status text not null,
        worktree_path text,
        agent text,
        started_at text not null,
        finished_at text,
        summary text,
        log_path text
      )`,
      `insert into runs (id, node_id, kind, status, worktree_path, agent, started_at, finished_at, summary, log_path)
        select id, node_id, kind, status, worktree_path, agent, started_at, finished_at, summary, log_path from runs_old`,
      `create table findings (
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
      `insert into findings (id, node_id, run_id, severity, status, title, path, line, evidence, expected, suggested_fix, created_at, resolved_at)
        select id, node_id, run_id, severity, status, title, path, line, evidence, expected, suggested_fix, created_at, resolved_at from findings_old`,
      `create table node_notes (
        id text primary key,
        node_id text not null references nodes(id) on delete cascade,
        text text not null,
        created_at text not null
      )`,
      `insert into node_notes (id, node_id, text, created_at)
        select id, node_id, text, created_at from node_notes_old`,
      `drop table edges_old`,
      `drop table runs_old`,
      `drop table findings_old`,
      `drop table node_notes_old`,
      `drop table nodes_old`,
      `create index if not exists idx_edges_to on edges(to_node)`,
      `create index if not exists idx_edges_from on edges(from_node)`,
      `create index if not exists idx_nodes_status on nodes(status)`,
      `create index if not exists idx_findings_node_status_severity on findings(node_id, status, severity)`,
      `create index if not exists idx_runs_node_kind on runs(node_id, kind)`,
      `create index if not exists idx_nodes_group on nodes(group_name)`,
      `create index if not exists idx_node_notes_node on node_notes(node_id)`,
      `pragma foreign_keys = on`,
    ],
  },
  {
    id: "005_node_ci_command",
    statements: [`alter table nodes add column ci_command text`],
  },
] as const;
