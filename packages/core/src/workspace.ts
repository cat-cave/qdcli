import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getProjectPaths } from "./db.js";
import { graphSnapshot, readyNodes, stats, validateGraph } from "./graph.js";
import type { GraphSnapshot, QdNode } from "./types.js";

export interface WorkspaceRepo {
  name: string;
  root: string;
}

export interface WorkspaceOptions {
  configPath?: string;
  repos?: string[];
}

export interface WorkspaceStatusRepo {
  repo: string;
  root: string;
  ok: boolean;
  stats?: Record<string, unknown>;
  errors: string[];
  warnings: string[];
}

export interface WorkspaceStatus {
  ok: boolean;
  repos: WorkspaceStatusRepo[];
  totals: {
    repos: number;
    nodes: number;
    ready: number;
    donePoints: number;
    totalPoints: number;
    remainingPoints: number;
    openP0P1Findings: number;
  };
}

export interface WorkspaceReadyNode extends QdNode {
  repo: string;
  root: string;
}

export interface WorkspaceGraph {
  repos: WorkspaceRepo[];
  snapshots: Array<WorkspaceRepo & { snapshot: GraphSnapshot }>;
}

export async function workspaceStatus(options: WorkspaceOptions = {}): Promise<WorkspaceStatus> {
  const repos = await loadWorkspaceRepos(options);
  const results: WorkspaceStatusRepo[] = [];
  for (const repo of repos) {
    try {
      await assertExistingDatabase(repo);
      const repoStats = await stats(repo.root);
      const validation = await validateGraph(repo.root);
      results.push({
        repo: repo.name,
        root: repo.root,
        ok: validation.ok,
        stats: repoStats,
        errors: validation.errors,
        warnings: validation.warnings,
      });
    } catch (error) {
      results.push({
        repo: repo.name,
        root: repo.root,
        ok: false,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
      });
    }
  }
  const totals = results.reduce(
    (acc, repo) => {
      const repoStats = repo.stats ?? {};
      acc.nodes += numberStat(repoStats, "nodes");
      acc.ready += numberStat(repoStats, "ready");
      acc.donePoints += numberStat(repoStats, "donePoints");
      acc.totalPoints += numberStat(repoStats, "totalPoints");
      acc.remainingPoints += numberStat(repoStats, "remainingPoints");
      acc.openP0P1Findings += numberStat(repoStats, "openP0P1Findings");
      return acc;
    },
    {
      repos: results.length,
      nodes: 0,
      ready: 0,
      donePoints: 0,
      totalPoints: 0,
      remainingPoints: 0,
      openP0P1Findings: 0,
    },
  );
  return { ok: results.every((repo) => repo.ok), repos: results, totals };
}

export async function workspaceReady(
  options: WorkspaceOptions = {},
): Promise<WorkspaceReadyNode[]> {
  const repos = await loadWorkspaceRepos(options);
  const nodes: WorkspaceReadyNode[] = [];
  for (const repo of repos) {
    await assertExistingDatabase(repo);
    nodes.push(
      ...(await readyNodes(repo.root)).map((node) => ({
        ...node,
        repo: repo.name,
        root: repo.root,
      })),
    );
  }
  return nodes;
}

export async function workspaceGraph(options: WorkspaceOptions = {}): Promise<WorkspaceGraph> {
  const repos = await loadWorkspaceRepos(options);
  const snapshots = [];
  for (const repo of repos) {
    await assertExistingDatabase(repo);
    snapshots.push({ ...repo, snapshot: await graphSnapshot(repo.root) });
  }
  return { repos, snapshots };
}

export async function loadWorkspaceRepos(options: WorkspaceOptions = {}): Promise<WorkspaceRepo[]> {
  const rawRepos =
    options.repos && options.repos.length > 0
      ? options.repos
      : await readWorkspaceConfig(options.configPath);
  const repos = rawRepos.map((repoPath) => {
    const root = path.resolve(repoPath);
    return { name: path.basename(root), root };
  });
  const seen = new Set<string>();
  for (const repo of repos) {
    if (seen.has(repo.root)) throw new Error(`Duplicate workspace repo: ${repo.root}`);
    seen.add(repo.root);
  }
  if (repos.length === 0) throw new Error("Workspace config must include at least one repo");
  return repos;
}

async function readWorkspaceConfig(configPath?: string): Promise<string[]> {
  const resolved = path.resolve(configPath ?? defaultWorkspaceConfigPath());
  let content = "";
  try {
    content = await readFile(resolved, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Workspace config not found: ${resolved}`);
    }
    throw error;
  }
  const match = /^\s*repos\s*=\s*\[(?<items>[\s\S]*?)\]\s*$/m.exec(stripTomlComments(content));
  if (!match?.groups?.items) throw new Error(`${resolved}: expected repos = ["path", ...]`);
  return [...match.groups.items.matchAll(/"([^"]+)"/g)].map((item) => {
    const repo = item[1];
    if (!repo) throw new Error(`${resolved}: repo paths must be non-empty strings`);
    return repo;
  });
}

function defaultWorkspaceConfigPath(): string {
  if (process.env.QD_WORKSPACE_CONFIG) return process.env.QD_WORKSPACE_CONFIG;
  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(configHome, "qd", "workspaces.toml");
}

function stripTomlComments(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");
}

async function assertExistingDatabase(repo: WorkspaceRepo): Promise<void> {
  const { dbPath } = getProjectPaths(repo.root);
  try {
    if (!(await stat(dbPath)).isFile()) throw new Error(`${dbPath} is not a file`);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `Missing qd database for ${repo.root}; run qd setup/import in that repo first`,
      );
    }
    throw error;
  }
}

function numberStat(statsValue: Record<string, unknown>, key: string): number {
  const value = statsValue[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
