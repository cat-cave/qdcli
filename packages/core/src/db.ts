import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { connect } from "@tursodatabase/database";
import { defaultConfig, formatConfig, parseConfig, type QdConfig } from "./config.js";
import { migrations } from "./schema.js";

export { defaultConfig, formatConfig, parseConfig, type QdConfig } from "./config.js";

export type Database = Awaited<ReturnType<typeof connect>>;

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
  const db = await openDatabase(root);
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

export async function openDatabase(root = process.cwd()): Promise<Database> {
  const paths = getProjectPaths(root);
  const db = await connect(paths.dbPath);
  await exec(db, "pragma foreign_keys = on");
  return db;
}

export async function applyMigrations(db: Database): Promise<void> {
  await exec(
    db,
    `create table if not exists schema_migrations (
      id text primary key,
      applied_at text not null
    )`,
  );

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
  }
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
