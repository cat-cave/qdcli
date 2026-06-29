import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { requiresMethodAcknowledgement } from "./command-gates.js";
import {
  METHOD_TEXT,
  METHOD_VERSION,
  acknowledgeMethod,
  methodHash,
  methodStatus,
  requireMethodAcknowledged,
} from "./method.js";
import { reportTemplate, templateNames } from "./report-templates.js";

describe("method acknowledgement and template contracts", () => {
  it("classifies read-only and mutation commands exactly", () => {
    const readOnlyCases: Array<[string, string | undefined, Record<string, boolean>]> = [
      ["init", undefined, {}],
      ["setup", undefined, {}],
      ["doctor", undefined, {}],
      ["migrate", undefined, {}],
      ["upgrade", undefined, {}],
      ["status", undefined, {}],
      ["ready", undefined, {}],
      ["graph", undefined, {}],
      ["validate", undefined, {}],
      ["config", "set", {}],
      ["export", undefined, {}],
      ["workspace", "ready", {}],
      ["policy", "evaluate", {}],
      ["velocity", undefined, {}],
      ["critical-path", undefined, {}],
      ["eta", undefined, {}],
      ["stats", undefined, {}],
      ["snapshot", undefined, {}],
      ["prompt", "plan", {}],
      ["agent", "install", {}],
      ["view", undefined, {}],
      ["env", "check", {}],
      ["schema", "print", {}],
      ["template", "completion-report", {}],
      ["method", "acknowledge", {}],
      ["diff", "node-id", {}],
      ["gate", "node-id", {}],
      ["completion-ready", "node-id", {}],
      ["merge-ready", "node-id", {}],
      ["import", undefined, { "dry-run": true }],
      ["sync", undefined, { "dry-run": true }],
      ["sync", undefined, { "expect-clean": true }],
      ["node", "show", {}],
      ["node", "list", {}],
      ["node", undefined, {}],
      ["edge", "list", {}],
      ["note", "list", {}],
      ["run", "show", {}],
      ["run", "list", {}],
      ["audit", "validate", {}],
      ["audit", "list", {}],
      ["finding", "list", {}],
      ["verification", "list", {}],
      ["verification", "validate", {}],
      ["milestone", "status", {}],
      ["milestone", "next", {}],
    ];
    for (const [group, action, options] of readOnlyCases) {
      expect(requiresMethodAcknowledgement(group, action, options), `${group} ${action}`).toBe(
        false,
      );
    }

    const mutationCases: Array<[string, string | undefined]> = [
      ["import", undefined],
      ["sync", undefined],
      ["node", "add"],
      ["node", "edit"],
      ["node", "cancel"],
      ["nodes", "add-bulk"],
      ["edge", "add"],
      ["edge", "remove"],
      ["note", "add"],
      ["run", "cancel"],
      ["run", "supersede"],
      ["audit", "start"],
      ["audit", "pass"],
      ["audit", "fail"],
      ["audit", "dispose"],
      ["finding", "add"],
      ["finding", "resolve"],
      ["finding", "dispose"],
      ["finding", "promote"],
      ["verification", "record"],
      ["verification", "run"],
      ["verification", "sign-off"],
      ["claim", "node-id"],
      ["complete", "node-id"],
      ["advance", "node-id"],
      ["check", "run"],
      ["ci", "run"],
      ["ci", "record-pass"],
      ["ci", "fail"],
      ["merge", "node-id"],
      ["block", "node-id"],
      ["unblock", "node-id"],
      ["group", "register"],
      ["project", "register"],
      ["milestone", "register"],
      ["state", "rebuild"],
      ["state", "reconcile"],
      ["assignment", "add"],
      ["wave", "start"],
      ["plan", "import"],
    ];
    for (const [group, action] of mutationCases) {
      expect(requiresMethodAcknowledgement(group, action, {}), `${group} ${action}`).toBe(true);
    }
  });

  it("publishes exact report template names and representative required fields", () => {
    expect(templateNames()).toEqual([
      "audit-report",
      "blocker-report",
      "completion-report",
      "finding",
      "milestone",
      "reality-check",
      "research-report",
      "spec",
      "unblock-report",
    ]);
    expect(reportTemplate("completion-report")).toEqual({
      nodeId: "node-id",
      summary: "Implemented the node and verified every acceptance criterion listed below.",
      changedFiles: ["src/example.ts"],
      commits: [],
      acceptanceEvidence: [
        {
          criterion: "The real integration returns a typed success response.",
          status: "passed",
          evidence: "reports/node-id/provider-smoke.md",
        },
      ],
      commandsRun: [
        {
          command: "just ci",
          status: "passed",
          evidence: "logs/node-id/just-ci.log",
        },
      ],
      evidence: ["reports/node-id/completion.md"],
      realWorldValidation: {
        required: true,
        status: "passed",
        evidence: "reports/node-id/live-smoke.md",
      },
      unverifiedItems: [],
      dagChangesNeeded: [],
    });
    expect(reportTemplate("audit-report")).toMatchObject({
      nodeId: "node-id",
      verificationEvidence: {
        diffReviewed: true,
        completionReportReviewed: true,
        verificationEvidenceReviewed: true,
      },
      findings: [],
    });
    expect(reportTemplate("blocker-report")).toEqual({
      nodeId: "node-id",
      type: "credential",
      reason: "The required provider API key is expired in the local and CI environments.",
      owner: "project-owner",
      needed: "Rotate the provider API key and confirm the smoke command reaches the provider.",
      evidence: "reports/node-id/provider-auth-failure.md",
    });
    expect(reportTemplate("finding")).toEqual({
      severity: "P1",
      title: "Required real-world validation did not pass",
      evidence: "The smoke command failed against the configured provider endpoint.",
      observed: "The provider returned 404 for the configured URL.",
      expected: "The node should call the verified provider URL and parse the documented response.",
      classification: "provider",
      reproduction: "node scripts/provider-smoke.mjs",
      acceptanceCriterion: "Provider smoke succeeds against the configured endpoint.",
      suggestedFix: "Use the verified base URL from the research report and rerun the smoke test.",
    });
    expect(reportTemplate("unblock-report")).toEqual({
      nodeId: "node-id",
      summary:
        "Provider credential was rotated and the smoke command now reaches the real endpoint.",
      evidence: "reports/node-id/provider-smoke-after-rotation.md",
    });
    expect(reportTemplate("reality-check")).toEqual({
      summary:
        "Reviewed whether the DAG still matches product, API, environment, and implementation reality.",
      findings: [],
      dagChangesNeeded: [
        "Split node provider-integration into research, smoke, parser, and error-path nodes.",
      ],
    });
    expect(reportTemplate("milestone")).toEqual({
      name: "baseline",
      rank: 10,
      capability: "The smallest externally meaningful capability slice.",
      entryCriteria: ["Research reports for external integrations are complete."],
      exitCriteria: [
        "Every node in the milestone is merged with trusted CI green.",
        "A real-world demo or smoke validation proves the capability works.",
      ],
      requiredValidationNodes: ["baseline-reality-check"],
      realWorldDemo: "Run the baseline smoke/demo against the intended environment.",
      nonGoals: ["Alpha polish", "Scale testing"],
    });
    expect(reportTemplate("spec")).toEqual({
      objective: "Implement one independently auditable behavior using verified project facts.",
      nonGoals: ["Unverified provider behavior", "Broad unrelated refactors"],
      acceptance: [
        "The behavior works in the intended runtime environment.",
        "Failure paths return typed errors without corrupting state.",
      ],
      verification: [
        {
          type: "command",
          value: "just ci",
        },
      ],
      realWorldDependencies: ["List only dependencies this node truly requires."],
      environmentRequirements: ["List credentials, services, or host conditions required."],
      requiredEvidence: ["Command log", "Real or fixture-backed response proof"],
      auditFocus: ["Acceptance evidence", "Failure behavior", "No invented APIs"],
      assumptions: [],
      rollbackOrRecovery: "Document how to revert or disable the behavior.",
    });
    expect(reportTemplate("research-report")).toEqual({
      sourcesInspected: [
        "provider docs: https://example.invalid/docs/api",
        "project config: src/provider/config.ts",
      ],
      environmentVerified: [
        "PROVIDER_API_KEY is present in CI secret inventory",
        "node scripts/provider-smoke.mjs reached the provider test endpoint",
      ],
      unresolvedUnknowns: [],
      resultingNodes: [
        {
          objective:
            "Call the provider test endpoint with the verified URL and parse the typed response.",
          nonGoals: ["Production-mode provider calls"],
          acceptance: [
            "Valid test credential returns a typed success response.",
            "Invalid credential returns a typed provider error.",
          ],
          verification: [
            {
              type: "command",
              value: "node scripts/provider-smoke.mjs",
            },
          ],
          realWorldDependencies: ["Provider test endpoint", "PROVIDER_API_KEY"],
          environmentRequirements: ["Network access to provider test endpoint"],
          requiredEvidence: ["Smoke command log", "Captured sanitized provider response fixture"],
          auditFocus: ["Provider URL", "Response parser", "Credential failure path"],
          assumptions: [],
          rollbackOrRecovery: "Disable the provider integration flag.",
        },
      ],
    });
    expect(() => reportTemplate("unknown")).toThrow(/Unknown template: unknown/);
  });

  it("records, validates, and rejects stale method acknowledgements", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qd-method-contract-"));
    try {
      expect(METHOD_VERSION).toBe("evidence-first-2026-06-29");
      expect(METHOD_TEXT).toContain("Research precedes roadmap");
      expect(methodHash()).toMatch(/^[a-f0-9]{64}$/);
      await expect(requireMethodAcknowledged(root, "node add")).rejects.toThrow(
        /method has not been acknowledged/,
      );
      expect(await methodStatus(root)).toMatchObject({ ok: false, acknowledgement: null });

      const acknowledgement = await acknowledgeMethod(root, {
        agent: "contract-test",
        note: "read it",
      });
      expect(acknowledgement).toMatchObject({
        version: METHOD_VERSION,
        hash: methodHash(),
        agent: "contract-test",
        note: "read it",
      });
      await expect(requireMethodAcknowledged(root, "node add")).resolves.toBeUndefined();
      expect(await methodStatus(root)).toMatchObject({
        ok: true,
        acknowledgement: { agent: "contract-test" },
      });

      await writeFile(
        path.join(root, ".qd", "method-acknowledgement.json"),
        `${JSON.stringify({
          version: "old",
          hash: "bad",
          acknowledged_at: "2026-01-01T00:00:00.000Z",
          agent: "stale",
          note: null,
        })}\n`,
        "utf8",
      );
      const stale = await methodStatus(root);
      expect(stale).toMatchObject({
        ok: false,
        acknowledgement: { version: "old", hash: "bad", agent: "stale" },
      });
      await expect(requireMethodAcknowledged(root, "node add")).rejects.toThrow(/stale/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
