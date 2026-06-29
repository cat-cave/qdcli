import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function cliVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const packagePath of [
    path.join(here, "..", "package.json"),
    path.join(here, "package.json"),
  ]) {
    try {
      const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.trim()) return parsed.version;
    } catch {
      // Development builds without a package manifest should not report a stale release.
    }
  }
  return "0.0.0-dev";
}

export function helpText(): string {
  return `qd - Quick DAG CLI

Global:
  qd --root <path> <command>
  QD_ROOT=/path/to/repo qd <command>

Core:
  qd init
  qd migrate
  qd setup [--no-hooks] [--print-agent-url]
  qd method show|status|acknowledge [--agent <name>]
  qd doctor [--strict] [--json]
  qd status [--json]
  qd stats [--json] [--window 7] [--milestone <name>]
  qd snapshot [--json] [--milestone <name>]
  qd ready [--json]
  qd graph --format table|json|mermaid|dot
  qd velocity [--window 7]
  qd critical-path [--milestone <name>]
  qd eta [--window 7] [--milestone <name>]
  qd help method|reality|specs|milestones|audits|blockers|evidence
  qd prompt plan|research|implement|audit|resolve|reality-check|repo-audit|dag-review [node] [--include-project-rules <path>] [--base main] [--diff-tool git|sem|inspect] [--json]
  qd template completion-report|audit-report|blocker-report|research-report|reality-check
  qd schema print <name>
  qd schema example <name>
  qd config show
  qd config get ci-command
  qd config set check-command "<fast project check command>"
  qd config set ci-provider github --repo owner/name --workflow ci.yml --auth gh-cli
  qd export [--out roadmap/spec-dag.json] [--deterministic]
  qd export --status ready,claimed,review --milestone alpha [--json]
  qd import --from roadmap/spec-dag.json [--schema-mapping qd-import-map.json] [--dry-run] [--verbose] [--merge]
  qd sync --from roadmap/spec-dag.json [--dry-run] [--expect-clean] [--write-diff sync-diff.json]
  qd import --from docs/ROADMAP.html --adapter roadmap-html [--dry-run]
  qd import --from roadmap.md --adapter markdown-checklist [--dry-run]
  qd workspace status|ready|graph [--json] [--config ~/.config/qd/workspaces.toml] [--repo <path>]
  qd policy evaluate <node> --phase ci|merge

Graph:
  qd node add --from-json <node.json>
  qd node add --title <text> --spec-file <path> --acceptance-file <path>
  qd nodes add-bulk --from-json <plan.json>
  qd node list|show|edit|cancel|note
  qd node show <id> --full
  qd node edit <id> --from-json <patch.json>
  qd node edit <id> --spec-file <path> --acceptance-file <path>
  qd block <id> --type environment|credential|provider|data|manual|policy|external-dependency --reason <text> --owner <name> --needed <text> --evidence <path-or-proof>
  qd unblock <id> --summary <text> --evidence <path-or-proof>
  qd note add <node> --text <text>
  qd group register --name <name>
  qd project register --name <name>
  qd milestone register --name <name> --rank <n>
  qd edge add <from> <to> [--type requires]
  qd claim [node] --agent <name> [--branch <branch>]
  qd complete <node> --from-report <completion-report.json>
  qd advance <node> --from-report <completion-report.json> [--merge --use-existing-commit <sha>]
  qd diff <node> [--base main] [--self-only] [--working] [--tool git|sem|inspect] [--format markdown|json|plain]
  qd worktree create <node> [--branch spec/<node>] [--path <path>] [--env-template .env.example] [--env KEY=value]
  qd worktree env <node> [--env-template .env.example] [--env KEY=value]

Audit:
  qd audit start <node>
  qd finding add <node> --severity P1 --title <text> --evidence <text>
  qd finding add [node] --from-report <audit-report.json>
  qd finding list [--open] [--severity P0,P1] [--node <id>]
  qd finding resolve <finding>
  qd promote-findings <node>
  qd gate <node> [--phase ci|merge]
  qd check run <node>
  qd ci run <node>
  qd ci poll <node> [--sha <commit>] [--provider github] [--repo owner/name] [--workflow ci.yml]
  qd ci record-pass <node> --summary <text> (--log-path <path>|--url <url>|--external-id <id>)
  qd verification sign-off <node> --type manual --note <text> [--evidence <path>]
  qd audit pass <node> --from-report <audit-report.json>
  qd merge <node> --use-existing-commit <sha>

Viewer:
  qd view [--host 127.0.0.1] [--port 5173] [--open] [--json]
  qd view --check [--json]`;
}

