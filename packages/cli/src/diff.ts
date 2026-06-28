import { getNode } from "@cat-cave/qdcli-core";
import { output, requiredArg, stringOpt } from "./args.js";
import { strictEnumOpt } from "./enums.js";
import { captureCommand } from "./shell.js";
import { gitWorktrees } from "./worktree.js";

type DiffTool = "git" | "sem" | "inspect";
type DiffFormat = "patch" | "plain" | "json" | "markdown";

export async function diffCommand(
  root: string,
  nodeId: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  const node = await getNode(root, requiredArg(nodeId, "node id"));
  if (!node.branch) throw new Error(`Node ${node.id} has no branch. Claim with --branch first.`);
  const base = stringOpt(options.base) ?? "main";
  const tool = diffToolFromOptions(options);
  const format = diffFormatFromOptions(options, tool);
  validateDiffModeOptions(options, tool);

  let mergeBase: string | null = null;
  let cwd = root;
  let command = "git";
  let commandArgs: string[] = [];
  let range: string | null = null;

  if (options.working) {
    const worktree = await nodeWorktree(root, node.branch);
    cwd = worktree.path;
    ({ command, args: commandArgs } = workingDiffInvocation(tool, format, options));
  } else if (options["self-only"]) {
    const result = await captureCommand("git", ["merge-base", base, node.branch], root);
    if (result.code !== 0) {
      throw new Error(`git merge-base failed for ${base} and ${node.branch}: ${result.stderr}`);
    }
    mergeBase = result.stdout.trim();
    range = `${mergeBase}..${node.branch}`;
  } else {
    range = `${base}...${node.branch}`;
  }

  if (!options.working) {
    if (!range) throw new Error("Internal error: diff range was not resolved");
    ({ command, args: commandArgs } = rangeDiffInvocation(
      tool,
      format,
      options,
      base,
      node.branch,
      range,
      mergeBase,
    ));
  }

  const result = await captureDiffCommand(command, commandArgs, cwd, tool);
  if (result.code !== 0) throw new Error(`${tool} diff failed: ${result.stderr}`);
  if (json) {
    output(
      {
        nodeId: node.id,
        base,
        branch: node.branch,
        tool,
        format,
        working: Boolean(options.working),
        staged: Boolean(options.staged),
        selfOnly: Boolean(options["self-only"]),
        mergeBase,
        cwd,
        command: [command, ...commandArgs],
        diff: result.stdout,
      },
      true,
    );
    return;
  }
  process.stdout.write(result.stdout);
}

export function diffToolFromOptions(
  options: Record<string, string | string[] | boolean>,
): DiffTool {
  if (options.semantic) return "sem";
  if (options.inspect) return "inspect";
  return strictEnumOpt(options.tool, isDiffTool, "--tool", "git");
}

export function diffFormatFromOptions(
  options: Record<string, string | string[] | boolean>,
  tool: DiffTool,
): DiffFormat {
  const fallback = tool === "git" ? "patch" : "markdown";
  const format = strictEnumOpt(options.format, isDiffFormat, "--format", fallback);
  if (tool === "git" && format !== "patch") {
    throw new Error("--format is only supported with --tool sem or --tool inspect");
  }
  return format;
}

export function validateDiffModeOptions(
  options: Record<string, string | string[] | boolean>,
  tool: DiffTool,
): void {
  if (options["name-only"] && tool !== "git") {
    throw new Error("--name-only is only supported with --tool git");
  }
  if (options.working && options["self-only"]) {
    throw new Error("--working and --self-only are separate diff modes; choose one");
  }
  if (options.working && tool === "inspect") {
    throw new Error(
      "--tool inspect only supports committed ref/range review; use --tool git or --tool sem for --working",
    );
  }
}

export function workingDiffInvocation(
  tool: DiffTool,
  format: DiffFormat,
  options: Record<string, string | string[] | boolean>,
): { command: string; args: string[] } {
  if (tool === "git") {
    const args = ["diff"];
    if (options["name-only"]) args.push("--name-only");
    if (options.staged) args.push("--staged");
    return { command: "git", args };
  }
  const args = ["diff", "--format", format];
  if (options.staged) args.push("--staged");
  return { command: "sem", args };
}

export function rangeDiffInvocation(
  tool: DiffTool,
  format: DiffFormat,
  options: Record<string, string | string[] | boolean>,
  base: string,
  branch: string,
  range: string,
  mergeBase: string | null,
): { command: string; args: string[] } {
  if (tool === "git") {
    const args = ["diff"];
    if (options["name-only"]) args.push("--name-only");
    return { command: "git", args: [...args, range] };
  }
  if (tool === "sem") {
    const [from, to] = semRangeEndpoints(range, base, branch, mergeBase);
    return { command: "sem", args: ["diff", "--from", from, "--to", to, "--format", format] };
  }
  return {
    command: "inspect",
    args: ["diff", inspectRange(range, base, branch), "--format", format],
  };
}

export function semRangeEndpoints(
  range: string,
  base: string,
  branch: string,
  mergeBase: string | null,
): [string, string] {
  return range.includes("...") ? [base, branch] : [mergeBase ?? base, branch];
}

export function inspectRange(range: string, base: string, branch: string): string {
  return range.includes("...") ? `${base}..${branch}` : range;
}

export function missingDiffToolMessage(tool: DiffTool): string | null {
  if (tool === "sem") {
    return "sem is not installed. Install @ataraxy-labs/sem or the sem binary, then rerun qd diff --tool sem.";
  }
  if (tool === "inspect") {
    return "inspect is not installed. Install inspect-cli, then rerun qd diff --tool inspect.";
  }
  return null;
}

export function isDiffTool(value: string): value is DiffTool {
  return value === "git" || value === "sem" || value === "inspect";
}

export function isDiffFormat(value: string): value is DiffFormat {
  return value === "patch" || value === "plain" || value === "json" || value === "markdown";
}

async function nodeWorktree(
  root: string,
  branch: string,
): Promise<{ path: string; branch: string | null; head: string | null }> {
  const worktree = (await gitWorktrees(root)).find((entry) => entry.branch === branch);
  if (!worktree) throw new Error(`No worktree found for branch ${branch}`);
  return worktree;
}

async function captureDiffCommand(
  command: string,
  args: string[],
  cwd: string,
  tool: DiffTool,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    return await captureCommand(command, args, cwd);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      const message = missingDiffToolMessage(tool);
      if (message) throw new Error(message);
    }
    throw error;
  }
}
