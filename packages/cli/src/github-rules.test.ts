import { describe, expect, it } from "vite-plus/test";
import {
  evaluateRequiredChecks,
  parseAppliedBranchRules,
  parseClassicBranchProtection,
} from "./github-rules.js";

describe("GitHub branch-rule check policy", () => {
  it("derives required contexts and merge-queue mode from effective branch rules", () => {
    expect(
      parseAppliedBranchRules(
        JSON.stringify([
          {
            type: "required_status_checks",
            parameters: {
              strict_required_status_checks_policy: false,
              required_status_checks: [
                { context: "Tier 0 / required", integration_id: 15368 },
                { context: "Tier policy / required", integration_id: null },
              ],
            },
          },
          { type: "merge_queue", parameters: { merge_method: "SQUASH" } },
        ]),
      ),
    ).toEqual({
      source: "ruleset",
      requiredChecks: [
        { context: "Tier 0 / required", integrationId: 15368 },
        { context: "Tier policy / required", integrationId: null },
      ],
      strict: false,
      mergeQueueEnabled: true,
    });
  });

  it("supports classic branch protection as a compatibility source", () => {
    expect(
      parseClassicBranchProtection(
        JSON.stringify({
          strict: true,
          checks: [{ context: "ci", app_id: 1 }],
          contexts: ["legacy"],
        }),
      ),
    ).toEqual({
      source: "branch-protection",
      requiredChecks: [{ context: "ci", integrationId: 1 }],
      strict: true,
      mergeQueueEnabled: false,
    });
  });

  it("trusts the required top-level policy check without interpreting conditional internals", () => {
    const checks = evaluateRequiredChecks(
      [{ context: "Tier policy / required", integrationId: null }],
      [
        {
          name: "Tier policy / required",
          status: "completed",
          conclusion: "success",
          detailsUrl: "https://example.test/policy",
          appId: 1,
          appName: "github-actions",
          startedAt: "2026-07-10T00:00:00Z",
          completedAt: "2026-07-10T00:01:00Z",
        },
        {
          name: "Tier 2 / conditional implementation detail",
          status: "completed",
          conclusion: "skipped",
          detailsUrl: "",
          appId: 1,
          appName: "github-actions",
          startedAt: "2026-07-10T00:00:00Z",
          completedAt: "2026-07-10T00:01:00Z",
        },
      ],
      [],
    );
    expect(checks).toEqual([
      {
        bucket: "pass",
        name: "Tier policy / required",
        state: "SUCCESS",
        link: "https://example.test/policy",
        workflow: "github-actions",
        required: true,
        source: "check-run",
      },
    ]);
  });

  it("makes missing required contexts explicit", () => {
    expect(
      evaluateRequiredChecks([{ context: "Tier 1 / required", integrationId: null }], [], []),
    ).toEqual([
      expect.objectContaining({
        name: "Tier 1 / required",
        bucket: "pending",
        state: "EXPECTED",
        source: "missing",
      }),
    ]);
  });
});
