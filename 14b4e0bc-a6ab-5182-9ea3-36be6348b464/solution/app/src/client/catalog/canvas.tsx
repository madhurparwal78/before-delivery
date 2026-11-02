import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Glyphs, Icon, IdText } from "../ui.tsx";
import {
  bands, edgeDrawn, nodeViews, recordPan, REST_VIEW, sweepProgress, zoomAround,
  type Drawing, type NodeView, type Trace, type View,
} from "./drawing.ts";

export interface LineageProps {
  drawing: Drawing | null;
  emptyCopy: string;
  trace: Trace | null;
  now: number;
  reducedMotion: boolean;
  chosen: string | null;
  tabStop: string | null;
  layout: "settling" | "settled";
  canTrace: boolean;
  summary: string;
  status: string;
  onTrace(): void;
  onNodeFocus(column: string): void;
  onChoose(column: string): void;
  onNodeKey(event: KeyboardEvent, column: string): void;
}

const NODE_W = 116;
const BAND_PITCH = NODE_W + 12;
const PAD = 20;
const LABEL_H = 32;
const INSET = 16;
const RETURN_DROP = 30;

export function sweepAttr(trace: Trace | null, now: number): "idle" | "running" | "done" {
  if (!trace || trace.phase === "pending") return "idle";
  return sweepProgress(trace, now).done || trace.phase === "done" ? "done" : "running";
}

function NodeBody({ v, chosen, tabStop, props, extra }: { v: NodeView; chosen: string | null; tabStop: string | null; props: LineageProps; extra?: ComponentChildren }) {
  const n = v.node;
  const flagged = v.deprecated || v.deprecatedUpstream !== "";
  // Named from its content: the id, the marks being aria-hidden. An aria-label would leave the marks'
  // visible letters out of the name (WCAG 2.5.3).
  return (
    <button
      type="button"
      class={`node node-${n.side}${v.lit ? " lit" : ""}${v.deprecated ? " deprecated" : ""}${flagged ? " flagged" : ""}`}
      data-column={n.column}
      data-hop={String(n.hop)}
      data-lit={String(v.lit)}
      data-tags={v.tags.join(" ")}
      data-deprecated={String(v.deprecated)}
      data-deprecated-upstream={v.deprecatedUpstream}
      data-selected={String(chosen === n.column)}
      tabIndex={tabStop === n.column ? 0 : -1}
      onFocus={() => props.onNodeFocus(n.column)}
      onClick={() => props.onChoose(n.column)}
      onKeyDown={(e) => props.onNodeKey(e, n.column)}
    >
      <span class="node-label mono"><IdText id={n.column} /></span>
      {v.tags.length > 0 && <Glyphs tags={v.tags} />}
      {flagged && <span class="dep-flag mono" data-deprecation-flag="" aria-hidden="true">D</span>}
      {v.badge && <span class="hop-badge mono" data-hop-badge="" aria-hidden="true">{String(n.hop)}</span>}
      {v.sealMark && <span class="seal-node" data-seal="suppression" aria-hidden="true" />}
      {extra && <span class="node-extra" aria-hidden="true">{extra}</span>}
    </button>
  );
}

export function LineageHeader({ props, counter }: { props: LineageProps; counter: number }) {
  return (
    <>
      {props.canTrace && (
        <button type="button" class="btn btn-ink" data-focus-key="trace" onClick={props.onTrace} disabled={!props.drawing}>
          Trace impact
        </button>
      )}
      {props.drawing && (
        <span class="reached">Reached <span class="sweep-count mono" data-sweep-count="">{String(counter)}</span></span>
      )}
      <div role="status" aria-label="Trace summary" class="trace-summary">{props.summary}</div>
      <div role="status" aria-label="Lineage status" class="lineage-status">{props.status}</div>
    </>
  );
}

type Box = { x: number; y: number; w: number; h: number };