export function commandHelp(group: string, action?: string): string {
  const key = [group, action].filter(Boolean).join(" ");
  const entries: Record<string, string> = {
    complete:
      "qd complete <node> --from-report <completion-report.json>\nRecords evidence-backed implementation completion. Completion means ready for audit, not done.",
    method:
      "qd method show|status|acknowledge [--agent <name>] [--json]\nShows qd's strict method, records local acknowledgement, and gates mutation commands until the active method hash is acknowledged.",
    template:
      "qd template <completion-report|audit-report|blocker-report|unblock-report|research-report|reality-check|spec|milestone|finding>\nPrints a valid JSON starting point for agent-authored qd contracts.",
    schema:
      "qd schema list|print|example <name>\nPrints strict JSON schemas or copyable examples for qd contracts.",
    init: "qd init [--json]\nInitializes .qd, config, logs, and applies current DB migrations.",
    migrate:
      "qd migrate [--json]\nApplies pending qd DB schema migrations in place. Run this after upgrading qd when doctor reports stale schema.",
    import:
      "qd import --from <json> [--schema-mapping <json>] [--adapter roadmap-html|markdown-checklist] [--dry-run] [--verbose] [--allow-defaults] [--merge]\nImports non-qd DAGs or qd canonical exports with strict dry-run validation.",
    sync: "qd sync --from <qd-export.json> [--dry-run] [--expect-clean] [--write-diff <json>]\nValidates and optionally replaces the local qd cache from committed qd JSON.",
    advance:
      "qd advance <node> --from-report <completion-report.json> [--merge --use-existing-commit <sha>]\nRuns the evidence-backed lifecycle. It must not bypass audit, verification, CI, or real merge evidence.",
    check:
      "qd check run <node> [--cmd <command>] [--no-hooks]\nRuns the configured fast preflight and records a check run/log.",
    "check run":
      "qd check run <node> [--cmd <command>] [--no-hooks]\nMutates qd state with a passed or failed check run.",
    ci: "qd ci run|poll|record-pass|fail <node>\nRecords full trusted CI evidence. Passing CI makes a node mergeable.",
    "ci run":
      "qd ci run <node> [--cmd <command>] [--no-hooks]\nRuns the configured full CI command and records log evidence.",
    merge:
      "qd merge <node> [--strategy squash|merge|rebase] [--use-existing-commit <sha>] [--no-hooks]\nRecords qd merge state only; it does not run git merge or open a PR.",
    audit:
      "qd audit start|pass|fail|dispose|cancel|supersede|list <node>\nTracks audit run lifecycle and findings.",
    "audit pass":
      "qd audit pass <node> --from-report <audit-report.json> [--run-id <id>]\nCloses an audit run as passed, imports findings, blocks on P0/P1, promotes P2/P3.",
    assignment:
      "qd assignment add|complete|fail|cancel|list\nRecords opaque external worker/auditor ownership. qd does not launch agents.",
    wave: "qd wave start|add-node|add-assignment|complete|status\nRecords wave-level orchestration state.",
    policy:
      "qd policy evaluate <node> --phase ci|merge [--json]\nReports configured lifecycle policy violations as stable codes.",
    diff: "qd diff <node> [--base main] [--self-only] [--working] [--tool git|sem|inspect] [--format markdown|json|plain]\nPrints committed or worktree-local node diffs. git is built in; sem and inspect are explicit optional adapters and fail loudly when unavailable.",
    worktree:
      "qd worktree create|env|status|list|cleanup <node> [--base main]\nCreates git worktrees, records node branches, reports dirty/ahead/behind state, and writes worktree-local env files without storing env values in qd.",
    prompt:
      "qd prompt plan|research|implement|audit|resolve|reality-check|repo-audit|dag-review [node]\nPrints strict orchestration prompts with the qd reality contract.",
  };
  return entries[key] ?? entries[group] ?? helpText();
}

