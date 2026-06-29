export function reportTemplate(name: string): Record<string, unknown> {
  const templates: Record<string, Record<string, unknown>> = {
    "completion-report": {
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
    },
    "audit-report": {
      nodeId: "node-id",
      acceptanceReviewed: [
        {
          criterion: "The real integration returns a typed success response.",
          status: "passed",
          evidence: "reports/node-id/provider-smoke.md",
        },
      ],
      verificationEvidence: {
        diffReviewed: true,
        completionReportReviewed: true,
        verificationEvidenceReviewed: true,
      },
      realWorldValidation: {
        required: true,
        status: "passed",
        evidence: "reports/node-id/live-smoke.md",
      },
      findings: [],
    },
    finding: {
      severity: "P1",
      title: "Required real-world validation did not pass",
      evidence: "The smoke command failed against the configured provider endpoint.",
      observed: "The provider returned 404 for the configured URL.",
      expected: "The node should call the verified provider URL and parse the documented response.",
      classification: "provider",
      reproduction: "node scripts/provider-smoke.mjs",
      acceptanceCriterion: "Provider smoke succeeds against the configured endpoint.",
      suggestedFix: "Use the verified base URL from the research report and rerun the smoke test.",
    },
    "blocker-report": {
      nodeId: "node-id",
      type: "credential",
      reason: "The required provider API key is expired in the local and CI environments.",
      owner: "project-owner",
      needed: "Rotate the provider API key and confirm the smoke command reaches the provider.",
      evidence: "reports/node-id/provider-auth-failure.md",
    },
    "unblock-report": {
      nodeId: "node-id",
      summary:
        "Provider credential was rotated and the smoke command now reaches the real endpoint.",
      evidence: "reports/node-id/provider-smoke-after-rotation.md",
    },
    "research-report": {
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
    },
    spec: {
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
    },
    milestone: {
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
    },
    "reality-check": {
      summary:
        "Reviewed whether the DAG still matches product, API, environment, and implementation reality.",
      findings: [],
      dagChangesNeeded: [
        "Split node provider-integration into research, smoke, parser, and error-path nodes.",
      ],
    },
  };
  const template = templates[name];
  if (!template) throw new Error(`Unknown template: ${name}`);
  return template;
}

export function templateNames(): string[] {
  return [
    "audit-report",
    "blocker-report",
    "completion-report",
    "finding",
    "milestone",
    "reality-check",
    "research-report",
    "spec",
    "unblock-report",
  ];
}
