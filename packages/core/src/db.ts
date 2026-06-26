import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
  ciProvider: "none" | "github";
  ciRepo: string;
  ciWorkflow: string;
  ciAuth: "gh-cli";
  mergeStrategy: "squash" | "merge" | "rebase";
  requireCleanWorktree: boolean;
  cleanWorktreeExcept: string[];
  requireGateBeforeCi: boolean;
  requireCiBeforeMerge: boolean;
}

export const defaultConfig: QdConfig = {
  schemaVersion: 1,
  skillsDir: ".qd/skills",
  checkCommand: "",
  ciCommand: "",
  ciProvider: "none",
  ciRepo: "",
  ciWorkflow: "",
  ciAuth: "gh-cli",
  mergeStrategy: "squash",
  requireCleanWorktree: true,
  cleanWorktreeExcept: [".qd/"],
  requireGateBeforeCi: true,
  requireCiBeforeMerge: true,
};

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

export function parseConfig(content: string): QdConfig {
  const values: Record<string, string | boolean | number | string[]> = {};
  const allowedKeys = new Set([
    "schema_version",
    "skills_dir",
    "check_command",
    "ci_command",
    "ci_provider",
    "ci_repo",
    "ci_workflow",
    "ci_auth",
    "merge_strategy",
    "require_clean_worktree",
    "clean_worktree_except",
    "require_gate_before_ci",
    "require_ci_before_merge",
  ]);
  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const match = /^([a-zA-Z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!match) throw new Error(`line ${index + 1} is not a supported key = value assignment`);
    const key = match[1];
    const rawValue = match[2];
    if (!key || !rawValue) throw new Error(`line ${index + 1} is missing a key or value`);
    if (!allowedKeys.has(key)) throw new Error(`unknown config key: ${key}`);
    values[key] = parseTomlValue(rawValue.trim());
  }

  return {
    schemaVersion: requiredNumberValue(values, "schema_version"),
    skillsDir: requiredStringValue(values, "skills_dir"),
    checkCommand: requiredStringValue(values, "check_command", true),
    ciCommand: requiredStringValue(values, "ci_command", true),
    ciProvider: requiredCiProviderValue(values, "ci_provider"),
    ciRepo: requiredStringValue(values, "ci_repo", true),
    ciWorkflow: requiredStringValue(values, "ci_workflow", true),
    ciAuth: requiredCiAuthValue(values, "ci_auth"),
    mergeStrategy: requiredMergeStrategyValue(values, "merge_strategy"),
    requireCleanWorktree: requiredBooleanValue(values, "require_clean_worktree"),
    cleanWorktreeExcept: requiredStringArrayValue(values, "clean_worktree_except"),
    requireGateBeforeCi: requiredBooleanValue(values, "require_gate_before_ci"),
    requireCiBeforeMerge: requiredBooleanValue(values, "require_ci_before_merge"),
  };
}

function requiredStringValue(
  values: Record<string, unknown>,
  key: string,
  allowEmpty = false,
): string {
  const value = values[key];
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  if (!allowEmpty && !value.trim()) throw new Error(`${key} must not be empty`);
  return value;
}

function requiredBooleanValue(values: Record<string, unknown>, key: string): boolean {
  const value = values[key];
  if (typeof value !== "boolean") throw new Error(`${key} must be true or false`);
  return value;
}

function requiredStringArrayValue(values: Record<string, unknown>, key: string): string[] {
  const value = values[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${key} must be an array of strings`);
  }
  return value;
}

function requiredNumberValue(values: Record<string, unknown>, key: string): number {
  const value = values[key];
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${key} must be a number`);
  return value;
}

function requiredMergeStrategyValue(
  values: Record<string, unknown>,
  key: string,
): QdConfig["mergeStrategy"] {
  const value = values[key];
  if (value === "squash" || value === "merge" || value === "rebase") return value;
  throw new Error(`${key} must be squash, merge, or rebase`);
}

function requiredCiProviderValue(
  values: Record<string, unknown>,
  key: string,
): QdConfig["ciProvider"] {
  const value = values[key];
  if (value === "none" || value === "github") return value;
  throw new Error(`${key} must be none or github`);
}

function requiredCiAuthValue(values: Record<string, unknown>, key: string): QdConfig["ciAuth"] {
  const value = values[key];
  if (value === "gh-cli") return value;
  throw new Error(`${key} must be gh-cli`);
}

export async function writeConfig(root: string, config: QdConfig): Promise<void> {
  const paths = getProjectPaths(root);
  await mkdir(paths.qdDir, { recursive: true });
  await writeFile(paths.configPath, formatConfig(config), "utf8");
}

export function formatConfig(config: QdConfig): string {
  return `# qdcli repo-local configuration
# qd expects one canonical command that means "this node is safe to merge".
schema_version = ${config.schemaVersion}
skills_dir = "${config.skillsDir}"
check_command = "${escapeTomlString(config.checkCommand)}"
ci_command = "${escapeTomlString(config.ciCommand)}"
ci_provider = "${config.ciProvider}"
ci_repo = "${escapeTomlString(config.ciRepo)}"
ci_workflow = "${escapeTomlString(config.ciWorkflow)}"
ci_auth = "${config.ciAuth}"
merge_strategy = "${config.mergeStrategy}"
require_clean_worktree = ${config.requireCleanWorktree}
clean_worktree_except = [${config.cleanWorktreeExcept.map((item) => `"${escapeTomlString(item)}"`).join(", ")}]
require_gate_before_ci = ${config.requireGateBeforeCi}
require_ci_before_merge = ${config.requireCiBeforeMerge}
`;
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

function parseTomlValue(value: string): string | boolean | number | string[] {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (item.startsWith('"') && item.endsWith('"') ? item.slice(1, -1) : item));
  }
  return value;
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
