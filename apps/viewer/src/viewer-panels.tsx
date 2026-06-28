import type { AnalyticsReport, GraphSnapshot, QdNode } from "@cat-cave/qdcli-core";
import { milestoneProgress, statuses, type Filters } from "./viewer-model.js";

export function Toolbar({
  snapshot,
  filters,
  onFilters,
  onFit,
  live,
  onLive,
  onRefresh,
  lastUpdated,
  error,
}: {
  snapshot: GraphSnapshot;
  filters: Filters;
  onFilters: (filters: Filters) => void;
  onFit: () => void;
  live: boolean;
  onLive: (live: boolean) => void;
  onRefresh: () => void;
  lastUpdated: Date | null;
  error: string | null;
}) {
  const milestones = ["all", ...snapshot.registries.milestones.map((item) => item.name)];
  const groups = ["all", ...snapshot.registries.groups.map((item) => item.name)];
  const projects = ["all", ...snapshot.registries.projects.map((item) => item.name)];

  return (
    <section className="toolBlock">
      <div className="panelTitle">
        <h2>View</h2>
        <span className={live ? "liveDot active" : "liveDot"} />
      </div>
      <label className="fieldLabel">
        Search
        <input
          value={filters.query}
          onChange={(event) => onFilters({ ...filters, query: event.target.value })}
          placeholder="id, title, spec"
        />
      </label>
      <div className="buttonRow">
        <button type="button" onClick={onFit}>
          Fit
        </button>
        <button type="button" onClick={onRefresh}>
          Refresh
        </button>
        <button type="button" className={live ? "activeButton" : ""} onClick={() => onLive(!live)}>
          Live
        </button>
      </div>
      <div className="statusGrid">
        {statuses.map((status) => {
          const enabled = filters.statuses.has(status);
          return (
            <button
              key={status}
              type="button"
              className={enabled ? `statusToggle ${status}` : "statusToggle disabled"}
              onClick={() => {
                const next = new Set(filters.statuses);
                if (next.has(status)) next.delete(status);
                else next.add(status);
                onFilters({ ...filters, statuses: next });
              }}
            >
              {status}
            </button>
          );
        })}
      </div>
      <FilterSelect
        label="Milestone"
        value={filters.milestone}
        values={milestones}
        onChange={(milestone) => onFilters({ ...filters, milestone })}
      />
      <FilterSelect
        label="Group"
        value={filters.group}
        values={groups}
        onChange={(group) => onFilters({ ...filters, group })}
      />
      <FilterSelect
        label="Project"
        value={filters.project}
        values={projects}
        onChange={(project) => onFilters({ ...filters, project })}
      />
      <label className="checkLine">
        <input
          type="checkbox"
          checked={filters.dimFiltered}
          onChange={(event) => onFilters({ ...filters, dimFiltered: event.target.checked })}
        />
        Dim filtered nodes
      </label>
      <label className="checkLine">
        <input
          type="checkbox"
          checked={filters.focusSelection}
          onChange={(event) => onFilters({ ...filters, focusSelection: event.target.checked })}
        />
        Focus selected neighborhood
      </label>
      <p className="syncLine">
        {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Waiting for graph"}
      </p>
      {error ? <p className="errorLine">{error}</p> : null}
    </section>
  );
}

export function MetricStrip({
  snapshot,
  analytics,
  ready,
  openAssignments,
  openWaves,
}: {
  snapshot: GraphSnapshot;
  analytics: AnalyticsReport | null;
  ready: number;
  openAssignments: number;
  openWaves: number;
}) {
  const donePoints = snapshot.nodes
    .filter((node) => node.status === "done")
    .reduce((sum, node) => sum + node.estimate_points, 0);
  const totalPoints = snapshot.nodes.reduce((sum, node) => sum + node.estimate_points, 0);
  const openBlocking = snapshot.findings.filter(
    (finding) =>
      finding.status === "open" && (finding.severity === "P0" || finding.severity === "P1"),
  ).length;
  return (
    <div className="metricStrip">
      <Metric label="Ready" value={String(ready)} />
      <Metric label="Points" value={`${donePoints}/${totalPoints}`} />
      <Metric
        label="Velocity"
        value={analytics ? analytics.velocity.pointsPerDay.toFixed(2) : "n/a"}
      />
      <Metric
        label="Critical"
        value={analytics ? String(analytics.criticalPath.criticalPathPoints) : "n/a"}
      />
      <Metric label="P0/P1" value={String(openBlocking)} />
      <Metric label="Owners" value={String(openAssignments)} />
      <Metric label="Waves" value={String(openWaves)} />
    </div>
  );
}

export function ReadyQueue({
  ready,
  selected,
  onSelect,
}: {
  ready: QdNode[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="toolBlock queueBlock">
      <div className="panelTitle">
        <h2>Ready Queue</h2>
        <span>{ready.length}</span>
      </div>
      {ready.length === 0 ? (
        <p className="emptyState">No dependency-unblocked nodes are ready.</p>
      ) : (
        ready.slice(0, 16).map((node) => (
          <button
            key={node.id}
            type="button"
            className={selected === node.id ? "queueItem selectedQueueItem" : "queueItem"}
            onClick={() => onSelect(node.id)}
          >
            <span className={`priority ${node.priority}`}>{node.priority}</span>
            <strong>{node.id}</strong>
            <small>{node.title}</small>
          </button>
        ))
      )}
    </section>
  );
}

export function HealthPanel({
  snapshot,
  analytics,
}: {
  snapshot: GraphSnapshot;
  analytics: AnalyticsReport | null;
}) {
  const blocked = snapshot.nodes.filter((node) => node.status === "blocked");
  const review = snapshot.nodes.filter((node) => node.status === "review");
  const mergeable = snapshot.nodes.filter((node) => node.status === "mergeable");
  const progress = milestoneProgress(snapshot);
  return (
    <section className="toolBlock healthBlock">
      <div className="panelTitle">
        <h2>Health</h2>
        <span>{analytics?.eta.etaDate ?? "no ETA"}</span>
      </div>
      <div className="healthGrid">
        <Metric label="Blocked" value={String(blocked.length)} />
        <Metric label="Review" value={String(review.length)} />
        <Metric label="Mergeable" value={String(mergeable.length)} />
      </div>
      <div className="progressList">
        {progress.slice(0, 5).map((item) => (
          <div key={item.name} className="progressItem">
            <span>{item.name}</span>
            <strong>
              {item.done}/{item.total}
            </strong>
            <i style={{ inlineSize: `${item.percent}%` }} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function TriagePanel({
  snapshot,
  selected,
  onSelect,
}: {
  snapshot: GraphSnapshot;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const byNode = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const blockers = snapshot.findings
    .filter(
      (finding) =>
        finding.status === "open" && (finding.severity === "P0" || finding.severity === "P1"),
    )
    .slice(0, 6);
  const regressed = snapshot.nodes.filter((node) => node.status === "regressed").slice(0, 4);
  const blocked = snapshot.nodes.filter((node) => node.status === "blocked").slice(0, 4);
  return (
    <section className="toolBlock triageBlock">
      <div className="panelTitle">
        <h2>Triage</h2>
        <span>{blockers.length + regressed.length + blocked.length}</span>
      </div>
      {blockers.length === 0 && regressed.length === 0 && blocked.length === 0 ? (
        <p className="emptyState">No active blockers.</p>
      ) : null}
      {blockers.map((finding) => {
        const node = byNode.get(finding.node_id);
        return (
          <button
            key={finding.id}
            type="button"
            className={
              selected === finding.node_id ? "triageItem selectedTriageItem" : "triageItem"
            }
            onClick={() => onSelect(finding.node_id)}
          >
            <span className={`priority ${finding.severity}`}>{finding.severity}</span>
            <strong>{finding.title}</strong>
            <small>{node ? `${node.id} - ${node.title}` : finding.node_id}</small>
          </button>
        );
      })}
      {[...regressed, ...blocked].map((node) => (
        <button
          key={`${node.status}-${node.id}`}
          type="button"
          className={selected === node.id ? "triageItem selectedTriageItem" : "triageItem"}
          onClick={() => onSelect(node.id)}
        >
          <span className={`statusPill ${node.status}`}>{node.status}</span>
          <strong>{node.id}</strong>
          <small>{node.blocked_reason ?? node.title}</small>
        </button>
      ))}
    </section>
  );
}

export function WavePanel({
  snapshot,
  selected,
  onSelect,
}: {
  snapshot: GraphSnapshot;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const membershipsByWave = new Map<string, string[]>();
  for (const membership of snapshot.wave_memberships) {
    if (!membership.node_id) continue;
    membershipsByWave.set(membership.wave_id, [
      ...(membershipsByWave.get(membership.wave_id) ?? []),
      membership.node_id,
    ]);
  }
  const openWaves = snapshot.waves.filter((wave) => wave.status === "open");
  return (
    <section className="toolBlock queueBlock">
      <div className="panelTitle">
        <h2>Open Waves</h2>
        <span>{openWaves.length}</span>
      </div>
      {openWaves.length === 0 ? (
        <p className="emptyState">No open waves.</p>
      ) : (
        openWaves.slice(0, 8).map((wave) => {
          const nodes = membershipsByWave.get(wave.id) ?? [];
          return (
            <div key={wave.id} className="waveItem">
              <strong>{wave.kind}</strong>
              <small>{wave.summary}</small>
              <div className="waveNodes">
                {nodes.slice(0, 6).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={selected === id ? "miniNode activeMiniNode" : "miniNode"}
                    onClick={() => onSelect(id)}
                  >
                    {id}
                  </button>
                ))}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}

function FilterSelect({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="fieldLabel">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {values.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
