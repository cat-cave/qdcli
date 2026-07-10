import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { installCliFixture, qd, qdJson, qdJsonAllowExit, root } from "./cli-e2e-fixtures.js";
import { installFakeGh, setupGithubNode } from "./github-pr-e2e-fixtures.js";

installCliFixture();

describe("qd GitHub merge queue orchestration", () => {
  it("suppresses queue-owned rebases and records the queue SHA asynchronously", async () => {
    const previousPath = process.env.PATH;
    try {
      await installFakeGh({ queueEnabled: true, behind: 3 });
      await setupGithubNode("queue-node");
      await qd("config", "set", "merge-queue-mode", "required");
      expect(await qdJson("sync-prs", "--json")).toMatchObject({
        nodes: [expect.objectContaining({ action: "advanced-to-mergeable" })],
      });

      const queued = await qdJson("merge", "queue-node", "--via-pr", "--json");
      expect(queued).toMatchObject({
        status: "queued",
        operation: "merge-queue-enqueue",
        asynchronous: true,
        merge_queue_entry_id: "MQE_17",
        merge_group_sha: "merge-group-sha",
      });
      expect(await qdJson("monitor", "--json")).toMatchObject({
        nodes: [
          {
            ledgerStatus: "queued",
            behind: 3,
            behindIgnoredByQueue: true,
            queue: {
              membership: "queued",
              position: 2,
              entryState: "AWAITING_CHECKS",
              checkState: "pass",
            },
          },
        ],
      });
      expect(await qdJson("sync-prs", "--rebase", "--json")).toMatchObject({
        nodes: [expect.objectContaining({ action: "queue-observation-updated" })],
      });
      expect(
        await qdJsonAllowExit("policy", "evaluate", "queue-node", "--phase", "merge", "--json"),
      ).toMatchObject({
        exitCode: undefined,
        json: expect.objectContaining({ ok: true, codes: ["queued"] }),
      });

      await writeFile(path.join(root, "pr-merged"), "merged", "utf8");
      const reconciled = await qdJson("queue", "sync", "queue-node", "--json");
      expect(reconciled).toMatchObject({
        ok: true,
        nodes: [
          expect.objectContaining({
            action: "reconciled-merged",
            commitSha: "def5678",
          }),
        ],
      });
      expect(reconciled.nodes[0].node.status).toBe("done");
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("batch-enqueues a wave and bisects its deterministic ejection cohort", async () => {
    const previousPath = process.env.PATH;
    try {
      await installFakeGh({ queueEnabled: true, mergeGroupCheckBucket: "fail" });
      await setupGithubNode("batch-a");
      for (const id of ["batch-b", "batch-c"]) {
        await qd(
          "node",
          "add",
          "--id",
          id,
          "--title",
          id,
          "--spec",
          "Run in a parallel worktree.",
          "--acceptance",
          "The orchestrator can batch and diagnose this PR.",
        );
        await qd("claim", id, "--agent", `worker-${id}`, "--branch", "spec/pr-node");
      }
      expect((await qdJson("sync-prs", "--json")).nodes.map((node: any) => node.action)).toEqual([
        "advanced-to-mergeable",
        "advanced-to-mergeable",
        "advanced-to-mergeable",
      ]);
      const monitored = await qdJsonAllowExit("monitor", "--json");
      expect(
        monitored.json.nodes.map((node: any) => ({
          id: node.nodeId,
          ledger: node.ledgerStatus,
          checks: node.checkState,
          detail: node.checks.map((check: any) => ({
            name: check.name,
            state: check.state,
            source: check.source,
          })),
          ready: node.readyToMerge,
          queue: node.queue.membership,
        })),
      ).toEqual(
        ["batch-a", "batch-b", "batch-c"].map((id) => ({
          id,
          ledger: "mergeable",
          checks: "pass",
          detail: [
            { name: "ci", state: "SUCCESS", source: "check-run" },
            { name: "alpha-proof", state: "SUCCESS", source: "check-run" },
          ],
          ready: true,
          queue: "not-enqueued",
        })),
      );
      expect((await qdJson("ready", "--mergeable", "--json")).map((node: any) => node.id)).toEqual([
        "batch-a",
        "batch-b",
        "batch-c",
      ]);

      const wave = await qdJson(
        "wave",
        "start",
        "--summary",
        "Two-node queue admission wave",
        "--json",
      );
      await qd("wave", "add-node", wave.id, "batch-a");
      await qd("wave", "add-node", wave.id, "batch-b");

      expect(
        await qdJson(
          "queue",
          "enqueue",
          "--all-ready",
          "--wave",
          wave.id,
          "--limit",
          "2",
          "--concurrency",
          "2",
          "--json",
        ),
      ).toMatchObject({
        ok: true,
        selected: 2,
        available: 2,
        wave: wave.id,
        concurrency: 2,
        nodes: [
          expect.objectContaining({ action: "enqueued" }),
          expect.objectContaining({ action: "enqueued" }),
        ],
      });
      await rm(path.join(root, "pr-queued"));
      const ejected = await qdJson("queue", "sync", "--json");
      expect(
        ejected.nodes
          .filter((entry: any) => entry.action === "ejected-to-fixing")
          .map((entry: any) => ({ action: entry.action, status: entry.node.status })),
      ).toEqual([
        { action: "ejected-to-fixing", status: "fixing" },
        { action: "ejected-to-fixing", status: "fixing" },
      ]);
      expect(await qdJson("queue", "bisect", "batch-a", "--json")).toMatchObject({
        mergeGroupSha: "merge-group-sha",
        candidates: [
          expect.objectContaining({ id: "batch-a", status: "fixing" }),
          expect.objectContaining({ id: "batch-b", status: "fixing" }),
        ],
        rounds: [
          [
            expect.objectContaining({ ids: ["batch-a"] }),
            expect.objectContaining({ ids: ["batch-b"] }),
          ],
        ],
      });
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("drains only the captured queue wave, ignoring unrelated blockers", async () => {
    const previousPath = process.env.PATH;
    try {
      await installFakeGh({ queueEnabled: true });
      await setupGithubNode("drain-node");
      await qd(
        "node",
        "add",
        "--id",
        "unrelated",
        "--title",
        "Unrelated blocker",
        "--spec",
        "Track an independent external dependency.",
        "--acceptance",
        "The independent dependency is resolved.",
      );
      await qd(
        "block",
        "unrelated",
        "--type",
        "external-dependency",
        "--reason",
        "Another wave is waiting.",
        "--owner",
        "external-team",
        "--needed",
        "Resolve the independent dependency.",
        "--evidence",
        "issue:42",
      );
      expect(await qdJson("sync-prs", "--json")).toMatchObject({
        ok: true,
        nodes: [{ nodeId: "drain-node", action: "advanced-to-mergeable" }],
      });
      await qdJson("queue", "enqueue", "drain-node", "--json");
      await writeFile(path.join(root, "pr-merged"), "merged", "utf8");

      const drained = await qdJson(
        "queue",
        "drain",
        "drain-node",
        "--interval",
        "1",
        "--timeout",
        "1",
        "--json",
      );
      expect(drained).toMatchObject({
        ok: true,
        timedOut: false,
        nodes: [{ id: "drain-node", status: "done" }],
      });
      expect(await qdJson("node", "show", "unrelated", "--json")).toMatchObject({
        status: "blocked",
      });
    } finally {
      process.env.PATH = previousPath;
    }
  });
});
