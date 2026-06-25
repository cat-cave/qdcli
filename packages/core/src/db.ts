import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { connect } from "@tursodatabase/database";
import { migrations } from "./schema.js";

export type Database = Awaited<ReturnType<typeof connect>>;

export interface ProjectPaths {
  root: string;
  qdDir: string;
  dbPath: string;
  configPath: string;
  agentsPath: string;
  logsDir: string;
}

export interface QdConfig {
  schemaVersion: number;
  skillsDir: string;
  checkCommand: string;
  ciCommand: string;
  mergeStrategy: "squash" | "merge" | "rebase";
  requireCleanWorktree: boolean;
  requireGateBeforeCi: boolean;
  requireCiBeforeMerge: boolean;
}

export const defaultConfig: QdConfig = {
  schemaVersion: 1,
  skillsDir: ".qd/skills",
  checkCommand: "nix develop -c just ci",
  ciCommand: "nix develop -c just ci",
  mergeStrategy: "squash",
  requireCleanWorktree: true,
  requireGateBeforeCi: true,
  requireCiBeforeMerge: true,
};

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
check_command = "nix develop -c just ci"
ci_command = "nix develop -c just ci"
merge_strategy = "squash"
require_clean_worktree = true
require_gate_before_ci = true
require_ci_before_merge = true
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
  } catch {
    return defaultConfig;
  }
  return parseConfig(content);
}

export async function writeConfig(root: string, config: QdConfig): Promise<void> {
  const paths = getProjectPaths(root);
  await mkdir(paths.qdDir, { recursive: true });
  await writeFile(paths.configPath, formatConfig(config), "utf8");
}

export function parseConfig(content: string): QdConfig {
  const values: Record<string, string | boolean | number> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const match = /^([a-zA-Z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    const rawValue = match[2];
    if (!key || !rawValue) continue;
    values[key] = parseTomlValue(rawValue.trim());
  }

  return {
    schemaVersion: numberValue(values.schema_version, defaultConfig.schemaVersion),
    skillsDir: stringValue(values.skills_dir, defaultConfig.skillsDir),
    checkCommand: stringValue(values.check_command, defaultConfig.checkCommand),
    ciCommand: stringValue(values.ci_command, defaultConfig.ciCommand),
    mergeStrategy: mergeStrategyValue(values.merge_strategy, defaultConfig.mergeStrategy),
    requireCleanWorktree: booleanValue(values.require_clean_worktree, defaultConfig.requireCleanWorktree),
    requireGateBeforeCi: booleanValue(values.require_gate_before_ci, defaultConfig.requireGateBeforeCi),
    requireCiBeforeMerge: booleanValue(values.require_ci_before_merge, defaultConfig.requireCiBeforeMerge),
  };
}

export function formatConfig(config: QdConfig): string {
  return `# qdcli repo-local configuration
# qd expects one canonical command that means "this node is safe to merge".
schema_version = ${config.schemaVersion}
skills_dir = "${config.skillsDir}"
check_command = "${escapeTomlString(config.checkCommand)}"
ci_command = "${escapeTomlString(config.ciCommand)}"
merge_strategy = "${config.mergeStrategy}"
require_clean_worktree = ${config.requireCleanWorktree}
require_gate_before_ci = ${config.requireGateBeforeCi}
require_ci_before_merge = ${config.requireCiBeforeMerge}
`;
}

export async function openDatabase(root = process.cwd()): Promise<Database> {
  const paths = getProjectPaths(root);
  await mkdir(paths.qdDir, { recursive: true });
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

export async function get<T>(db: Database, sql: string, params: unknown[] = []): Promise<T | undefined> {
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

function parseTomlValue(value: string): string | boolean | number {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return value;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mergeStrategyValue(value: unknown, fallback: QdConfig["mergeStrategy"]): QdConfig["mergeStrategy"] {
  return value === "squash" || value === "merge" || value === "rebase" ? value : fallback;
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
