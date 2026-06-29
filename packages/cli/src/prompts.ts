export function promptText(
  kind: string,
  node?: unknown,
  extras: { projectRules?: string; auditDiffCommand?: string; gateContext?: unknown } = {},
): string {
  const realityContract = `Reality contract:
- Do not invent APIs, URLs, schemas, credentials, command output, CI status, files, or evidence.
- Research product, integration, environment, credential, provider, data, deployment, and runtime facts before creating implementation nodes that depend on them.
- If a required real-world surface cannot be reached, record a typed blocker or research gap. Do not downgrade it to polish.
- Mock-only or synthetic validation is insufficient for real integration work unless the spec explicitly targets a mock, fixture, or adapter boundary.
- Completion means ready for independent audit; it does not mean correct, merged, or safe.
- Audit is evidence review against the spec and acceptance criteria. CI is a separate gate, not the audit.`;

  if (kind === "plan") {
    return `Build a qd DAG from mergeable, evidence-driven nodes.

${realityContract}

Rules:
- Perform product/integration research before roadmap shape. Unknown APIs, provider behavior, credentials, schemas, data access, deployment paths, and environment requirements become research/blocker nodes first.
- Split by independently mergeable behavior, not files or layers.
- Add requires edges only for true technical prerequisites.
- Every implementation node needs concrete spec, non-goals, acceptance, declared verification, expected evidence, audit focus, risk, priority, and estimate.
- Use milestones for externally meaningful capability phases with entry criteria, exit criteria, and validation nodes. Use edges for dependency truth.
- Do not create vague nodes such as "figure out provider integration". Research first, then create the exact implementable nodes.
- Mark unresolved unknowns as research nodes or blockers with explicit required outputs.`;
  }

  if (kind === "research") {
    return `Research before building or revising the qd DAG.

${realityContract}

Produce a structured research report:
- docs, source files, provider dashboards, schemas, or examples inspected
- real endpoint URLs, SDK calls, command interfaces, or database schemas verified
- credential, network, data, and environment requirements verified
- real response samples, fixtures, dumps, screenshots, logs, or contracts captured
- failure modes and rate/permission/deployment limits identified
- unresolved unknowns and the blocker/research nodes they require
- proposed implementation nodes only after the facts above are settled

If the target environment is unavailable, stop and record the exact blocker. Do not create implementation specs that rely on guesses.`;
  }

  if (kind === "reality-check") {
    return `Run a qd DAG reality check.

${realityContract}

Inspect the current roadmap and project state:
- Are any ready or in-progress nodes based on unverified API, schema, URL, credential, deployment, or data assumptions?
- Are environment/provider failures being hidden as P2/P3 findings instead of blockers or P1 issues?
- Are milestones still externally meaningful, with proven exit criteria and validation nodes?
- Are specs independently verifiable, or do they need splitting/research/blockers?
- Are audits reviewing evidence, or only summaries and passing tests?
- Are check and CI commands still the repository's real gates?

Create findings or graph edits for every mismatch. If the graph is wrong, fix the graph before delegating more work.`;
  }

  if (kind === "repo-audit") {
    return `Run a general repository audit after roughly 10 merged qd nodes or after any broad risk event.

${realityContract}

Audit the whole codebase, not one spec:
- correctness and user-visible behavior
- integration/API/data assumptions
- test quality and untested critical paths
- build, CI, packaging, migration, and deployment health
- duplicate code, brittle abstractions, stale docs, and operational gaps
- warnings, known failures, flaky tests, and "pre-existing" issues

Every real finding enters qd as a structured finding or new DAG node. Do not rubber-stamp the repo because spec-level audits passed.`;
  }

  if (kind === "dag-review") {
    return `Review and revise the qd DAG after roughly 30 merged nodes or whenever reality changes.

${realityContract}

Review:
- milestone names, ranks, entry criteria, exit criteria, and validation nodes
- whether dependencies reflect true technical prerequisites
- whether ready nodes are still worth doing as written
- whether completed work actually satisfies the intended product state
- whether blockers, findings, and promoted nodes are classified correctly
- whether research has gone stale or new product/API facts require replanning

Return concrete qd edits: nodes to split, cancel, supersede, block, unblock, promote, or add.`;
  }

  if (kind === "audit") {
    return `Audit the node against its spec and acceptance criteria.

${realityContract}

Create structured findings:
- P0: security/data loss/build break/core behavior failure.
- P1: important regression, missing required acceptance, missing required real-world validation, or environment/provider/credential issue that blocks required validation.
- P2: non-blocking follow-up that should become a new node.
- P3: polish or future improvement.

Audit requirements:
- Inspect the diff or changed artifact, not just the implementer's summary.
- Check every acceptance criterion one by one.
- Inspect completion evidence, verification logs, screenshots, API responses, fixtures, CI logs, or deployment artifacts.
- Confirm mock/stub usage is explicitly allowed by the spec.
- Treat missing evidence for required acceptance as P1.
- Treat "this probably works but the environment failed" as a blocker/P1 unless the node was pre-scoped away from that environment.

Use qd finding add for each issue. P0/P1 block qd gate. P2/P3 must be promoted or disposed before merge.
Record a clean audit with: qd audit pass <node> --from-report <audit-report.json>
Record a failed audit with: qd audit fail <node> --from-report <audit-report.json>
${extras.auditDiffCommand ? `\nDiff command:\n${extras.auditDiffCommand}\n` : ""}
${extras.projectRules ? `\nProject rules:\n${extras.projectRules.trim()}\n` : ""}
${extras.gateContext ? `\nCurrent gate state:\n${JSON.stringify(extras.gateContext, null, 2)}\n` : ""}
Node context:
${node ? JSON.stringify(node, null, 2) : "Run qd prompt audit <node> for node-specific context."}`;
  }

  if (kind === "resolve") {
    return `Resolve only open P0/P1 findings for this node.

${realityContract}

Protocol:
- Inspect qd prompt implement <node> and current findings.
- Make the smallest fix that satisfies the finding.
- Re-run the real verification required by the affected acceptance criteria.
- If the finding exposes a wrong spec, missing research, or unavailable environment, update/block/split the DAG instead of pretending the code fix is complete.
- Mark each fixed finding with qd finding resolve.
- Re-run qd gate <node> --phase ci before CI.`;
  }

  return `Implement the claimed qd node.

${realityContract}

Protocol:
- Confirm the node was already selected and claimed by the orchestrator.
- Use qd node show <node> --full --json or qd prompt implement <node> --json for scoped context.
- Respect requires edges; do not work blocked nodes.
- Use the node spec and acceptance as the scope boundary.
- Before coding, verify any required API, URL, credential, schema, data, deployment, or environment fact is already known and available.
- If required reality is unavailable or unknown, stop and return a structured blocker/research gap to the orchestrator. Do not build against invented behavior.
- Run declared verification and preserve evidence. If validation fails because of environment/provider/credential state, block the node instead of completing it.
- Record completion only with evidence that each acceptance criterion was exercised or with a graph update explaining why honest completion is impossible.
- If the node declares verification, record evidence with qd verification sign-off, qd verification run, or the structured completion report expected by this project.
- If qd gate reports nodeBlocked, stop and return the blocker reason to the orchestrator.
- Prefer --json when parsing command output.
${extras.projectRules ? `\nProject rules:\n${extras.projectRules.trim()}\n` : ""}
${extras.gateContext ? `\nCurrent gate state:\n${JSON.stringify(extras.gateContext, null, 2)}\n` : ""}

Node context:
${node ? JSON.stringify(node, null, 2) : "Run qd prompt implement <node> for node-specific context."}`;
}

