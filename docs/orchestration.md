# qd Orchestration Method

qd is an evidence ledger for orchestrator-led software work. It is not a task
list, an agent runtime, or a place to record optimistic guesses. qd's roadmap
state has one intended shape: structured specs move through research,
implementation, independent audit, real verification, trusted CI, and merge
recording. If reality blocks a node, record the blocker and work somewhere else.

The target reader is an orchestrator agent. Human convenience is secondary to
making weak autonomous work hard to record as done.

## Method Acknowledgement

The qd method must be read before the orchestrator creates, advances, audits, or
merges roadmap work. This is not optional onboarding prose. The method is part
of the state machine contract.

The orchestrator should reread the method:

- at repository setup
- before the first DAG planning session
- before the first completion, audit, and merge
- after a qd upgrade changes the method version
- after about 10 merged nodes, before the repo audit
- after about 30 merged nodes, before the DAG reality review
- after any major API, provider, schema, credential, environment, CI,
  deployment, or product assumption fails

When qd asks for method acknowledgement, the agent should stop, read the method
text, and acknowledge the current version/hash. The correct response is never to
work around the acknowledgement gate.

## Non-Negotiables

- Research precedes roadmap for product, API, data, provider, deployment, and
  environment work.
- A spec is an executable contract. It is not a vague todo or a placeholder for
  future discovery.
- Completion means ready for independent audit. It does not mean correct,
  merged, or safe.
- Audit means evidence review against spec and acceptance. CI is not an audit.
- Environment, credential, provider, URL, schema, and data-access failures are
  blockers when the node depends on them. They are not P3 polish.
- Mock-only validation is insufficient for real integration work unless the spec
  explicitly says the node only targets a mock, fixture, or adapter boundary.
- Main stays green. Merge state is recorded only after trusted CI and the
  repository's real merge have happened.
- If the graph is wrong, fix the graph. Do not bypass the ready queue.
- There is no warning-only mode for the roadmap contract. Escape hatches must
  move the node into a more accurate state, such as blocked, split, cancelled,
  superseded, or research-required.

## Structured State

qd roadmap state should be structured wherever it affects orchestration. Free
text can explain a decision, but it should not be the decision.

The strict model uses typed contracts for:

- specs
- milestones
- research reports
- completion reports
- audit reports
- findings
- blockers and unblock evidence
- verification evidence
- reality checks and repo audits

If a command offers inline flags, those flags are just a convenience for
constructing the same structured state. They are not a weaker path. For example,
a blocker recorded with flags must still include type, reason, owner or
responsible party, needed action, scope, and evidence when available.

## Research Before Roadmap

Do not create implementation nodes for an integration until the relevant real
world is understood. For external APIs, SDKs, databases, queues, browsers,
deployment targets, authentication, or provider-specific behavior, the
orchestrator must first establish:

- documentation or source files inspected
- endpoint URLs, SDK entry points, schema names, or command interfaces verified
- authentication and credential requirements verified
- at least one real response, fixture, dump, schema, or contract captured
- local or CI environment requirements identified
- known failure modes listed
- unresolved unknowns either resolved or represented as blockers/research nodes

Bad node:

```text
Figure out Stripe integration.
```

Good research output:

```text
Stripe checkout sessions use POST /v1/checkout/sessions with test-mode API
keys. The project has STRIPE_SECRET_KEY in CI. A live smoke request against test
mode succeeded and returned the response shape captured in
reports/research/stripe-checkout-session.json. Implementation can split into
session creation, webhook signature verification, persistence, and UI handoff.
```

Good implementation node:

```text
Create checkout sessions against Stripe test mode using the verified SDK call.
Acceptance: valid price id returns a session id and hosted URL; invalid price id
returns a typed provider error without persisting a checkout. Verification:
integration smoke command exercises Stripe test mode and stores the response log.
```

If research cannot be completed because credentials, network, owner action, or
provider access is missing, block the research or implementation node with
typed blocker state. Do not complete it, and do not downgrade the issue.

## Good Specs

A qd spec must be small enough to implement, audit, verify, and merge
independently. It should describe one meaningful behavior change, not a file
layer or an aspirational feature area.

Every implementation spec should carry:

- objective
- non-goals
- acceptance criteria, each independently checkable
- verification steps or explicit manual evidence requirements
- real-world dependencies, including APIs, credentials, data, or environment
- expected evidence artifacts
- risk and blast radius
- audit focus
- assumptions, each already verified or blocked
- rollback or recovery notes when the change can affect live use

For integration-heavy work, the spec must point at the research evidence that
established the real API/provider/data/environment shape. If that evidence does
not exist yet, the implementation spec is premature.

Bad signs:

- acceptance criteria use words like "probably", "basic", "handle", or "etc."
- the node says "research", "figure out", or "investigate" while also claiming
  to be implementation
- the node depends on a real provider but has no provider evidence requirement
- the node can only be validated by an environment that is not available and not
  recorded as a blocker
- completion would rely on an agent's assertion rather than an artifact

The correct escape hatch for uncertainty is not a vague spec. It is a research
node, a blocker, or a split.

## Good Milestones

A milestone is a real capability phase, not a batch label. Use milestones for
externally meaningful readiness, and use dependency edges for execution order.

Every milestone should define:

- user-visible or operator-visible capability
- entry criteria
- exit criteria
- required validation nodes
- real-world demo or smoke evidence
- known non-goals
- rank relative to other milestones

Examples:

- `baseline`: the core local workflow runs end to end with representative
  fixtures and full local CI.
