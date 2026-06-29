import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { connect } from "@tursodatabase/database";
import { defaultConfig, formatConfig, parseConfig, type QdConfig } from "./config.js";
import { migrations } from "./schema.js";

export { defaultConfig, formatConfig, parseConfig, type QdConfig } from "./config.js";

export type Database = Awaited<ReturnType<typeof connect>>;

export const expectedSchemaMigration = migrations.at(-1)?.id ?? "000_none";

export interface SchemaStatus {
  ok: boolean;
  initialized: boolean;
  expected: string;
  applied: string[];
  missing: string[];
}

export interface ProjectPaths {
  root: string;
  qdDir: string;
  dbPath: string;
  configPath: string;
  agentsPath: string;
  logsDir: string;
}

export async function resolveProjectRoot(
  options: {
    cwd?: string;
    root?: string;
    allowMissing?: boolean;
  } = {},
): Promise<string> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const explicitRoot = options.root ?? process.env.QD_ROOT;
  if (explicitRoot) {
    const root = path.resolve(cwd, explicitRoot);
    if (options.allowMissing || (await isDirectory(path.join(root, ".qd")))) return root;
    throw new Error(`No qd project found at ${root}. Run qd setup there first.`);
  }

  let current = cwd;
  while (true) {
    if (await isDirectory(path.join(current, ".qd"))) return current;
    const parent = path.dirname(current);
    if (parent === current) {
      if (options.allowMissing) return cwd;
      throw new Error("No qd project found. Run qd setup, pass --root, or set QD_ROOT.");
    }
    current = parent;
  }
}

