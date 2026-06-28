import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  addAssignment,
  getNode,
  readConfig,
  updateNode,
  type QdConfig,
} from "@cat-cave/qdcli-core";
import { output, required, requiredArg, stringListOpt, stringOpt } from "./args.js";
import { isAssignmentRole, strictEnumOpt } from "./enums.js";
import { pathExists } from "./fs-utils.js";
import { captureCommand } from "./shell.js";

export type GitWorktree = { path: string; branch: string | null; head: string | null };

export async function worktreeCommand(
  root: string,
  action: string | undefined,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "list" || action === "status" || !action) {
    const worktrees = await gitWorktrees(root);
    const node = nodeId ? await getNode(root, nodeId) : null;
    const config = await readConfig(root);
    const base = stringOpt(options.base) ?? "main";
    const filtered = node?.branch
      ? worktrees.filter((worktree) => worktree.branch === node.branch)
      : worktrees;
    return output(
      await Promise.all(
        filtered.map((worktree) => enrichWorktree(root, worktree, config, { base })),
      ),
      json,
    );
  }
  if (action === "create") {
    const node = await getNode(root, requiredArg(nodeId, "node id"));
    const config = await readConfig(root);
    const kind = stringOpt(options.kind) ?? "spec";
    const branch = stringOpt(options.branch) ?? `${kind}/${node.id}`;
    const worktreePath = path.resolve(
      root,
      stringOpt(options.path) ?? path.join(config.worktree.baseDir, node.id),
    );
    const existing = await gitWorktrees(root);
    validateWorktreeCreateTarget(existing, branch, worktreePath);
    const branchExists = await captureCommand("git", branchExistsArgs(branch), root);
    const args = worktreeAddArgs(branchExists.code === 0, worktreePath, branch);
    const result = await captureCommand("git", args, root);
    if (result.code !== 0) throw new Error(`git worktree add failed: ${result.stderr}`);
    const updated = await updateNode(root, node.id, { branch });
    const envFile = await maybeWriteWorktreeEnv(
      root,
      worktreePath,
      node.id,
      branch,
      options,
      config,
    );
    if (options.assignment) {
      await addAssignment(root, {
        nodeId: node.id,
        role: strictEnumOpt(options.role, isAssignmentRole, "--role", "worker"),
        owner: required(options.owner, "--owner"),
        branch,
        worktreePath,
        scope: stringOpt(options.scope),
      });
    }
    return output({ ok: true, node: updated, branch, worktree: worktreePath, envFile }, json);
  }
  if (action === "env") {
    const node = await getNode(root, requiredArg(nodeId, "node id"));
    if (!node.branch) throw new Error(`Node ${node.id} has no branch`);
    const config = await readConfig(root);
    const worktree = findWorktreeByBranch(await gitWorktrees(root), node.branch);
    if (!worktree) throw new Error(`No worktree found for branch ${node.branch}`);
    const envFile = await writeWorktreeEnv(
      root,
      worktree.path,
      node.id,
      node.branch,
      options,
      config,
    );
    return output(
      { ok: true, nodeId: node.id, branch: node.branch, worktree: worktree.path, envFile },
      json,
    );
  }
  if (action === "cleanup") {
    const node = await getNode(root, requiredArg(nodeId, "node id"));
    if (!node.branch) throw new Error(`Node ${node.id} has no branch`);
    const worktree = findWorktreeByBranch(await gitWorktrees(root), node.branch);
    if (!worktree) throw new Error(`No worktree found for branch ${node.branch}`);
    const dirty = await captureCommand("git", gitStatusArgs(worktree.path), root);
    if (dirty.code !== 0) throw new Error(`git status failed: ${dirty.stderr}`);
    if (dirty.stdout.trim()) throw new Error(`Refusing to remove dirty worktree: ${worktree.path}`);
    if (options["merged-only"]) {
      const merged = await captureCommand("git", mergedBranchesArgs("main"), root);
      if (!isBranchListed(merged.stdout, node.branch)) {
        throw new Error(`Refusing cleanup because branch is not merged into main: ${node.branch}`);
      }
    }
    const removed = await captureCommand("git", worktreeRemoveArgs(worktree.path), root);
    if (removed.code !== 0) throw new Error(`git worktree remove failed: ${removed.stderr}`);
    return output({ ok: true, removed: worktree.path, branch: node.branch }, json);
  }
  throw new Error(`Unknown worktree action: ${action}`);
}

