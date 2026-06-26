import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AnalyticsReport, GraphSnapshot, QdNode } from "@qdcli/core";
import "./styles.css";

function App() {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsReport | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/graph")
      .then((response) => response.json())
      .then((data: GraphSnapshot) => {
        setSnapshot(data);
        setSelected(data.nodes[0]?.id ?? null);
      })
      .catch(() =>
        setSnapshot({
          schema_version: 1,
          exported_at: new Date(0).toISOString(),
          registries: { groups: [], projects: [], milestones: [] },
          nodes: [],
          edges: [],
          findings: [],
          runs: [],
          node_notes: [],
        }),
      );
    fetch("/api/analytics")
      .then((response) => response.json())
      .then((data: AnalyticsReport) => setAnalytics(data))
      .catch(() => setAnalytics(null));
  }, []);

  const node = snapshot?.nodes.find((item) => item.id === selected) ?? null;
  const ready = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.nodes.filter((candidate) => {
      if (!["ready", "blocked"].includes(candidate.status)) return false;
      return !snapshot.edges.some(
        (edge) =>
          edge.type === "requires" &&
          edge.to_node === candidate.id &&
          snapshot.nodes.find((dep) => dep.id === edge.from_node)?.status !== "done",
      );
    });
  }, [snapshot]);

  if (!snapshot) return <main className="shell">Loading qd graph...</main>;

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <h1>Quick DAG</h1>
          <p>
            {snapshot.nodes.length} nodes · {snapshot.edges.length} edges · {ready.length} ready
          </p>
        </div>
        <StatusSummary nodes={snapshot.nodes} analytics={analytics} />
      </section>

      <section className="layout">
        <aside className="queue">
          <h2>Ready</h2>
          {ready.map((item) => (
            <button key={item.id} className="queueItem" onClick={() => setSelected(item.id)}>
              <span>{item.priority}</span>
              {item.title}
            </button>
          ))}
        </aside>

        <section className="graph">
          {analytics ? (
            <div className="metrics">
              <span>Velocity {analytics.velocity.pointsPerDay.toFixed(2)} pts/day</span>
              <span>Critical path {analytics.criticalPath.criticalPathPoints} pts</span>
              <span>
                ETA{" "}
                {analytics.eta.etaDays === null
                  ? "unknown"
                  : `${analytics.eta.etaDays.toFixed(1)} days`}
              </span>
            </div>
          ) : null}
          {snapshot.nodes.map((item) => (
            <button
              key={item.id}
              className={`node ${item.status} ${selected === item.id ? "selected" : ""}`}
              onClick={() => setSelected(item.id)}
            >
              <span>{item.id}</span>
              <strong>{item.title}</strong>
              <small>{item.status}</small>
            </button>
          ))}
        </section>

        <aside className="detail">
          {node ? <NodeDetail node={node} snapshot={snapshot} /> : <p>Select a node.</p>}
        </aside>
      </section>
    </main>
  );
}

function StatusSummary({
  nodes,
  analytics,
}: {
  nodes: QdNode[];
  analytics: AnalyticsReport | null;
}) {
  const statuses = [...new Set(nodes.map((node) => node.status))];
  return (
    <div className="statusSummary">
      {statuses.map((status) => (
        <span key={status}>
          {status}: {nodes.filter((node) => node.status === status).length}
        </span>
      ))}
      {analytics ? <span>remaining: {analytics.eta.remainingPoints} pts</span> : null}
    </div>
  );
}

function NodeDetail({ node, snapshot }: { node: QdNode; snapshot: GraphSnapshot }) {
  const findings = snapshot.findings.filter((finding) => finding.node_id === node.id);
  const dependencies = snapshot.edges.filter(
    (edge) => edge.to_node === node.id && edge.type === "requires",
  );
  return (
    <>
      <h2>{node.title}</h2>
      <dl>
        <dt>ID</dt>
        <dd>{node.id}</dd>
        <dt>Status</dt>
        <dd>{node.status}</dd>
        <dt>Priority</dt>
        <dd>{node.priority}</dd>
        <dt>Estimate</dt>
        <dd>{node.estimate_points}</dd>
      </dl>
      <h3>Spec</h3>
      <p>{node.spec}</p>
      <h3>Acceptance</h3>
      <p>{node.acceptance}</p>
      <h3>Dependencies</h3>
      <p>{dependencies.map((edge) => edge.from_node).join(", ") || "None"}</p>
      <h3>Findings</h3>
      {findings.length === 0 ? (
        <p>None</p>
      ) : (
        findings.map((finding) => (
          <p key={finding.id}>
            {finding.severity}: {finding.title}
          </p>
        ))
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
