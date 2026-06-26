#!/usr/bin/env node
import { cp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliRoot = path.join(repoRoot, "packages", "cli");
const viewerDist = path.join(repoRoot, "apps", "viewer", "dist");
const embeddedViewer = path.join(cliRoot, "dist", "viewer");
const packageManager = process.env.npm_execpath
  ? { command: process.execPath, prefixArgs: [process.env.npm_execpath] }
  : { command: "pnpm", prefixArgs: [] };

runPnpm(["--dir", repoRoot, "--filter", "@cat-cave/qdcli-core", "run", "build"]);
runPnpm(["--dir", repoRoot, "--filter", "./apps/viewer", "run", "build"]);
runPnpm([
  "--dir",
  cliRoot,
  "exec",
  "vp",
  "pack",
  "src/index.ts",
  "--format",
  "esm",
  "--dts",
  "--banner.js",
  "#!/usr/bin/env node",
]);

await rm(embeddedViewer, { recursive: true, force: true });
await cp(viewerDist, embeddedViewer, { recursive: true });

function runPnpm(args) {
  run(packageManager.command, [...packageManager.prefixArgs, ...args]);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
