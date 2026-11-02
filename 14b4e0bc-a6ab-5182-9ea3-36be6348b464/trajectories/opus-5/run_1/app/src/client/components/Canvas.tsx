import { type ReactNode, useEffect, useRef } from 'react';
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import type { Tag } from '../../shared/domain.ts';
import { type CanvasNode, bandNodes, bandsOf, formatZoom, roundPan } from '../lib/canvas.ts';
import { COPY } from '../lib/copy.ts';
import { useAppState } from '../lib/hooks.ts';
import { type AppState, store } from '../lib/store.ts';
import { DeprecationFlag, TagGlyph } from './glyphs.tsx';

const FOCUS_INSET = 16;

function nodeAttributes(node: CanvasNode, selected: boolean): Record<string, string> {
  return {
    'data-column': node.column,
    'data-hop': String(node.hop),
    'data-lit': String(node.lit),
    'data-tags': node.tags.join(' '),
    'data-deprecated': String(node.deprecated),
    'data-deprecated-upstream': node.deprecatedUpstream,
    'data-selected': String(selected),
  };
}

function sourceLines(node: CanvasNode): ReactNode {
  return node.tags.map((tag) => {
    const sources = node.sources[tag] ?? [];
    return (
      <span key={tag} data-source-line={tag} className="source-line mono">
        {COPY.hopSourceLine(tag, sources)}
      </span>
    );
  });
}

function hopBadge(state: AppState, node: CanvasNode): ReactNode {
  if (state.motion !== 'reduced' || node.hop <= 0 || !node.lit) return null;
  return <span data-hop-badge className="mono">{node.hop}</span>;
}

function sealMark(node: CanvasNode): ReactNode {
  const show = node.sealedTags.length > 0 && (node.hop < 0 || (node.hop > 0 && node.lit));
  return show ? <span data-seal="suppression" className="seal" /> : null;
}

interface NodeProps {
  node: CanvasNode;
  state: AppState;
  onOpen: (columnId: string) => void;
  showSources: boolean;
}

function NodeButton({ node, state, onOpen, showSources }: NodeProps): ReactNode {
  const selected = state.selectedNode === node.column;
  const roving = (state.focusedNode ?? state.selectedNode ?? state.params.column) === node.column;
  return (
    <button
      type="button"
      className="node"
      tabIndex={roving ? 0 : -1}
      data-focus-key={`node:${node.column}`}
      {...nodeAttributes(node, selected)}
      onFocus={() => store.setFocusedNode(node.column)}
      onClick={() => store.chooseNode(node.column)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          store.chooseNode(node.column);
          onOpen(node.column);
        }
        if (event.key === ' ') {
          event.preventDefault();
          store.chooseNode(node.column);
        }
      }}
    >
      <span className="node-label">{node.column}</span>
      <span className="node-marks">
        {node.tags.map((tag) => (
          <TagGlyph key={tag} tag={tag as Tag} />
        ))}
        {node.deprecated || node.deprecatedUpstream !== '' ? <DeprecationFlag /> : null}
        {hopBadge(state, node)}
        {sealMark(node)}
      </span>
      {showSources ? <span className="node-sources">{sourceLines(node)}</span> : null}
    </button>
  );
}

function CycleArc(): ReactNode {
  return (
    <span data-cycle className="cycle-arc">
      cycle
    </span>
  );
}

function moveFocus(state: AppState, key: string): string | null {
  const canvas = state.canvas;
  if (canvas === null) return null;
  const current = state.focusedNode ?? state.params.column;
  if (current === null) return null;
  const node = canvas.nodes.find((entry) => entry.column === current);
  if (node === undefined) return null;
  const bands = bandsOf(canvas.nodes);
  const band = bandNodes(canvas.nodes, node.hop);
  const rowIndex = band.findIndex((entry) => entry.column === current);

  if (key === 'Home') return state.params.column;
  if (key === 'End') {
    const downstream = bands.filter((hop) => hop > 0);
    if (downstream.length === 0) return state.params.column;
    const deepest = bandNodes(canvas.nodes, downstream[downstream.length - 1]);
    return deepest[deepest.length - 1]?.column ?? current;
  }
  if (key === 'ArrowUp') return band[Math.max(0, rowIndex - 1)]?.column ?? current;
  if (key === 'ArrowDown') return band[Math.min(band.length - 1, rowIndex + 1)]?.column ?? current;

  const direction = key === 'ArrowRight' ? 1 : -1;
  const targetHop = node.hop + direction;
  if (!bands.includes(targetHop)) return current;
  const targetBand = bandNodes(canvas.nodes, targetHop);
  const linked = targetBand.filter((candidate) =>
    canvas.edges.some(
      (edge) =>
        edge.kind !== 'cycle' &&
        ((direction === 1 && edge.from === current && edge.to === candidate.column) ||
          (direction === -1 && edge.to === current && edge.from === candidate.column)),
    ),
  );
  if (linked.length > 0) return linked[0].column;
  return (targetBand[rowIndex] ?? targetBand[targetBand.length - 1])?.column ?? current;
}

