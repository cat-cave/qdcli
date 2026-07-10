import { describe, expect, it } from "vite-plus/test";
import type { GitHubPrStatus } from "./github-pr.js";
import {
  monitorExitCode,
  monitorRows,
  statusIsNonFailing,
  type MonitorStatus,
} from "./github-ci-commands.js";

function status(checkState: GitHubPrStatus["checkState"]): GitHubPrStatus {
  return {
    ok: checkState === "pass",
    nodeId: "node-a",
    ledgerStatus: "review",
    repository: "o/r",
    pr: {
      number: 17,
      url: "https://github.com/o/r/pull/17",
      headRefName: "qd/node-a",
      headRefOid: "head",
      baseRefName: "main",
      baseRefOid: "base",
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      isDraft: false,
      state: "OPEN",
      mergedAt: null,
      mergeCommit: null,
    },
    checks: [],
    requiredChecksOnly: true,
    checkState,
    glyph: checkState === "pass" ? "✓" : checkState === "fail" ? "✗" : "?",
    behind: 2,
    mergeable: true,
    readyToMerge: false,
    evidenceUrl: "https://github.com/o/r/pull/17/checks",
  };
}

describe("GitHub CI monitor projections", () => {
  it("projects successful and unavailable statuses into compact rows", () => {
    const error: MonitorStatus = { nodeId: "node-b", ledgerStatus: "ci", error: "gh failed" };
    expect(monitorRows([status("pass"), error])).toEqual([
      {
        state: "✓",
        node: "node-a",
        pr: "#17",
        checks: "pass",
        behind: 2,
        mergeability: "CLEAN",
        ledger: "review",
      },
      { state: "?", node: "node-b", ledger: "ci", error: "gh failed" },
    ]);
  });

  it("distinguishes non-failing state from the process exit contract", () => {
    const error: MonitorStatus = { nodeId: "node-b", ledgerStatus: "ci", error: "gh failed" };
    expect(statusIsNonFailing(status("pass"))).toBe(true);
    expect(statusIsNonFailing(status("pending"))).toBe(true);
    expect(statusIsNonFailing(status("queued"))).toBe(true);
    expect(statusIsNonFailing(status("no_checks"))).toBe(true);
    expect(statusIsNonFailing(status("fail"))).toBe(false);
    expect(statusIsNonFailing(error)).toBe(false);
    expect(monitorExitCode([])).toBeUndefined();
    expect(monitorExitCode([status("pass")])).toBeUndefined();
    expect(monitorExitCode([status("pending")])).toBe(8);
    expect(monitorExitCode([status("queued")])).toBe(8);
    expect(monitorExitCode([status("no_checks")])).toBe(8);
    expect(monitorExitCode([status("fail")])).toBe(1);
    expect(monitorExitCode([status("pending"), status("fail")])).toBe(1);
    expect(monitorExitCode([error])).toBe(1);
  });
});
