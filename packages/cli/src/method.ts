import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { output, stringOpt } from "./args.js";

export const METHOD_VERSION = "evidence-first-2026-06-29";

export const METHOD_TEXT = `qd strict orchestration method

qd is an evidence ledger for orchestrator-led software work. It is not a task
list, an agent runtime, or a place to record optimistic guesses.

Non-negotiables:
- Research precedes roadmap for product, API, data, provider, deployment, and environment work.
- A spec is an executable contract, not a placeholder for future discovery.
- Completion means ready for independent audit; it does not mean correct, merged, or safe.
- Audit means evidence review against spec and acceptance. CI is not an audit.
- Environment, credential, provider, URL, schema, and data-access failures are blockers when the node depends on them.
- Mock-only validation is insufficient for real integration work unless the spec explicitly says the node only targets a mock, fixture, or adapter boundary.
- Main stays green. Merge state is recorded only after trusted CI and the repository's real merge have happened.
- If the graph is wrong, fix the graph. Do not bypass the ready queue.
- There is no warning-only mode for the roadmap contract.

Before creating implementation work, settle product, API, provider, data,
credential, deployment, and environment facts. Unknowns become research nodes or
typed blockers. Do not create "figure out integration" implementation nodes.

Completion requires a structured completion report with acceptance evidence,
commands run, artifacts, real-world validation status, and zero unverified
items. Audit requires an independent structured audit report that reviews the
diff, completion evidence, acceptance criteria, verification evidence,
real-world validation, and failure paths. Missing required evidence is P1.

Escape hatches must move work to a more accurate state: blocked, split,
cancelled, superseded, or research-required. They must not make weak work look
complete.`;

export interface MethodAcknowledgement {
  version: string;
  hash: string;
  acknowledged_at: string;
  agent: string | null;
  note: string | null;
}

export function methodHash(): string {
  return createHash("sha256").update(`${METHOD_VERSION}\n${METHOD_TEXT}`).digest("hex");
}

export async function methodCommand(
  root: string,
  action: string | undefined,
  options: Record<string, string | string[] | boolean>,
  json: boolean,
): Promise<void> {
  if (action === "show" || !action) {
    return output(
      {
        version: METHOD_VERSION,
        hash: methodHash(),
        text: METHOD_TEXT,
        docs: "docs/orchestration.md",
        acknowledge: "qd method acknowledge --agent <name>",
      },
      json,
    );
  }
  if (action === "status") return output(await methodStatus(root), json);
  if (action === "acknowledge" || action === "ack") {
    return output(
      {
        ok: true,
        acknowledgement: await acknowledgeMethod(root, {
          agent: stringOpt(options.agent) ?? null,
          note: stringOpt(options.note) ?? null,
        }),
      },
      json,
    );
  }
  throw new Error(`Unknown method action: ${action}`);
}

export async function acknowledgeMethod(
  root: string,
  input: { agent: string | null; note: string | null },
): Promise<MethodAcknowledgement> {
  const acknowledgement: MethodAcknowledgement = {
    version: METHOD_VERSION,
    hash: methodHash(),
    acknowledged_at: new Date().toISOString(),
    agent: input.agent,
    note: input.note,
  };
  const target = acknowledgementPath(root);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(acknowledgement, null, 2)}\n`, "utf8");
  return acknowledgement;
}

export async function methodStatus(root: string): Promise<{
  ok: boolean;
  version: string;
  hash: string;
  acknowledgement: MethodAcknowledgement | null;
  error: string | null;
}> {
  const expectedHash = methodHash();
  const acknowledgement = await readAcknowledgement(root);
  if (!acknowledgement) {
    return {
      ok: false,
      version: METHOD_VERSION,
      hash: expectedHash,
      acknowledgement: null,
      error: "qd method has not been acknowledged",
    };
  }
  if (acknowledgement.version !== METHOD_VERSION || acknowledgement.hash !== expectedHash) {
    return {
      ok: false,
      version: METHOD_VERSION,
      hash: expectedHash,
      acknowledgement,
      error: "qd method acknowledgement is stale; reread the method and acknowledge again",
    };
  }
  return {
    ok: true,
    version: METHOD_VERSION,
    hash: expectedHash,
    acknowledgement,
    error: null,
  };
}

export async function requireMethodAcknowledged(root: string, command: string): Promise<void> {
  const status = await methodStatus(root);
  if (status.ok) return;
  throw new Error(
    `${status.error}. ${command} mutates qd roadmap or evidence state. Read qd method show or docs/orchestration.md, then run qd method acknowledge --agent <name>.`,
  );
}

async function readAcknowledgement(root: string): Promise<MethodAcknowledgement | null> {
  try {
    const parsed = JSON.parse(await readFile(acknowledgementPath(root), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Partial<MethodAcknowledgement>;
    if (
      typeof record.version !== "string" ||
      typeof record.hash !== "string" ||
      typeof record.acknowledged_at !== "string"
    ) {
      return null;
    }
    return {
      version: record.version,
      hash: record.hash,
      acknowledged_at: record.acknowledged_at,
      agent: typeof record.agent === "string" ? record.agent : null,
      note: typeof record.note === "string" ? record.note : null,
    };
  } catch {
    return null;
  }
}

function acknowledgementPath(root: string): string {
  return path.join(root, ".qd", "method-acknowledgement.json");
}
