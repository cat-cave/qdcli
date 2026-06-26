#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const packagePaths = [
  "package.json",
  "packages/core/package.json",
  "packages/cli/package.json",
  "apps/viewer/package.json",
];
const bump = process.argv[2] ?? "patch";
const allowedBumps = new Set(["patch", "minor", "major"]);

const rootPackage = readJson("package.json");
const currentVersion = stringValue(rootPackage.version, "package.json version");
const nextVersion = allowedBumps.has(bump)
  ? bumpVersion(currentVersion, bump)
  : assertVersion(bump);
if (nextVersion === currentVersion) throw new Error(`Version is already ${nextVersion}`);

for (const packagePath of packagePaths) {
  const packageJson = readJson(packagePath);
  packageJson.version = nextVersion;
  writeJson(packagePath, packageJson);
}

updateChangelog(currentVersion, nextVersion);
exec("corepack", ["pnpm", "install", "--lockfile-only"]);

console.log(`Prepared qdcli v${nextVersion}`);
console.log("Next: run `just release-check`, then commit, tag, and push.");

function bumpVersion(version, releaseType) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Cannot ${releaseType}-bump non-semver version: ${version}`);
  const [, majorRaw, minorRaw, patchRaw] = match;
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  const patch = Number(patchRaw);
  if (releaseType === "major") return `${major + 1}.0.0`;
  if (releaseType === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function assertVersion(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`Expected patch|minor|major or an exact x.y.z version, got: ${value}`);
  }
  const [currentMajor, currentMinor, currentPatch] = currentVersion.split(".").map(Number);
  const [nextMajor, nextMinor, nextPatch] = value.split(".").map(Number);
  const current = currentMajor * 1_000_000 + currentMinor * 1_000 + currentPatch;
  const next = nextMajor * 1_000_000 + nextMinor * 1_000 + nextPatch;
  if (next <= current)
    throw new Error(`Next version ${value} must be greater than ${currentVersion}`);
  return value;
}

function updateChangelog(fromVersion, toVersion) {
  const changelogPath = path.join(repoRoot, "CHANGELOG.md");
  const previous = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "";
  const releaseDate = new Date().toISOString().slice(0, 10);
  const previousTag = latestTag();
  const commits = releaseCommits(previousTag).filter(
    (line) => !/^Release v\d+\.\d+\.\d+$/.test(line),
  );
  const body =
    commits.length > 0
      ? commits.map((line) => `- ${line}`).join("\n")
      : `- Release maintenance for v${toVersion}.`;
  const parsed = parseChangelog(previous);
  const entry = `## v${toVersion} - ${releaseDate}\n\n${body}\n`;
  const next = `${parsed.header}${entry}\n${parsed.releases}`.trimEnd() + "\n";
  writeFileSync(changelogPath, next, "utf8");
  console.log(`Updated CHANGELOG.md from ${fromVersion} to ${toVersion}`);
}

function parseChangelog(previous) {
  if (!previous.trim()) {
    return {
      header: "# Changelog\n\nAll notable qdcli changes are recorded here.\n\n",
      releases: "",
    };
  }
  if (!previous.startsWith("# Changelog\n")) {
    return {
      header: "# Changelog\n\nAll notable qdcli changes are recorded here.\n\n",
      releases: `${previous.trim()}\n`,
    };
  }
  const firstRelease = previous.search(/^## /m);
  if (firstRelease === -1) {
    const header = previous.endsWith("\n\n") ? previous : `${previous.trimEnd()}\n\n`;
    return { header, releases: "" };
  }
  const header = previous.slice(0, firstRelease).trimEnd() + "\n\n";
  const releases = previous.slice(firstRelease).trim();
  return { header, releases: releases ? `${releases}\n` : "" };
}

function latestTag() {
  try {
    return exec("git", ["describe", "--tags", "--abbrev=0"]).trim();
  } catch {
    return "";
  }
}

function releaseCommits(previousTag) {
  const range = previousTag ? `${previousTag}..HEAD` : "HEAD";
  try {
    return exec("git", ["log", range, "--pretty=format:%s"])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readJson(packagePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, packagePath), "utf8"));
}

function writeJson(packagePath, value) {
  writeFileSync(path.join(repoRoot, packagePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stringValue(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${label}`);
  return value;
}

function exec(command, args) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}