export const skillText = `# qd DAG

Use qdcli when project work is too large for one agent pass and too risky to coordinate by memory. qd is not an agent runtime. It is the strict evidence ledger for one central orchestrator agent: what is ready, what is blocked, what has been proven, what has been audited, and what is safe to merge.

Read the repository's qd orchestration method before creating or advancing work. qd's method is not optional: research precedes roadmap, specs are executable contracts, completion requires evidence, audits review evidence, environment/provider/credential failures are blockers, and main stays green.

At setup and after every qd upgrade, run:

\`\`\`sh
qd method show
qd method acknowledge --agent <orchestrator-name>
qd method status --json
\`\`\`

Do not work around an acknowledgement failure. It means the active orchestrator
has not acknowledged the current qd method hash.

## Reality Contract

- Do not invent APIs, URLs, schemas, credentials, command output, CI status, files, or evidence.
- Do not create implementation nodes for unknown integrations. Research real product/API/data/environment behavior first, then create exact implementable nodes.
- If required real-world validation cannot run, record a typed blocker or research gap and move to unrelated ready work.
- Mock-only validation is insufficient for real integration work unless the spec explicitly targets a mock, fixture, or adapter boundary.
- Completion means ready for independent audit. It does not mean correct, merged, or safe.
- Audit means checking diff, acceptance, and evidence. CI is a separate gate, not an audit.
- P0/P1 findings block the current node. P2/P3 findings become future DAG shape or require explicit disposition.

## Setup Expectations

Configure qd for the repository's real definition of green:

\`\`\`sh
qd config set check-command "<fast project check command>"
qd config set ci-command "<full trusted merge gate>"
qd config set merge-strategy "squash"
qd config get ci-command
\`\`\`

Use qd templates instead of inventing report JSON:

\`\`\`sh
qd template completion-report > /tmp/completion-report.json
qd template audit-report > /tmp/audit-report.json
qd template blocker-report > /tmp/blocker-report.json
\`\`\`

\`check_command\` is a fast preflight. \`ci_command\` is the full trusted gate; weak CI commands make qd state dishonest. Provider polling is adapter-based. GitHub through \`gh\` is one adapter, not qd's worldview.

Treat \`.qd/qd.db\` as a local cache. Commit deterministic JSON exports:

\`\`\`sh
qd export --deterministic --out roadmap/spec-dag.json
qd sync --from roadmap/spec-dag.json --dry-run --json
qd sync --from roadmap/spec-dag.json --expect-clean --json
\`\`\`

## Planning Protocol

- Run \`qd prompt research\` before planning provider/API/database/deployment/browser/runtime work.
- Run \`qd prompt plan\` to create mergeable, evidence-driven nodes.
- Use milestones for externally meaningful capability phases with exit criteria and validation nodes.
- Use edges only for true technical prerequisites.
- Every implementation node needs concrete acceptance, declared verification, expected evidence, audit focus, risk, and known real-world dependencies.
- Unknown API behavior, missing credentials, unavailable data, or unclear environment state becomes research/blocker work, not a vague implementation spec.

## Orchestration Protocol

1. Run \`qd doctor --json\`, \`qd status --json\`, \`qd ready --json\`, and \`qd snapshot --json\`.
2. The orchestrator selects ready nodes; workers do not independently pop arbitrary work.
3. Claim delegated work with \`qd claim <node> --agent <name> --branch <branch>\`.
4. Delegate \`qd prompt implement <node> --json\` plus project rules.
5. If implementation cannot validate required reality, block/split/research the node instead of completing it.
6. Record completion only with structured evidence for the acceptance criteria.
7. Start independent audit. Use \`qd prompt audit <node>\`; auditors inspect diff, acceptance, and evidence.
8. Missing required evidence, unreachable required API/provider/environment, or unverified acceptance is P1 unless the spec explicitly excludes that surface.
9. Resolve P0/P1 findings before check/CI. Promote or dispose P2/P3 findings before merge.
10. Run \`qd gate <node> --phase ci --json\`, \`qd check run <node>\`, then \`qd ci run <node>\` or \`qd ci poll <node>\`.
11. Perform the real repository merge through the repo workflow, then record \`qd merge <node> --use-existing-commit <sha>\`.

Never bypass the ready queue. If the graph is wrong, fix the graph.

## Periodic Reality Checks

- After about 10 merged nodes, run \`qd prompt repo-audit\` and add every real finding to qd.
- After about 30 merged nodes, run \`qd prompt dag-review\` or \`qd prompt reality-check\` and revise the roadmap.
- Run an immediate reality check after any major API, provider, schema, credential, environment, CI, deployment, or product assumption fails.
`;