- `real-api-ready`: provider integration works against real test-mode APIs or
  captured provider fixtures whose provenance is recorded.
- `dogfood-ready`: the owner can use the workflow on a real project without
  manual database edits or undocumented setup.
- `release-ready`: install, migration, docs, CI, rollback, and publishing paths
  are proven.
- `continuous`: follow-up hardening, polish, and maintenance.

A milestone is not complete because its children are marked done. It is complete
when its exit criteria have been proven by validation nodes and evidence.

## Good Completion

Completion is a handoff to audit. It requires a completion report, not merely a
summary. A valid completion report should state:

- node id
- changed commits or files
- acceptance evidence matrix
- commands run and results
- real APIs, services, providers, databases, browsers, or deployment targets
  exercised
- evidence artifacts and logs
- unverified items
- assumptions that changed
- DAG changes needed

If unverified items remain, the normal next state is blocked, split, or revised,
not complete. `qd complete` should push back until the orchestrator records a
valid completion report or a structured blocker.

Completion evidence must map acceptance criteria to proof. A command log that
never exercises the relevant API, provider, deployment, UI, database, or runtime
surface does not prove that criterion. If the node is supposed to work in the
target environment, "not in this environment" is not completion evidence.

## Good Audits

An audit is independent review. It is not CI, and it is not a restatement of the
implementer's summary.

The auditor must inspect:

- the diff or changed artifact
- the node spec and every acceptance criterion
- the completion report
- command logs, CI logs, screenshots, API responses, fixtures, or other evidence
- real-world validation status for APIs, credentials, data, deployment, and
  runtime behavior
- mock/stub usage and whether it is allowed by the spec
- failure paths and regression risk

Missing evidence for required acceptance is a P1. An environment or credential
problem that prevents required validation is a blocker/P1, not a P3. A clean
audit report with missing real-world validation should be rejected unless the
spec explicitly scoped the node away from that real-world surface.

## Findings

Findings are structured defects or follow-up nodes. They must include:

- severity
- title
- affected acceptance criterion or policy
- observed behavior
- expected behavior
- exact evidence
- reproduction, command, diff path, log path, or inspection route
- classification: implementation, spec-gap, research-gap, environment,
  credential, provider, data, policy, or regression
- suggested disposition

P0/P1 findings block the current node. P2/P3 findings become future DAG shape or
must be explicitly disposed with rationale. Findings are not a comments section.

## Blockers

Blockers are the correct escape hatch when reality prevents honest progress.
They are structured state, not notes.

Valid blocker classes include:

- environment
- credential
- provider
- data
- manual
- policy
- external-dependency

A blocker should record:

- type
- reason
- owner
- needed action
- scope
- evidence
- notification status, when a notifier is configured

Example:

```text
type: credential
reason: Local API key expired; live provider validation cannot run.
owner: trevor
needed: Refresh API key and verify GET /v1/accounts succeeds.
scope: local
evidence: logs/provider-auth-401.log
```

Unblocking requires evidence that the condition changed. Do not set a blocked
node back to ready without recording why it is now valid to continue.

Blockers should notify the responsible channel when the project has a notifier
configured. qd should treat notification as an adapter concern, not a hard-coded
platform opinion. `ntfy` is a good first adapter because it is small and
language-agnostic; webhook, chat, email, and issue-comment adapters can follow.
Notification does not make the blocker less severe. It only ensures the right
owner sees it while the orchestrator moves to unrelated ready work.

## Periodic Reality Checks

Spec-level audits are not enough. The orchestrator must periodically examine
the whole project and the DAG itself.

Recommended cadence:

- after about 10 merged nodes: general repo audit
- after about 30 merged nodes: full DAG and milestone reality review
- immediately after any major API, provider, schema, environment, credential,
  CI, deployment, or product assumption fails

A repo audit asks whether the codebase is coherent, maintainable, tested, and
still aligned with the project. A DAG reality review asks whether the roadmap is
still the right roadmap.

Reality checks should inspect:

- whether any nodes are based on unverified assumptions
- whether milestone exit criteria still match the desired product state
- whether environment issues are being hidden as low-severity findings
- whether API schemas, URLs, credentials, and data sources are real
- whether audits are reviewing evidence or rubber-stamping output
- whether CI and verification commands still reflect the trusted project gate
- whether completed work actually works in the target environment

Reality-check findings enter the DAG like any other findings.

## Notifications

When a blocker requires owner or external action, a future qd notifier may send
the structured blocker to a configured adapter. Notification is not part of
correctness; the structured blocker is.

The first notifier should be small and adapter-based, such as ntfy.

Future adapters can include generic webhooks, Slack, Discord, email, or issue
comments. Unsupported notification targets should fail loudly.

## Method Acknowledgment

Agents forget or skip instructions. qd forces rereads of the method before
important mutations. The method has a version/hash. Mutating roadmap and
evidence commands refuse when the active orchestrator has not acknowledged the
current method.

Acknowledgment is not a promise that the agent is correct. It is a friction
point that makes the agent reload the operating doctrine before recording
important state.

## One Right Roadmap Model

qd is early alpha. Compatibility with weaker roadmap habits is not a goal. There
should not be a "strict mode" that users opt into. The strict, structured,
evidence-first model is qd.

Inline flags are acceptable only when they construct the same structured state
as file-backed reports. They must not create weaker semantics. If a command
cannot record the evidence needed for the next state, it should fail with an
actionable message that points to the correct structured path.