export async function gitWorktrees(root: string): Promise<GitWorktree[]> {
  const result = await captureCommand("git", gitWorktreeListArgs(), root);
  if (result.code !== 0) throw new Error(`git worktree list failed: ${result.stderr}`);
  return parseGitWorktreePorcelain(result.stdout);
}

export function gitWorktreeListArgs(): string[] {
  return ["worktree", "list", "--porcelain"];
}

export function parseGitWorktreePorcelain(stdout: string): GitWorktree[] {
  const entries: GitWorktree[] = [];
  let current: GitWorktree | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      if (current) entries.push(current);
      current = null;
      continue;
    }
    if (line.startsWith("worktree ")) current = { path: line.slice(9), branch: null, head: null };
    else if (line.startsWith("HEAD ") && current) current.head = line.slice(5);
    else if (line.startsWith("branch ") && current) current.branch = line.slice(18);
  }
  if (current) entries.push(current);
  return entries;
}

async function enrichWorktree(
  root: string,
  worktree: GitWorktree,
  config: QdConfig,
  options: { base: string },
): Promise<Record<string, unknown>> {
  const envPath = path.join(worktree.path, config.worktree.envFile);
  const status = await captureCommand("git", gitStatusArgs(worktree.path), root);
  const base =
    worktree.branch && status.code === 0
      ? await worktreeBaseReport(root, worktree.path, options.base, worktree.branch)
      : null;
  return {
    ...worktree,
    envFile: path.relative(root, envPath),
    envPresent: await pathExists(envPath),
    ...worktreeDirtySummary(status.code, status.stdout),
    base,
  };
}

async function worktreeBaseReport(
  root: string,
  worktreePath: string,
  baseRef: string,
  branch: string,
): Promise<Record<string, unknown> | null> {
  const mergeBase = await captureCommand("git", mergeBaseArgs(baseRef, branch), root);
  if (mergeBase.code !== 0) return null;
  const aheadBehind = await captureCommand(
    "git",
    aheadBehindArgs(worktreePath, baseRef, branch),
    root,
  );
  return worktreeBaseSummary(baseRef, mergeBase.stdout, aheadBehind.stdout);
}

export function gitStatusArgs(worktreePath: string): string[] {
  return ["-C", worktreePath, "status", "--porcelain"];
}

export function mergeBaseArgs(baseRef: string, branch: string): string[] {
  return ["merge-base", baseRef, branch];
}

export function aheadBehindArgs(worktreePath: string, baseRef: string, branch: string): string[] {
  return ["-C", worktreePath, "rev-list", "--left-right", "--count", `${baseRef}...${branch}`];
}

export function worktreeDirtySummary(
  statusCode: number,
  stdout: string,
): { dirty: boolean | null; changedFiles: number | null } {
  if (statusCode !== 0) return { dirty: null, changedFiles: null };
  const changedFiles = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
  return { dirty: changedFiles > 0, changedFiles };
}

export function worktreeBaseSummary(
  baseRef: string,
  mergeBaseStdout: string,
  aheadBehindStdout: string,
): Record<string, unknown> {
  const [behindText, aheadText] = aheadBehindStdout.trim().split(/\s+/);
  return {
    ref: baseRef,
    mergeBase: mergeBaseStdout.trim(),
    ahead: parseCount(aheadText),
    behind: parseCount(behindText),
  };
}

export function validateWorktreeCreateTarget(
  existing: GitWorktree[],
  branch: string,
  worktreePath: string,
): void {
  if (existing.some((worktree) => worktree.branch === branch)) {
    throw new Error(`Branch is already checked out in a worktree: ${branch}`);
  }
  if (existing.some((worktree) => path.resolve(worktree.path) === worktreePath)) {
    throw new Error(`Worktree path is already in use: ${worktreePath}`);
  }
}

