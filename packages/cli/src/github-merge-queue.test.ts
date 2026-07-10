import { describe, expect, it } from "vite-plus/test";
import { parseGitHubMergeQueueObservation } from "./github-merge-queue.js";

describe("GitHub merge-queue model", () => {
  it("parses queue membership, position, speculative SHA, and auto-merge intent", () => {
    expect(
      parseGitHubMergeQueueObservation(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                isInMergeQueue: true,
                isMergeQueueEnabled: true,
                autoMergeRequest: { enabledAt: "2026-07-10T00:00:00Z", mergeMethod: "SQUASH" },
                mergeQueueEntry: {
                  id: "MQE_1",
                  position: 2,
                  state: "AWAITING_CHECKS",
                  enqueuedAt: "2026-07-10T00:00:00Z",
                  estimatedTimeToMerge: 90,
                  headCommit: { oid: "merge-group-sha" },
                  baseCommit: { oid: "base-sha" },
                  mergeQueue: { url: "https://github.com/o/r/queue/main" },
                },
              },
            },
          },
        }),
      ),
    ).toEqual({
      enabled: true,
      inQueue: true,
      autoMergeEnabled: true,
      autoMergeEnabledAt: "2026-07-10T00:00:00Z",
      entry: {
        id: "MQE_1",
        position: 2,
        state: "AWAITING_CHECKS",
        enqueuedAt: "2026-07-10T00:00:00Z",
        estimatedTimeToMerge: 90,
        headCommitOid: "merge-group-sha",
        baseCommitOid: "base-sha",
        queueUrl: "https://github.com/o/r/queue/main",
      },
    });
  });

  it("distinguishes a queue-enabled PR that has not been enqueued", () => {
    expect(
      parseGitHubMergeQueueObservation(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                isInMergeQueue: false,
                isMergeQueueEnabled: true,
                autoMergeRequest: null,
                mergeQueueEntry: null,
              },
            },
          },
        }),
      ),
    ).toEqual({
      enabled: true,
      inQueue: false,
      autoMergeEnabled: false,
      autoMergeEnabledAt: null,
      entry: null,
    });
  });

  it("rejects malformed queue positions instead of guessing", () => {
    expect(() =>
      parseGitHubMergeQueueObservation(
        JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                isInMergeQueue: true,
                isMergeQueueEnabled: true,
                autoMergeRequest: null,
                mergeQueueEntry: {
                  id: "MQE_1",
                  position: -1,
                  state: "QUEUED",
                  enqueuedAt: "2026-07-10T00:00:00Z",
                },
              },
            },
          },
        }),
      ),
    ).toThrow("non-negative integer");
  });
});