function useKeyboardNavigation(inRail: boolean): (event: React.KeyboardEvent) => void {
  const state = useAppState();
  return (event: React.KeyboardEvent): void => {
    const key = event.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) {
      const target = document.activeElement as HTMLElement | null;
      if (target?.dataset.column === undefined) return;
      event.preventDefault();
      const next = moveFocus(state, key);
      if (next !== null) {
        store.setFocusedNode(next);
        store.requestFocus(`node:${next}`);
      }
      return;
    }
    if (key === 't' || key === 'T') {
      event.preventDefault();
      void store.traceImpact();
      return;
    }
    if (inRail) return;
    const content = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
      '[data-canvas-content]',
    );
    const width = content?.clientWidth ?? 0;
    const height = content?.clientHeight ?? 0;
    if (key === '+' || key === '=') store.zoomBy(1, width, height);
    if (key === '-') store.zoomBy(-1, width, height);
    if (key === '0') store.resetView();
  };
}

function CanvasHeader({ inRail }: { inRail: boolean }): ReactNode {
  const state = useAppState();
  return (
    <div className="canvas-header">
      <span className="mono focus-column">{state.params.column ?? ''}</span>
      {store.canTrace() ? (
        <button
          type="button"
          data-focus-key="trace-impact"
          onClick={() => void store.traceImpact()}
        >
          Trace impact
        </button>
      ) : null}
      <span className="mono" data-sweep-count>
        {state.sweepProgress.counter}
      </span>
      {inRail ? null : (
        <>
          <button type="button" data-focus-key="zoom-in" onClick={() => zoomFromHeader(1)}>
            <ZoomIn size={14} aria-hidden="true" /> Zoom in
          </button>
          <button type="button" data-focus-key="zoom-out" onClick={() => zoomFromHeader(-1)}>
            <ZoomOut size={14} aria-hidden="true" /> Zoom out
          </button>
          <button type="button" data-focus-key="reset-view" onClick={() => store.resetView()}>
            <RotateCcw size={14} aria-hidden="true" /> Reset view
          </button>
        </>
      )}
      <span role="status" aria-label="Trace summary">
        {state.traceSummary}
      </span>
      <span role="status" aria-label="Lineage status">
        {state.lineageStatus}
      </span>
    </div>
  );
}

function zoomFromHeader(direction: 1 | -1): void {
  const content = document.querySelector<HTMLElement>('[data-canvas-content]');
  store.zoomBy(direction, content?.clientWidth ?? 0, content?.clientHeight ?? 0);
}