export function worktreeAddArgs(
  branchExists: boolean,
  worktreePath: string,
  branch: string,
): string[] {
  return branchExists
    ? ["worktree", "add", worktreePath, branch]
    : ["worktree", "add", "-b", branch, worktreePath, "HEAD"];
}

export function branchExistsArgs(branch: string): string[] {
  return ["rev-parse", "--verify", branch];
}

export function worktreeRemoveArgs(worktreePath: string): string[] {
  return ["worktree", "remove", worktreePath];
}

export function mergedBranchesArgs(baseRef: string): string[] {
  return ["branch", "--merged", baseRef, "--format", "%(refname:short)"];
}

export function findWorktreeByBranch(worktrees: GitWorktree[], branch: string): GitWorktree | null {
  return worktrees.find((entry) => entry.branch === branch) ?? null;
}

export function isBranchListed(stdout: string, branch: string): boolean {
  return stdout.split(/\r?\n/).includes(branch);
}

function parseCount(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function maybeWriteWorktreeEnv(
  root: string,
  worktreePath: string,
  nodeId: string,
  branch: string,
  options: Record<string, string | string[] | boolean>,
  config: QdConfig,
): Promise<string | null> {
  if (!shouldWriteWorktreeEnv(options, config)) {
    return null;
  }
  return writeWorktreeEnv(root, worktreePath, nodeId, branch, options, config);
}

export function shouldWriteWorktreeEnv(
  options: Record<string, string | string[] | boolean>,
  config: QdConfig,
): boolean {
  return Boolean(options.env || options["env-template"] || hasSubstantiveTemplate(config));
}

export function hasSubstantiveTemplate(config: QdConfig): boolean {
  return Boolean(config.worktree.envTemplate.trim());
}

export async function writeWorktreeEnv(
  root: string,
  worktreePath: string,
  nodeId: string,
  branch: string,
  options: Record<string, string | string[] | boolean>,
  config: QdConfig,
): Promise<string> {
  const envFileName = stringOpt(options["env-file"]) ?? config.worktree.envFile;
  validateWorktreeEnvFileName(envFileName);
  const envPath = path.join(worktreePath, envFileName);
  await mkdir(path.dirname(envPath), { recursive: true });
  const template = stringOpt(options["env-template"]) ?? config.worktree.envTemplate;
  if (template.trim()) {
    await copyFile(path.resolve(root, template), envPath);
  } else {
    await writeFile(envPath, "", { flag: "wx" }).catch((error: unknown) => {
      if (isFileAlreadyExistsError(error)) {
        return;
      }
      throw error;
    });
  }
  const startMarker = "# qd worktree context begin";
  const endMarker = "# qd worktree context end";
  const injected = [
    startMarker,
    `QD_ROOT=${quoteEnvValue(root)}`,
    `QD_NODE_ID=${quoteEnvValue(nodeId)}`,
    `QD_BRANCH=${quoteEnvValue(branch)}`,
    `QD_WORKTREE=${quoteEnvValue(worktreePath)}`,
    ...stringListOpt(options.env)
      .map(parseEnvAssignment)
      .map(([key, value]) => `${key}=${quoteEnvValue(value)}`),
    endMarker,
  ].join("\n");
  const current = await readFile(envPath, "utf8");
  const pattern = new RegExp(
    `\\n?${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}\\n?`,
    "m",
  );
  const next = current.match(pattern)
    ? current.replace(pattern, `\n${injected}\n`)
    : `${current.replace(/\s*$/, "")}\n\n${injected}\n`;
  await writeFile(envPath, next, "utf8");
  return path.relative(root, envPath);
}

export function validateWorktreeEnvFileName(envFileName: string): void {
  if (envFileName.includes("..") || path.isAbsolute(envFileName)) {
    throw new Error("--env-file must be a relative file name inside the worktree");
  }
}

export function isFileAlreadyExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseEnvAssignment(value: string): [string, string] {
  const index = value.indexOf("=");
  if (index <= 0) throw new Error("--env must be KEY=value");
  const key = value.slice(0, index);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid env var name: ${key}`);
  return [key, value.slice(index + 1)];
}

export function quoteEnvValue(value: string): string {
  return JSON.stringify(value);
}
