import type { AnalyticsReport, GraphSnapshot, QdFinding, QdNode } from "@cat-cave/qdcli-core";
import { latestRunsByKind } from "./viewer-model.js";

export function NodeDetail({
  node,
  snapshot,
  analytics,
  onSelect,
}: {
  node: QdNode;
  snapshot: GraphSnapshot;
  analytics: AnalyticsReport | null;
  onSelect: (id: string) => void;
}) {
  const findings = snapshot.findings.filter((finding) => finding.node_id === node.id);
  const runs = snapshot.runs.filter((run) => run.node_id === node.id);
  const notes = snapshot.node_notes.filter((note) => note.node_id === node.id);
  const assignments = snapshot.assignments.filter((assignment) => assignment.node_id === node.id);
  const dependencies = snapshot.edges.filter(
    (edge) => edge.to_node === node.id && edge.type === "requires",
  );
  const dependents = snapshot.edges.filter(
    (edge) => edge.from_node === node.id && edge.type === "requires",
  );
  const criticalIndex =
    analytics?.criticalPath.criticalPath.findIndex((item) => item.id === node.id) ?? -1;
  const latestRuns = latestRunsByKind(runs);
  const nodeWaves = snapshot.wave_memberships
    .filter((membership) => membership.node_id === node.id)
    .map((membership) => snapshot.waves.find((wave) => wave.id === membership.wave_id))
    .filter((wave): wave is NonNullable<typeof wave> => Boolean(wave));
  const byNode = new Map(snapshot.nodes.map((candidate) => [candidate.id, candidate]));

  return (
    <section className="detailContent">
      <div className="detailHead">
        <span className={`priority ${node.priority}`}>{node.priority}</span>
        <h2>{node.title}</h2>
        <p>{node.id}</p>
      </div>
      <dl className="detailGrid">
        <dt>Status</dt>
        <dd>{node.status}</dd>
        <dt>Kind</dt>
        <dd>{node.kind}</dd>
        <dt>Estimate</dt>
        <dd>{node.estimate_points} pts</dd>
        <dt>Risk</dt>
        <dd>{node.risk}</dd>
        <dt>Milestone</dt>
        <dd>{node.milestone ?? "none"}</dd>
        <dt>Group</dt>
        <dd>{node.group_name ?? "none"}</dd>
        <dt>Owner</dt>
        <dd>{node.owner ?? "none"}</dd>
        <dt>Branch</dt>
        <dd>{node.branch ?? "none"}</dd>
      </dl>
      {criticalIndex >= 0 ? (
        <p className="criticalNote">Critical path position {criticalIndex + 1}</p>
      ) : null}
      {node.blocked_by ? (
        <p className="blockerNote">
          Blocked by {node.blocked_by}: {node.blocked_reason}
          {node.blocked_owner ? ` (${node.blocked_owner})` : ""}
        </p>
      ) : null}
      <DetailList
        title="Latest Runs"
        items={[...latestRuns.entries()].map(([kind, run]) => `${kind}: ${run.status}`)}
      />
      <DetailList
        title="Assignments"
        items={assignments.map(
          (assignment) =>
            `${assignment.role} ${assignment.status}: ${assignment.owner}${
              assignment.worktree_path ? ` @ ${assignment.worktree_path}` : ""
            }`,
        )}
      />
      <DetailList
        title="Waves"
        items={nodeWaves.map((wave) => `${wave.kind} ${wave.status}: ${wave.summary}`)}
      />
      <DetailSection title="Spec" text={node.spec} />
      <DetailSection title="Acceptance" text={node.acceptance} />
      <DependencyList
        title="Dependencies"
        ids={dependencies.map((edge) => edge.from_node)}
        byNode={byNode}
        onSelect={onSelect}
      />
      <DependencyList
        title="Unblocks"
        ids={dependents.map((edge) => edge.to_node)}
        byNode={byNode}
        onSelect={onSelect}
      />
      <Findings findings={findings} />
      <DetailList title="Audit Focus" items={node.audit_focus} />
      <DetailList
        title="Verification"
        items={node.verification.map((item) => `${item.type}: ${item.value}`)}
      />
      <DetailList title="Runs" items={runs.map((run) => `${run.kind}: ${run.status}`)} />
      <DetailList title="Notes" items={notes.map((note) => note.text)} />
    </section>
  );
}

function DependencyList({
  title,
  ids,
  byNode,
  onSelect,
}: {
  title: string;
  ids: string[];
  byNode: Map<string, QdNode>;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="detailSection">
      <h3>{title}</h3>
      {ids.length === 0 ? (
        <p>None</p>
      ) : (
        <div className="dependencyList">
          {ids.map((id) => {
            const node = byNode.get(id);
            return (
              <button
                key={id}
                type="button"
                className="dependencyItem"
                onClick={() => onSelect(id)}
              >
                <span className={`statusDot ${node?.status ?? "draft"}`} />
                <strong>{id}</strong>
                <small>{node?.title ?? "Missing node"}</small>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DetailSection({ title, text }: { title: string; text: string | null }) {
  return (
    <section className="detailSection">
      <h3>{title}</h3>
      <p>{text?.trim() || "None"}</p>
    </section>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="detailSection">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p>None</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Findings({ findings }: { findings: QdFinding[] }) {
  return (
    <section className="detailSection">
      <h3>Findings</h3>
      {findings.length === 0 ? (
        <p>None</p>
      ) : (
        <ul>
          {findings.map((finding) => (
            <li key={finding.id}>
              <span className={`priority ${finding.severity}`}>{finding.severity}</span>{" "}
              {finding.status}: {finding.title}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