/** The lineage canvas, 768 pixels and wider (DP-41..47). */
export function LineageCanvas(props: LineageProps) {
  const [view, setView] = useState<View>(REST_VIEW);
  const [boxes, setBoxes] = useState<Map<string, Box>>(new Map());
  const content = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const viewRef = useRef(view);
  viewRef.current = view;
  const prevBoxes = useRef<Map<string, Box>>(new Map());

  const d = props.drawing;
  const views = d ? nodeViews(d, props.trace, props.now, props.reducedMotion) : [];
  const byColumn = new Map(views.map((v) => [v.node.column, v]));
  const bandMap = d ? bands(d) : new Map<number, string[]>();
  const hops = [...bandMap.keys()];
  const minHop = hops.length ? Math.min(...hops) : 0;
  const progress = sweepProgress(props.trace, props.now);
  const sweep = sweepAttr(props.trace, props.now);

  useLayoutEffect(() => {
    if (!layer.current) return;
    const next = new Map<string, Box>();
    for (const el of layer.current.querySelectorAll<HTMLElement>("[data-column]")) {
      const band = el.parentElement!;
      next.set(el.dataset.column!, { x: band.offsetLeft + el.offsetLeft, y: band.offsetTop + el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    }
    const same = next.size === boxes.size && [...next].every(([k, b]) => {
      const o = boxes.get(k);
      return o && o.x === b.x && o.y === b.y && o.w === b.w && o.h === b.h;
    });
    if (!same) {
      if (props.layout === "settling" && !props.reducedMotion) {
        for (const el of layer.current.querySelectorAll<HTMLElement>("[data-column]")) {
          const before = prevBoxes.current.get(el.dataset.column!);
          const after = next.get(el.dataset.column!);
          if (before && after && (before.x !== after.x || before.y !== after.y)) {
            el.animate([{ transform: `translate(${before.x - after.x}px, ${before.y - after.y}px)` }, { transform: "none" }], {
              duration: 250, easing: "cubic-bezier(.2,.8,.2,1)",
            });
          }
        }
      }
      prevBoxes.current = next;
      setBoxes(next);
    }
  });

  const contentRect = () => content.current!.getBoundingClientRect();

  const zoomBy = (delta: number) => {
    const r = contentRect();
    setView(zoomAround(viewRef.current, viewRef.current.zoom + delta, r.width / 2, r.height / 2));
  };

  /** A node taking keyboard focus outside the inset content area pans by the smallest amount (DP-46). */
  const keepVisible = (column: string) => {
    const el = layer.current?.querySelector<HTMLElement>(`[data-column="${CSS.escape(column)}"]`);
    if (!el || !content.current) return;
    content.current.scrollTop = 0;
    content.current.scrollLeft = 0;
    const area = contentRect();
    const box = el.getBoundingClientRect();
    let { panX, panY } = viewRef.current;
    if (box.left < area.left + INSET) panX += area.left + INSET - box.left;
    else if (box.right > area.right - INSET) panX -= box.right - (area.right - INSET);
    if (box.top < area.top + INSET) panY += area.top + INSET - box.top;
    else if (box.bottom > area.bottom - INSET) panY -= box.bottom - (area.bottom - INSET);
    if (panX !== viewRef.current.panX || panY !== viewRef.current.panY) {
      const next = { ...viewRef.current, panX, panY };
      viewRef.current = next;
      setView(next);
    }
  };

  const onGroupKey = (event: KeyboardEvent) => {
    const t = event.target as HTMLElement;
    const inControls = t.matches("[data-column], .canvas-header button");
    if (!inControls || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "+" || event.key === "=") zoomBy(0.25);
    else if (event.key === "-") zoomBy(-0.25);
    else if (event.key === "0") setView(REST_VIEW);
    else if ((event.key === "t" || event.key === "T") && props.canTrace) props.onTrace();
    else return;
    event.preventDefault();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch" || (event.target as Element).closest("[data-column]")) return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const map = pointers.current;
    const prev = map.get(event.pointerId);
    if (!prev) return;
    if (map.size === 1) {
      const next = { ...viewRef.current, panX: viewRef.current.panX + event.clientX - prev.x, panY: viewRef.current.panY + event.clientY - prev.y };
      viewRef.current = next;
      setView(next);
      map.set(event.pointerId, { x: event.clientX, y: event.clientY });
    } else if (map.size === 2) {
      const [a, b] = [...map.entries()];
      const other = a[0] === event.pointerId ? b[1] : a[1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      map.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (before > 0) {
        const r = contentRect();
        const mx = (event.clientX + other.x) / 2 - r.left;
        const my = (event.clientY + other.y) / 2 - r.top;
        const next = zoomAround(viewRef.current, viewRef.current.zoom * (after / before), mx, my);
        viewRef.current = next;
        setView(next);
      }
    }
  };
  const onPointerEnd = (event: PointerEvent) => pointers.current.delete(event.pointerId);

  const touches = useRef<{ x: number; y: number }[] | null>(null);
  /** The pinch midpoint where the second finger landed. */
  const pinchAt = useRef<{ x: number; y: number } | null>(null);
  const readTouches = (event: TouchEvent) => [...event.touches].map((t) => ({ x: t.clientX, y: t.clientY }));
  const onTouchStart = (event: TouchEvent) => {
    const started = [...event.changedTouches].some((t) => (t.target as Element).closest?.("[data-column]"));
    touches.current = started && event.touches.length === 1 ? null : readTouches(event);
    const t = touches.current;
    pinchAt.current = t && t.length === 2 ? { x: (t[0].x + t[1].x) / 2, y: (t[0].y + t[1].y) / 2 } : null;
  };
  const onTouchMove = (event: TouchEvent) => {
    const prev = touches.current;
    if (!prev) return;
    const next = readTouches(event);
    event.preventDefault();
    if (prev.length === 1 && next.length === 1) {
      const v = { ...viewRef.current, panX: viewRef.current.panX + next[0].x - prev[0].x, panY: viewRef.current.panY + next[0].y - prev[0].y };
      viewRef.current = v;
      setView(v);
    } else if (prev.length === 2 && next.length === 2) {
      const before = Math.hypot(prev[0].x - prev[1].x, prev[0].y - prev[1].y);
      const after = Math.hypot(next[0].x - next[1].x, next[0].y - next[1].y);
      if (before > 0) {
        const r = contentRect();
        const m = pinchAt.current ?? { x: (next[0].x + next[1].x) / 2, y: (next[0].y + next[1].y) / 2 };
        const v = zoomAround(viewRef.current, viewRef.current.zoom * (after / before), m.x - r.left, m.y - r.top);
        viewRef.current = v;
        setView(v);
      }
    }
    touches.current = next;
  };
  const onTouchEnd = (event: TouchEvent) => {
    touches.current = event.touches.length ? readTouches(event) : null;
    pinchAt.current = null;
  };
  const pointerHandlers = {
    onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd,
    onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd,
  };

  const drawingFloor = Math.max(LABEL_H, ...[...boxes.values()].map((b) => b.y + b.h));
  const edgePaths = d
    ? [...d.edges.values()].map((e) => {
        const a = boxes.get(e.from);
        const b = boxes.get(e.to);
        const drawn = edgeDrawn(e, d, props.trace, props.now);
        let path = "";
        let label: { x: number; y: number } | null = null;
        let seal: { x: number; y: number } | null = null;
        if (a && b) {
          if (b.x > a.x) {
            const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x - 2, y2 = b.y + b.h / 2;
            const c = (x2 - x1) / 2;
            path = `M${x1} ${y1} C${x1 + c} ${y1} ${x2 - c} ${y2} ${x2} ${y2}`;
            seal = { x: x2, y: y2 };
          } else {
            // A return arc runs under the whole drawing, so neither the arc nor its label hides behind a node.
            const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2 + 12, y2 = b.y + b.h;
            const drop = drawingFloor + RETURN_DROP;
            path = `M${x1} ${y1} C${x1} ${drop} ${x2} ${drop} ${x2} ${y2}`;
            label = { x: (x1 + x2) / 2, y: drop + 4 };
            seal = { x: x2, y: y2 };
          }
        }
        return { e, drawn, path, label, seal };
      })
    : [];

  const extentW = PAD * 2 + Math.max(1, hops.length) * BAND_PITCH;
  const returns = edgePaths.some((p) => p.label);
  const extentH = Math.max(240, drawingFloor + (returns ? RETURN_DROP + 16 : 0) + PAD);

  return (
    <div
      role="group"
      aria-label="Lineage canvas"
      class="canvas"
      data-sweep={sweep}
      data-layout={props.layout}
      data-zoom={view.zoom.toFixed(2)}
      data-pan-x={recordPan(view.panX)}
      data-pan-y={recordPan(view.panY)}
      onKeyDown={onGroupKey}
    >
      <div class="canvas-header">
        <span class="canvas-focus mono">{d ? <IdText id={d.focus} /> : ""}</span>
        <LineageHeader props={props} counter={props.trace ? progress.counted : 0} />
        {/* Always present, disabled until a drawing lands, so the header keeps its height (no layout shift). */}
        <div class="zoom-controls">
          <button type="button" class="btn btn-icon" aria-label="Zoom in" disabled={!d} onClick={() => zoomBy(0.25)}><Icon name="zoomIn" /></button>
          <button type="button" class="btn btn-icon" aria-label="Zoom out" disabled={!d} onClick={() => zoomBy(-0.25)}><Icon name="zoomOut" /></button>
          <button type="button" class="btn btn-icon" aria-label="Reset view" disabled={!d} onClick={() => setView(REST_VIEW)}><Icon name="reset" /></button>
        </div>
      </div>
      <div class="canvas-content" data-canvas-content="" ref={content} {...pointerHandlers}>
        {!d ? (
          <div class="canvas-empty">
            <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true" class="survey-mark">
              <circle cx="32" cy="32" r="22" />
              <path d="M32 4v56M4 32h56M32 22l6 10-6 10-6-10z" />
            </svg>
            <p>{props.emptyCopy}</p>
          </div>
        ) : (
          <div
            class="canvas-layer"
            ref={layer}
            style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`, width: `${extentW}px`, height: `${extentH}px` }}
          >
            <svg class="edges" width={extentW} height={extentH} aria-hidden="true">
              {edgePaths.map(({ e, drawn, path, label, seal }) => (
                <g key={e.key} class={`edge edge-${e.kind} edge-${e.state}${drawn ? " drawn" : ""}`} data-edge="" data-from={e.from} data-to={e.to}
                  data-kind={e.kind} data-drawn={String(drawn)} data-edge-state={e.state}>
                  <path class="edge-base" d={path} />
                  <path class="edge-ink" d={path} pathLength={1} />
                  {drawn && e.kind === "seal" && seal && (
                    <line data-seal="transform" class="seal-bar" x1={seal.x - 3} y1={seal.y - 8} x2={seal.x - 3} y2={seal.y + 8} />
                  )}
                  {drawn && e.kind === "cycle" && label && (
                    <g data-cycle="" class="cycle-label">
                      <text x={label.x} y={label.y} text-anchor="middle">cycle</text>
                    </g>
                  )}
                </g>
              ))}
            </svg>
            {[...bandMap].map(([hop, columns]) => (
              <div key={hop} class={`band${hop === 0 ? " band-focus" : ""}`} style={{ left: `${PAD + (hop - minHop) * BAND_PITCH}px`, top: `${LABEL_H}px`, width: `${NODE_W}px` }}>
                {columns.map((c) => <NodeBody key={c} v={byColumn.get(c)!} chosen={props.chosen} tabStop={props.tabStop} props={{ ...props, onNodeFocus: (col) => (props.onNodeFocus(col), keepVisible(col)) }} />)}
              </div>
            ))}
            {[...bandMap.keys()].map((hop) => (
              <span key={`l${hop}`} class="hop-label mono" data-hop-label={String(hop)} style={{ left: `${PAD + (hop - minHop) * BAND_PITCH}px`, width: `${NODE_W}px` }}>
                {String(Math.abs(hop))}
              </span>
            ))}
          </div>
        )}
      </div>
      <div class="canvas-strip" data-canvas-strip="" {...pointerHandlers} />
    </div>
  );
}

const sectionName = (hop: number) => (hop < 0 ? `Upstream hop ${-hop}` : hop === 0 ? "Focus" : `Hop ${hop}`);

/** The hop-stacked list below 768 pixels: same nodes, keys and sweep, no zoom, pan or edge lines. */
export function HopList(props: LineageProps) {
  const d = props.drawing;
  if (!d) return <p class="canvas-empty-copy">{props.emptyCopy}</p>;
  const views = nodeViews(d, props.trace, props.now, props.reducedMotion);
  const byColumn = new Map(views.map((v) => [v.node.column, v]));
  const drawnEdges = [...d.edges.values()].filter((e) => edgeDrawn(e, d, props.trace, props.now));
  return (
    <div class="hoplist">
      {[...bands(d)].map(([hop, columns]) => (
        <section key={hop} class="hop-section" aria-labelledby={`hop-${hop}`}>
          <h3 id={`hop-${hop}`} class="hop-heading mono">{sectionName(hop)}</h3>
          <ul class="hop-items">
            {columns.map((c) => {
              const v = byColumn.get(c)!;
              return (
                <li key={c} class="hop-item">
                  <NodeBody v={v} chosen={props.chosen} tabStop={props.tabStop} props={props} extra={
                    <>
                      {v.tags.map((t) => (
                        <span key={t} class="source-line" data-source-line={t}>
                          {`${t} from `}<span class="mono">{(v.node.sources[t] ?? []).join(", ")}</span>
                        </span>
                      ))}
                      {drawnEdges.filter((e) => e.kind === "seal" && e.to === c).slice(0, 1).map((e) => (
                        <span key={e.key} class="seal-inline" data-seal="transform">{`sealed by ${e.transform}`}</span>
                      ))}
                      {drawnEdges.filter((e) => e.kind === "cycle" && e.from === c).map((e) => (
                        <span key={e.key} class="cycle-inline" data-cycle="">cycle <span class="mono">{`to ${e.to}`}</span></span>
                      ))}
                    </>
                  } />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

