import { evidenceFirstBlockerMigrationStatements } from "./schema-evidence-first.js";

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
  {
    id: "006_manual_blockers",
    statements: [
      `alter table nodes add column blocked_by text check (blocked_by in ('manual','external','policy'))`,
      `alter table nodes add column blocked_reason text`,
      `alter table nodes add column blocked_owner text`,
    ],
  },
  {
    id: "007_orchestration_state",
    statements: [
      `pragma foreign_keys = off`,
      `alter table runs rename to runs_old`,
      `alter table findings rename to findings_old`,
      `create table runs (
        id text primary key,
        node_id text not null references nodes(id) on delete cascade,
        kind text not null check (kind in ('implement','audit','resolve','check','ci','verification','merge')),
        status text not null,
        command text,
        provider text,
        exit_code integer,
        git_sha text,
        external_id text,
        url text,
        rationale text,
        superseded_by text,
        report_path text,
        audit_kind text,
        worktree_path text,
        agent text,
        started_at text not null,
        finished_at text,
        summary text,
        log_path text
      )`,
      `insert into runs (
        id, node_id, kind, status, worktree_path, agent, started_at, finished_at, summary, log_path
      )
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
      `alter table node_notes add column kind text not null default 'note' check (kind in ('note','blocker','retry','external-dependency','operator-instruction','audit-disposition','live-run-attempt','environment-preflight','risk-acceptance','migration-note'))`,
      `alter table node_notes add column evidence text`,
      `create table assignments (
        id text primary key,
        node_id text not null references nodes(id) on delete cascade,
        role text not null check (role in ('planner','worker','auditor','repair','reviewer','explorer')),
        owner text not null,
        branch text,
        worktree_path text,
        scope text,
        status text not null check (status in ('open','complete','failed','cancelled')),
        commits_json text not null default '[]',
        evidence_json text not null default '[]',
        summary text,
        started_at text not null,
        finished_at text
      )`,
      `create table waves (
        id text primary key,
        kind text not null check (kind in ('implementation','audit','repair','planning','release')),
        status text not null check (status in ('open','complete','cancelled')),
        summary text not null,
        started_at text not null,
        finished_at text
      )`,
      `create table wave_memberships (
        wave_id text not null references waves(id) on delete cascade,
        node_id text references nodes(id) on delete cascade,
        assignment_id text references assignments(id) on delete cascade,
        created_at text not null,
        check ((node_id is not null and assignment_id is null) or (node_id is null and assignment_id is not null)),
        primary key (wave_id, node_id, assignment_id)
      )`,
      `create index if not exists idx_runs_node_kind on runs(node_id, kind)`,
      `create index if not exists idx_runs_status on runs(status)`,
      `create index if not exists idx_assignments_node_status on assignments(node_id, status)`,
      `create index if not exists idx_assignments_branch on assignments(branch)`,
      `create index if not exists idx_assignments_worktree on assignments(worktree_path)`,
      `create index if not exists idx_waves_status on waves(status)`,
      `create index if not exists idx_wave_memberships_node on wave_memberships(node_id)`,
      `pragma foreign_keys = on`,
    ],
  },
  {
    id: "008_evidence_first_blockers",
    statements: evidenceFirstBlockerMigrationStatements,
  },
  {
    id: "009_node_pull_requests",
    statements: [
      `alter table nodes add column pr_number integer`,
      `alter table nodes add column pr_url text`,
      `create index if not exists idx_nodes_pr_number on nodes(pr_number)`,
    ],
  },
] as const;
