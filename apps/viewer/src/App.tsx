import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AnalyticsReport, GraphSnapshot } from "@cat-cave/qdcli-core";
import "./styles.css";
import {
  buildLayout,
  emptySnapshot,
  fitBounds,
  matchesFilters,
  neighborhood,
  readyNodes,
  statuses,
  zoomViewport,
  type DragState,
  type Filters,
  type Viewport,
} from "./viewer-model.js";
import {
  HealthPanel,
  MetricStrip,
  ReadyQueue,
  TriagePanel,
  Toolbar,
  WavePanel,
} from "./viewer-panels.js";
import { GraphEdges, GraphLegend, GraphNodes } from "./viewer-graph.js";
import { NodeDetail } from "./viewer-detail.js";

function App() {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsReport | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [filters, setFilters] = useState<Filters>(() => ({
    query: "",
    statuses: new Set(statuses),
    milestone: "all",
    group: "all",
    project: "all",
    dimFiltered: true,
    focusSelection: true,
  }));
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    let disposed = false;

    async function load() {
      try {
        const [graphResponse, analyticsResponse] = await Promise.all([
          fetch("/api/graph"),
          fetch("/api/analytics"),
        ]);
        if (!graphResponse.ok) throw new Error(`Graph request failed: ${graphResponse.status}`);
        const graph = (await graphResponse.json()) as GraphSnapshot;
        const report = analyticsResponse.ok
          ? ((await analyticsResponse.json()) as AnalyticsReport)
          : null;
        if (disposed) return;
        setSnapshot(graph);
        setAnalytics(report);
        setLastUpdated(new Date());
        setError(null);
        setSelected((current) =>
          current && graph.nodes.some((node) => node.id === current)
            ? current
            : (graph.nodes[0]?.id ?? null),
        );
      } catch (caught) {
        if (disposed) return;
        setSnapshot((current) => current ?? emptySnapshot);
        setAnalytics(null);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }

    void load();
    const timer = window.setInterval(() => {
      if (live) void load();
    }, 5000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [live]);

  const filteredIds = useMemo(() => {
    if (!snapshot) return new Set<string>();
    return new Set(
      snapshot.nodes.filter((node) => matchesFilters(node, filters)).map((node) => node.id),
    );
  }, [filters, snapshot]);

  const renderedNodeIds = useMemo(() => {
    if (!snapshot) return new Set<string>();
    if (filters.dimFiltered) return new Set(snapshot.nodes.map((node) => node.id));
    return filteredIds;
  }, [filteredIds, filters.dimFiltered, snapshot]);

  const layout = useMemo(() => {
    if (!snapshot) return null;
    return buildLayout(snapshot, renderedNodeIds);
  }, [renderedNodeIds, snapshot]);

  useEffect(() => {
    if (layout) setViewport(fitBounds(layout.bounds));
  }, [layout?.bounds.height, layout?.bounds.width, layout?.bounds.x, layout?.bounds.y]);

  const ready = useMemo(() => (snapshot ? readyNodes(snapshot) : []), [snapshot]);
  const selectedNode = snapshot?.nodes.find((node) => node.id === selected) ?? null;
  const openAssignments = useMemo(
    () => snapshot?.assignments.filter((assignment) => assignment.status === "open") ?? [],
    [snapshot],
  );
  const openWaves = useMemo(
    () => snapshot?.waves.filter((wave) => wave.status === "open") ?? [],
    [snapshot],
  );
  const criticalIds = useMemo(
    () => new Set(analytics?.criticalPath.criticalPath.map((node) => node.id) ?? []),
    [analytics],
  );
  const neighborIds = useMemo(
    () => (snapshot && selected ? neighborhood(snapshot, selected) : new Set<string>()),
    [selected, snapshot],
  );

  if (!snapshot || !layout || !viewport) {
    return <main className="loading">Loading qd graph...</main>;
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brandBlock">
          <h1>Quick DAG</h1>
          <p>
            {snapshot.nodes.length} nodes, {snapshot.edges.length} edges, {ready.length} ready
          </p>
        </div>
        <MetricStrip
          snapshot={snapshot}
          analytics={analytics}
          ready={ready.length}
          openAssignments={openAssignments.length}
          openWaves={openWaves.length}
        />
      </header>

      <section className="workspace">
        <aside className="sidebar controlsPanel">
          <Toolbar
            snapshot={snapshot}
            filters={filters}
            onFilters={setFilters}
            onFit={() => setViewport(fitBounds(layout.bounds))}
            live={live}
            onLive={setLive}
            onRefresh={() => {
              setLive(false);
              window.setTimeout(() => setLive(true), 0);
            }}
            lastUpdated={lastUpdated}
            error={error}
          />
          <HealthPanel snapshot={snapshot} analytics={analytics} />
          <TriagePanel snapshot={snapshot} selected={selected} onSelect={setSelected} />
          <ReadyQueue ready={ready} selected={selected} onSelect={setSelected} />
          <WavePanel snapshot={snapshot} selected={selected} onSelect={setSelected} />
        </aside>

        <section className="graphPanel">
          <div className="graphHeader">
            <div>
              <h2>DAG Map</h2>
              <p>
                {filters.dimFiltered
                  ? `${filteredIds.size} matching nodes highlighted`
                  : `${layout.nodes.length} nodes visible`}
              </p>
            </div>
            <GraphLegend />
          </div>

          <svg
            ref={svgRef}
            className="dagCanvas"
            viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
            role="img"
            aria-label="Interactive qd DAG graph"
            onWheel={(event) => {
              event.preventDefault();
              setViewport((current) => zoomViewport(current ?? viewport, event, svgRef.current));
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              dragRef.current = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                viewport,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              const rect = svgRef.current?.getBoundingClientRect();
              if (!drag || !rect) return;
              const dx = ((event.clientX - drag.x) / rect.width) * drag.viewport.width;
              const dy = ((event.clientY - drag.y) / rect.height) * drag.viewport.height;
              setViewport({
                ...drag.viewport,
                x: drag.viewport.x - dx,
                y: drag.viewport.y - dy,
              });
            }}
            onPointerUp={(event) => {
              if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
            }}
          >
            <defs>
              <marker id="arrow" markerHeight="7" markerWidth="7" orient="auto" refX="7" refY="3.5">
                <path d="M 0 0 L 7 3.5 L 0 7 z" className="arrowHead" />
              </marker>
            </defs>
            <GraphEdges
              layout={layout}
              selected={selected}
              filteredIds={filteredIds}
              neighborIds={neighborIds}
              filters={filters}
            />
            <GraphNodes
              layout={layout}
              selected={selected}
              filteredIds={filteredIds}
              neighborIds={neighborIds}
              criticalIds={criticalIds}
              filters={filters}
              snapshot={snapshot}
              onSelect={setSelected}
            />
          </svg>
        </section>

        <aside className="sidebar detailPanel">
          {selectedNode ? (
            <NodeDetail
              node={selectedNode}
              snapshot={snapshot}
              analytics={analytics}
              onSelect={setSelected}
            />
          ) : (
            <p className="emptyState">Select a node to inspect its spec, blockers, and history.</p>
          )}
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
