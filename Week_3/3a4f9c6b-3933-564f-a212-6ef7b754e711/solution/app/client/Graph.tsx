// The stage graph: Bundles intake node, square stage nodes and the promotion rails between them.
// Phase, progress and counters are the server's values; motion only follows a change in them.
import { Package } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, type KeyboardEvent } from "react";
import type { Graph as GraphData, GraphEdge, GraphNode, Phase } from "../shared/api";
import { RAIL_SEGMENTS } from "../shared/rail";
import { layoutGraph, type GraphLayout } from "./graphLayout";
import { useMedia, useReducedMotion, useWidth } from "./hooks";
import { StageMark } from "./status";

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const MEDIUM = 440;
const LONG = 900;
const CAPSULE_PHASES: readonly Phase[] = ["queued", "window_check", "applying", "health_wait", "degraded"];
const LEGEND_ROW = { horizontal: 28, vertical: 72 };

export interface EdgeBundle { version: string; short: string }

function Rail({ edge, from, d, width, height, reduced, legendTop }: {
  edge: GraphEdge; from: string; d: string; width: number; height: number; reduced: boolean; legendTop: number | null;
}) {
  const drawnRef = useRef<SVGPathElement>(null);
  const failedRef = useRef<SVGPathElement>(null);
  const previous = useRef<GraphEdge | null>(null);
  const drawn = edge.progress;
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = edge;
    if (!before || reduced) return;
    const same = before.promotion_id === edge.promotion_id;
    const start = same ? before.progress : 0;
    if (drawn > start) {
      drawnRef.current?.animate([{ strokeDashoffset: 1 - start }, { strokeDashoffset: 1 - drawn }], { duration: MEDIUM, easing: EASE });
    }
    if (edge.phase === "degraded" && before.phase !== "degraded") {
      failedRef.current?.animate(
        [{ strokeDasharray: "0 2", strokeDashoffset: -drawn }, { strokeDasharray: `${drawn} 2`, strokeDashoffset: 0 }],
        { duration: LONG, easing: EASE });
    }
  }, [edge, drawn, reduced]);
  const reached = edge.reached;
  const failed = edge.phase === "degraded";
  return (
    <div role="img" aria-label={`Promotion rail ${from} to ${edge.to}`} data-phase={edge.phase} data-progress={String(edge.progress)}
      className="rail">
      <svg className="rail-svg" width={width} height={height} aria-hidden="true">
        <path d={d} className="rail-track" />
        {reduced ? RAIL_SEGMENTS.map((s, i) => (
          <path key={s.label} d={d} pathLength={1} className={`rail-segment${i < reached ? (failed ? " is-failed" : " is-reached") : ""}`}
            style={{ strokeDasharray: `${s.to - s.from - 0.012} 2`, strokeDashoffset: -(s.from + 0.006) }} />
        )) : (
          <>
            <path ref={drawnRef} d={d} pathLength={1} className="rail-drawn" style={{ strokeDasharray: "1 1", strokeDashoffset: 1 - drawn }} />
            <path ref={failedRef} d={d} pathLength={1} className="rail-failed"
              style={{ strokeDasharray: failed ? `${drawn} 2` : "0 2", strokeDashoffset: 0 }} />
          </>
        )}
      </svg>
      {reduced && legendTop !== null && (
        <div className="rail-legend" style={{ top: legendTop }}>
          <span className="rail-legend-name">{from} to {edge.to}</span>
          {RAIL_SEGMENTS.map((s, i) => (
            <span key={s.label} className={`rail-chip${i < reached ? (failed ? " is-failed" : " is-reached") : ""}`}
              data-reached={i < reached ? "true" : "false"}>{s.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function Capsule({ edge, d, short, reduced }: { edge: GraphEdge; d: string; short: string; reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<{ id: string | null; progress: number } | null>(null);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { id: edge.promotion_id, progress: edge.progress };
    if (reduced) return;
    const start = before && before.id === edge.promotion_id ? before.progress : 0;
    if (edge.progress > start) {
      ref.current?.animate([{ offsetDistance: `${start * 100}%` }, { offsetDistance: `${edge.progress * 100}%` }],
        { duration: MEDIUM, easing: EASE });
    }
  }, [edge.promotion_id, edge.progress, reduced]);
  return (
    <div ref={ref} role="img" aria-label={`Bundle ${short}`} className={`capsule${edge.phase === "degraded" ? " is-failed" : ""}`}
      style={{ offsetPath: `path("${d}")`, offsetDistance: `${edge.progress * 100}%` }}>
      {short}
    </div>
  );
}

function StageNode({ node, box, selected, onSelect, onKey, flash }: {
  node: GraphNode; box: { x: number; y: number; w: number; h: number }; selected: boolean;
  onSelect: (stage: string) => void; onKey: (event: KeyboardEvent<HTMLButtonElement>, stage: string) => void;
  flash: (element: HTMLButtonElement | null) => void;
}) {
  const counter = node.counter ?? { in_sync: 0, total: 0 };
  const shown = useRef(counter.in_sync);
  const rising = counter.in_sync > shown.current;
  shown.current = counter.in_sync;
  return (
    <button ref={flash} type="button" aria-label={`Stage ${node.stage}`} data-status={node.status} data-stage={node.stage}
      className={`node${selected ? " is-selected" : ""}`} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onClick={() => onSelect(node.stage)} onKeyDown={(event) => onKey(event, node.stage)}>
      {selected && <span className="node-selected" aria-hidden="true">Selected</span>}
      <span className="node-name" aria-hidden="true">{node.stage}</span>
      <span className="node-cluster" aria-hidden="true">{node.cluster}</span>
      <span className="node-zone" aria-hidden="true">{node.time_zone}</span>
      <span className="node-status" aria-hidden="true"><StageMark status={node.status} /></span>
      <span className="node-current" aria-hidden="true">{`current ${node.current?.short_digest ?? "none"}`}</span>
      <span className={`node-count${rising ? " is-counting" : ""}`} aria-hidden="true"
        style={{ "--in-sync": counter.in_sync, "--total": counter.total } as React.CSSProperties}>
        <span className="sr-only">{`in sync ${counter.in_sync}/${counter.total}`}</span>
        <span className="node-count-digits" />
      </span>
    </button>
  );
}

export function Graph({ graph, selected, onSelect, edgeBundles, bundleCount, newest }: {
  graph: GraphData; selected: string | null; onSelect: (stage: string) => void;
  edgeBundles: Map<string, EdgeBundle>; bundleCount: number; newest: EdgeBundle | null;
}) {
  const reduced = useReducedMotion();
  const [plateRef, width] = useWidth<HTMLDivElement>();
  const vertical = useMedia("(max-width: 767px)");
  const layout: GraphLayout | null = useMemo(
    () => (width > 0 ? layoutGraph(width, graph.nodes, vertical) : null), [width, graph.nodes, vertical]);
  const nodeElements = useRef(new Map<string, HTMLButtonElement>());
  const lastPhases = useRef(new Map<string, { id: string | null; phase: Phase }>());

  useLayoutEffect(() => {
    for (const edge of graph.edges) {
      const before = lastPhases.current.get(edge.to);
      lastPhases.current.set(edge.to, { id: edge.promotion_id, phase: edge.phase });
      if (!before || edge.phase !== "healthy" || before.phase === "healthy" || before.id !== edge.promotion_id) continue;
      const element = nodeElements.current.get(edge.to);
      if (!element) continue;
      if (reduced) {
        element.animate([{ borderColor: "#f2b13d" }, { borderColor: "#f2b13d" }], { duration: 2000 });
      } else {
        element.animate([{ boxShadow: "0 0 0 4px rgba(242, 177, 61, 0.9)" }, { boxShadow: "0 0 0 0 rgba(242, 177, 61, 0)" }],
          { duration: MEDIUM, easing: EASE });
        element.querySelector(".node-current")?.animate(
          [{ backgroundColor: "rgba(242, 177, 61, 0.35)" }, { backgroundColor: "rgba(242, 177, 61, 0)" }], { duration: MEDIUM, easing: EASE });
      }
    }
  }, [graph.edges, reduced]);

  const order = graph.nodes.map((n) => n.stage);
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, stage: string) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = order[order.indexOf(stage) + step];
    if (next) nodeElements.current.get(next)?.focus();
  };

  const legendEdges = reduced ? graph.edges.filter((e) => e.phase !== "idle" && e.phase !== "stopped") : [];
  const legendRow = vertical ? LEGEND_ROW.vertical : LEGEND_ROW.horizontal;
  const plateHeight = layout ? layout.height + legendEdges.length * legendRow + (legendEdges.length ? 8 : 0) : 0;

  return (
    <section aria-label="Stage graph" className="graph">
      <div ref={plateRef} className="plate" style={{ height: plateHeight }}>
        {layout && (
          <>
            <svg className="plate-grid" width={layout.width} height={plateHeight} aria-hidden="true">
              <defs>
                <pattern id="plate-dots" width="24" height="24" patternUnits="userSpaceOnUse">
                  <rect x="11.5" y="11.5" width="1" height="1" className="plate-dot" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#plate-dots)" />
            </svg>
            <div className="bundles-node" style={{ left: layout.bundles.x, top: layout.bundles.y, width: layout.bundles.w, height: layout.bundles.h }}>
              <span className="bundles-title">
                <Package aria-hidden="true" size={16} strokeWidth={2} />
                <span className="node-name">Bundles</span>
              </span>
              <span className="bundles-facts">
                <span className="bundles-count">{`${bundleCount} bundles`}</span>
                {newest && <>
                  <span className="bundles-caption">latest</span>
                  <span className="bundles-newest">{newest.version}</span>
                  <span className="bundles-newest">{newest.short}</span>
                </>}
              </span>
            </div>
            {graph.edges.map((edge) => (
              <Rail key={edge.to} edge={edge} from={edge.from === "bundles" ? "Bundles" : edge.from} d={layout.paths.get(edge.to) ?? ""}
                width={layout.width} height={plateHeight} reduced={reduced}
                legendTop={legendEdges.includes(edge) ? layout.height + legendEdges.indexOf(edge) * legendRow : null} />
            ))}
            {graph.nodes.map((node) => (
              <StageNode key={node.stage} node={node} box={layout.nodes.get(node.stage) as GraphLayout["bundles"]}
                selected={selected === node.stage} onSelect={onSelect} onKey={onKey}
                flash={(element) => {
                  if (element) nodeElements.current.set(node.stage, element);
                  else nodeElements.current.delete(node.stage);
                }} />
            ))}
            {graph.edges.map((edge) => {
              const bundle = edgeBundles.get(edge.promotion_id ?? "");
              return CAPSULE_PHASES.includes(edge.phase) && bundle
                ? <Capsule key={`${edge.to}-${edge.promotion_id}`} edge={edge} d={layout.paths.get(edge.to) ?? ""} short={bundle.short} reduced={reduced} />
                : null;
            })}
          </>
        )}
      </div>
    </section>
  );
}