/** The lineage canvas: hop bands left and right of the focus column, with an empty bottom strip. */
export function LineageCanvas(): ReactNode {
  const state = useAppState();
  const onKeyDown = useKeyboardNavigation(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const canvas = state.canvas;

  useKeepFocusedNodeVisible(contentRef, state);
  usePointerGestures(contentRef);

  const bands = canvas === null ? [] : bandsOf(canvas.nodes);
  return (
    <section
      role="group"
      aria-label="Lineage canvas"
      className="canvas-group"
      data-canvas-group
      data-sweep={state.sweepState}
      data-layout={state.layout}
      data-zoom={formatZoom(state.view.zoom)}
      data-pan-x={roundPan(state.view.panX)}
      data-pan-y={roundPan(state.view.panY)}
      onKeyDown={onKeyDown}
    >
      <CanvasHeader inRail={false} />
      <div className="canvas-content" data-canvas-content ref={contentRef}>
        {canvas === null ? (
          <p className="empty">{COPY.noAssetOpen}</p>
        ) : (
          <div
            className="canvas-plane"
            style={{
              transform: `translate(${state.view.panX}px, ${state.view.panY}px) scale(${state.view.zoom})`,
            }}
          >
            {bands.map((hop) => (
              <div key={hop} className={`band ${hop === 0 ? 'band-focus' : ''}`}>
                <span className="mono hop-label" data-hop-label={hop}>
                  {Math.abs(hop)}
                </span>
                {bandNodes(canvas.nodes, hop).map((node) => (
                  <NodeButton
                    key={node.column}
                    node={node}
                    state={state}
                    showSources={false}
                    onOpen={(columnId) => store.openColumn(columnId, true)}
                  />
                ))}
              </div>
            ))}
            <div className="edges">
              {canvas.edges.map((edge) => (
                <span
                  key={edge.id}
                  data-edge
                  data-from={edge.from}
                  data-to={edge.to}
                  data-kind={edge.kind}
                  data-drawn={String(edge.drawn)}
                  data-edge-state={edge.state}
                  className={`edge edge-${edge.kind} ${edge.drawn ? 'drawn' : ''} ${
                    edge.state === 'new' ? 'edge-new' : ''
                  }`}
                >
                  {edge.kind === 'seal' && edge.drawn ? <span data-seal="transform" /> : null}
                  {edge.kind === 'cycle' && edge.drawn ? <CycleArc /> : null}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="canvas-strip" data-canvas-strip />
    </section>
  );
}

/** The hop-stacked list inside the Lineage rail, with no zoom, pan or edge lines. */
export function HopList(): ReactNode {
  const state = useAppState();
  const onKeyDown = useKeyboardNavigation(true);
  const canvas = state.canvas;
  const bands = canvas === null ? [] : bandsOf(canvas.nodes);
  return (
    <div className="hop-list" onKeyDown={onKeyDown}>
      <CanvasHeader inRail />
      {canvas === null ? <p className="empty">{COPY.noAssetOpen}</p> : null}
      {bands.map((hop) => (
        <section key={hop}>
          <h3>{hop === 0 ? 'Focus' : hop < 0 ? `Upstream hop ${-hop}` : `Hop ${hop}`}</h3>
          <ul>
            {bandNodes(canvas?.nodes ?? [], hop).map((node) => (
              <li key={node.column}>
                <NodeButton
                  node={node}
                  state={state}
                  showSources
                  onOpen={(columnId) => store.openColumn(columnId, true)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {canvas !== null && canvas.edges.some((edge) => edge.kind === 'cycle' && edge.drawn) ? (
        <CycleArc />
      ) : null}
    </div>
  );
}

/** Pans by the smallest amount that brings a newly focused node fully inside the content area. */
function useKeepFocusedNodeVisible(
  contentRef: React.MutableRefObject<HTMLDivElement | null>,
  state: AppState,
): void {
  useEffect(() => {
    const content = contentRef.current;
    const focused = state.focusedNode;
    if (content === null || focused === null) return;
    const node = content.querySelector<HTMLElement>(`[data-column="${CSS.escape(focused)}"]`);
    if (node === null || document.activeElement !== node) return;
    const area = content.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    let deltaX = 0;
    let deltaY = 0;
    if (box.left - area.left < FOCUS_INSET) deltaX = FOCUS_INSET - (box.left - area.left);
    else if (area.right - box.right < FOCUS_INSET) deltaX = -(FOCUS_INSET - (area.right - box.right));
    if (box.top - area.top < FOCUS_INSET) deltaY = FOCUS_INSET - (box.top - area.top);
    else if (area.bottom - box.bottom < FOCUS_INSET) deltaY = -(FOCUS_INSET - (area.bottom - box.bottom));
    if (deltaX !== 0 || deltaY !== 0) store.panBy(deltaX, deltaY);
  }, [contentRef, state.focusedNode, state.canvas]);
}

/** One-finger drag pans, including from the empty strip; a two-finger pinch zooms. */
function usePointerGestures(contentRef: React.MutableRefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const content = contentRef.current;
    if (content === null) return;
    const group = content.closest<HTMLElement>('[data-canvas-group]');
    if (group === null) return;
    const strip = group.querySelector<HTMLElement>('[data-canvas-strip]');

    let dragging: { x: number; y: number } | null = null;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { distance: number; zoom: number; panX: number; panY: number } | null = null;

    const pannableTarget = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null;
      if (element === null) return false;
      if (strip !== null && strip.contains(element)) return true;
      if (!content.contains(element)) return false;
      return element.closest('.node') === null && element.closest('button') === null;
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (!pannableTarget(event.target)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) dragging = { x: event.clientX, y: event.clientY };
      if (pointers.size === 2) {
        const [first, second] = [...pointers.values()];
        const view = store.getState().view;
        pinch = {
          distance: Math.hypot(first.x - second.x, first.y - second.y),
          zoom: view.zoom,
          panX: view.panX,
          panY: view.panY,
        };
        dragging = null;
      }
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch !== null && pointers.size === 2) {
        const [first, second] = [...pointers.values()];
        const distance = Math.hypot(first.x - second.x, first.y - second.y);
        if (pinch.distance === 0) return;
        const area = content.getBoundingClientRect();
        const midX = (first.x + second.x) / 2 - area.left;
        const midY = (first.y + second.y) / 2 - area.top;
        const nextZoom = Math.min(2, Math.max(0.5, pinch.zoom * (distance / pinch.distance)));
        const ratio = nextZoom / pinch.zoom;
        store.setView({
          zoom: nextZoom,
          panX: midX - (midX - pinch.panX) * ratio,
          panY: midY - (midY - pinch.panY) * ratio,
        });
        return;
      }
      if (dragging !== null) {
        store.panBy(event.clientX - dragging.x, event.clientY - dragging.y);
        dragging = { x: event.clientX, y: event.clientY };
      }
    };

    const onPointerUp = (event: PointerEvent): void => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) dragging = null;
    };

    group.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      group.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [contentRef]);
}
