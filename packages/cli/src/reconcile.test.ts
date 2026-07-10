import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { assertCommitIntegrated } from "./reconcile.js";

const execFileAsync = promisify(execFile);
let root = "";
let integrated = "";
let unintegrated = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "qd-reconcile-git-"));
  await git("init", "-b", "main");
  await git("config", "user.email", "qd@example.test");
  await git("config", "user.name", "qd test");
  await writeFile(path.join(root, "main.txt"), "main\n", "utf8");
  await git("add", "main.txt");
  await git("commit", "-m", "main commit");
  integrated = (await git("rev-parse", "HEAD")).trim();
  await git("switch", "--orphan", "side");
  await writeFile(path.join(root, "side.txt"), "side\n", "utf8");
  await git("add", "side.txt");
  await git("commit", "-m", "side commit");
  unintegrated = (await git("rev-parse", "HEAD")).trim();
  await git("switch", "main");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("reconciliation git evidence", () => {
  it("accepts full and abbreviated commits integrated into HEAD", async () => {
    await expect(assertCommitIntegrated(root, integrated)).resolves.toBeUndefined();
    await expect(assertCommitIntegrated(root, integrated.slice(0, 7))).resolves.toBeUndefined();
  });

  it("rejects malformed, missing, and non-ancestor commits distinctly", async () => {
    for (const invalid of ["abc123", "g".repeat(7), "a".repeat(41), "HEAD", "abc 1234"]) {
      await expect(assertCommitIntegrated(root, invalid)).rejects.toThrow(
        "must be a 7-40 character hexadecimal git commit SHA",
      );
    }
    await expect(assertCommitIntegrated(root, "deadbee")).rejects.toThrow(
      "Git commit does not exist: deadbee",
    );
    await expect(assertCommitIntegrated(root, unintegrated)).rejects.toThrow(
      `Git commit ${unintegrated} is not integrated into the current HEAD`,
    );
  });
});

async function git(...args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd: root })).stdout;
}