export function getProjectPaths(root = process.cwd()): ProjectPaths {
  const qdDir = path.join(root, ".qd");
  return {
    root,
    qdDir,
    dbPath: path.join(qdDir, "qd.db"),
    configPath: path.join(qdDir, "config.toml"),
    agentsPath: path.join(qdDir, "agents.md"),
    logsDir: path.join(qdDir, "logs"),
  };
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function initProject(root = process.cwd()): Promise<ProjectPaths> {
  const paths = getProjectPaths(root);
  await mkdir(paths.qdDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await writeIfMissing(
    paths.configPath,
    `# qdcli repo-local configuration
# qd expects one canonical command that means "this node is safe to merge".
schema_version = 1
skills_dir = ".qd/skills"
check_command = ""
ci_command = ""
ci_provider = "none"
ci_repo = ""
ci_workflow = ""
ci_auth = "gh-cli"
merge_strategy = "squash"
require_clean_worktree = true
clean_worktree_except = [".qd/"]
require_gate_before_ci = true
require_ci_before_merge = true

[export]
default_out = ""
canonicalize_command = ""

[hooks]
pre_claim = ""
post_claim = ""
pre_check = ""
post_check = ""
pre_gate = ""
post_export = ""
pre_merge = ""
post_merge = ""

[check]
timeout_seconds = 1200
no_output_timeout_seconds = 300

[ci]
timeout_seconds = 3600
no_output_timeout_seconds = 600

[secrets]
forbidden_path_globs = [".env", ".env.*", "**/.env", "**/.env.*"]
masked_env = []

[waves]
broad_audit_every = 3
deep_audit_every = 9

[policy]
require_audit_before_ci = true
require_verification_before_ci = true
require_p2_p3_disposition_before_merge = true
require_merge_commit = true

[worktree]
base_dir = ".qd/worktrees"
env_template = ""
env_file = ".env"
`,
  );
  await writeIfMissing(
    paths.agentsPath,
    `# qd agent bootstrap\n\nRead the qd DAG skill, run \`qd doctor\`, inspect \`qd status\` and \`qd ready\`, then help build or complete the DAG.\n`,
  );
  const db = await openDatabase(root, { skipSchemaCheck: true });
  await applyMigrations(db);
  return paths;
}

export async function readConfig(root = process.cwd()): Promise<QdConfig> {
  const paths = getProjectPaths(root);
  let content = "";
  try {
    content = await readFile(paths.configPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return defaultConfig;
    }
    throw error;
  }
  try {
    return parseConfig(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${paths.configPath}: ${message}`);
  }
}

export async function writeConfig(root: string, config: QdConfig): Promise<void> {
  const paths = getProjectPaths(root);
  await mkdir(paths.qdDir, { recursive: true });
  await writeFile(paths.configPath, formatConfig(config), "utf8");
}

export async function openDatabase(
  root = process.cwd(),
  options: { skipSchemaCheck?: boolean } = {},
): Promise<Database> {
  const paths = getProjectPaths(root);
  const db = await connect(paths.dbPath);
  await exec(db, "pragma foreign_keys = on");
  if (!options.skipSchemaCheck) await assertSchemaCurrent(db);
  return db;
}

export async function migrateProject(root = process.cwd()): Promise<SchemaStatus> {
  const paths = getProjectPaths(root);
  await mkdir(paths.qdDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  const db = await openDatabase(root, { skipSchemaCheck: true });
  await applyMigrations(db);
  return schemaStatus(db);
}

export async function applyMigrations(db: Database): Promise<string[]> {
  await exec(
    db,
    `create table if not exists schema_migrations (
      id text primary key,
      applied_at text not null
    )`,
  );

  const appliedIds: string[] = [];
  for (const migration of migrations) {
    const applied = await get<{ id: string }>(db, "select id from schema_migrations where id = ?", [
      migration.id,
    ]);
    if (applied) continue;
    for (const statement of migration.statements) {
      await exec(db, statement);
    }
    await run(db, "insert into schema_migrations (id, applied_at) values (?, ?)", [
      migration.id,
      new Date().toISOString(),
    ]);
    appliedIds.push(migration.id);
  }
  return appliedIds;
}

export async function schemaStatusForRoot(root = process.cwd()): Promise<SchemaStatus> {
  return schemaStatus(await openDatabase(root, { skipSchemaCheck: true }));
}

export async function assertSchemaCurrent(db: Database): Promise<void> {
  const status = await schemaStatus(db);
  if (status.ok) return;
  const detail = status.initialized
    ? `missing migration(s): ${status.missing.join(", ")}`
    : "no schema_migrations table found";
  throw new Error(`DB schema is older than this qd binary (${detail}). Run qd migrate.`);
}

async function schemaStatus(db: Database): Promise<SchemaStatus> {
  const initialized = await tableExists(db, "schema_migrations");
  const applied = initialized
    ? (await all<{ id: string }>(db, "select id from schema_migrations order by id asc")).map(
        (row) => row.id,
      )
    : [];
  const appliedSet = new Set(applied);
  const missing = migrations.map((migration) => migration.id).filter((id) => !appliedSet.has(id));
  return {
    ok: initialized && missing.length === 0,
    initialized,
    expected: expectedSchemaMigration,
    applied,
    missing,
  };
}

async function tableExists(db: Database, name: string): Promise<boolean> {
  const row = await get<{ name: string }>(
    db,
    "select name from sqlite_master where type = 'table' and name = ?",
    [name],
  );
  return Boolean(row);
}

export async function exec(db: Database, sql: string): Promise<void> {
  const statement = await db.prepare(sql);
  await statement.run();
}

export async function run(db: Database, sql: string, params: unknown[] = []): Promise<void> {
  const statement = await db.prepare(sql);
  await statement.run(...params);
}

export async function get<T>(
  db: Database,
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const statement = await db.prepare(sql);
  const row = await statement.get(...params);
  return row as T | undefined;
}

export async function all<T>(db: Database, sql: string, params: unknown[] = []): Promise<T[]> {
  const statement = await db.prepare(sql);
  const rows = await statement.all(...params);
  return rows as T[];
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, content, "utf8");
  }
}