export function topicHelp(topic: string): string {
  const topics: Record<string, string> = {
    lifecycle:
      "qd lifecycle: ready -> claim -> evidence-backed complete -> independent audit -> gate -> check -> ci -> real repo merge -> qd merge record.\nP0/P1 findings, missing evidence, blockers, and running audits stop advancement.",
    audits:
      "qd audits: audit means independent evidence review against diff, spec, acceptance, verification, real-world validation, and failure paths. CI is not an audit. Missing required evidence is P1.",
    worktrees:
      "qd worktrees: use one branch/worktree per active node or assignment. qd refuses duplicate branch/path checkouts, reports dirty/ahead/behind state, can inject worktree-local env files, and never stores env values in DAG state.",
    diffs:
      "qd diffs: default to git patch output. Use --self-only for merge-base-to-branch audit context, --working for uncommitted worktree changes, --tool sem for entity-level diffs, and --tool inspect for explicit review triage when inspect-cli is installed.",
    assignments:
      "qd assignments: record role, owner, branch, worktree, scope, commits, and evidence. Owner strings are opaque and agent-agnostic.",
    waves:
      "qd waves: group nodes and assignments into orchestration waves, then complete the wave with a summary.",
    gates:
      "qd gates: qd gate blocks on open P0/P1 findings, running audit runs, explicit node blockers, and incomplete dependencies. Use qd gate <node> --phase ci|merge when deciding whether policy allows CI or merge.",
    policies:
      "qd policies: default policy requires audit before CI, declared verification before CI, P2/P3 disposition before merge, and a real merge commit recorded with qd merge.",
    method:
      "qd method: one strict roadmap model. Research precedes roadmap; specs are executable contracts; completion requires structured evidence; audits review evidence; environment/provider/credential/data failures are blockers; trusted CI and a real repo merge precede qd merge recording.",
    reality:
      "qd reality: Reality contract. never invent APIs, URLs, schemas, credentials, command output, CI status, files, or evidence. If required real-world validation cannot run, block, split, or research the node instead of completing or passing audit.",
    specs:
      "qd specs: good specs are small, independently mergeable, acceptance-driven, evidence-backed, and based on verified product/API/environment facts. Unknown integrations require research before implementation nodes.",
    milestones:
      "qd milestones: use milestones for externally meaningful capability phases with entry criteria, exit criteria, and validation nodes. Do not use milestones as batch labels or dependency substitutes.",
    blockers:
      "qd blockers: environment, credential, provider, data, manual, policy, and external-dependency issues are structured escape hatches to accurate state. Blocked nodes are not ready; unblocking requires evidence.",
    evidence:
      "qd evidence: completion, audit, verification, CI, and merge state need artifacts such as command logs, API responses, screenshots, fixtures, CI URLs, commits, or deployment proof tied to acceptance criteria.",
    export:
      "qd export: commit deterministic qd JSON, not .qd/qd.db. Configure [export].canonicalize_command for repo formatting hooks.",
    "agent-agnostic-orchestration":
      "qd never launches Codex, Claude, or any agent runtime. It records DAG state, assignments, evidence, gates, audits, findings, and exports.",
  };
  return topics[topic] ?? helpText();
}
