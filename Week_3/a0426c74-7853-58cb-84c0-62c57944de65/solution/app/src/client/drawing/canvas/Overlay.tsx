// What the pane draws over the world group, in screen space so it keeps its size at every zoom: the selection window, grips, the snap marker,
// the rubber band, remote crosshairs and rings, issue pins, markups and the swipe divider.
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { animateWithId } from '../../ui/index.ts';
import { arcPath, distance, fmtData, worldToScreen } from '../../../shared/geometry/index.ts';
import type { SnapKind, View } from '../../../shared/geometry/index.ts';
import type { EntityDraft, Markup, Point } from '../../../shared/types.ts';
import { GEOMETRY_CHANGED_LABEL } from '../../../shared/copy.ts';
import { swipeFromPointer } from '../../../shared/rules.ts';
import { GRIP_HALF_PX, REMOTE_SELECTION_LIMIT } from '../../store/drawingStore.ts';
import type { DrawingStore } from '../../store/drawingStore.ts';
import { useStoreSlice } from '../../store/hooks.tsx';
import type { SceneStore } from '../../store/sceneStore.ts';
import { cameraTransform } from './cameraTransform.ts';
import type { CompareLayers, IssuePin } from './types.ts';

const SNAP_HALF_PX = 6;
const RING_PAD_PX = 4;
const CROSS_ARM_PX = 10;
const PIN_RADIUS_PX = 9;
const PIN_STEM_PX = 14;
const FLAG_OFFSET_PX = 16;
const ARROW_HEAD_PX = 10;
const CLOUD_BUMP_PX = 14;

const at = (view: View, x: number, y: number): Point => worldToScreen(view, [x, y]);

function SnapMarker({ kind, x, y }: { kind: SnapKind; x: number; y: number }): ReactElement {
  const h = SNAP_HALF_PX;
  const shape: Record<SnapKind, ReactElement> = {
    endpoint: <rect x={-h} y={-h} width={2 * h} height={2 * h} />,
    midpoint: <path d={`M ${-h} ${h} L ${h} ${h} L 0 ${-h} Z`} />,
    centre: <circle r={h} />,
    intersection: <path d={`M ${-h} ${-h} L ${h} ${h} M ${h} ${-h} L ${-h} ${h}`} />,
    perpendicular: <path d={`M ${-h} ${-h} L ${-h} ${h} L ${h} ${h} M ${-h} 0 L 0 0 L 0 ${h}`} />,
    tangent: <path d={`M ${-h} ${-h} L ${h} ${-h} M ${h} 0 A ${h} ${h} 0 1 1 ${h - 0.01} 0`} />,
    nearest: <path d={`M ${-h} ${-h} L ${h} ${-h} L ${-h} ${h} L ${h} ${h} Z`} />,
  };
  return <g className="canvas-snap" data-snap-marker={kind} transform={`translate(${x} ${y})`}>{shape[kind]}</g>;
}

/** The rubber band: ghosts of what the running stage would make. Only the shapes that have a simple outline are previewed. */
function Ghost({ draft }: { draft: EntityDraft }): ReactElement | null {
  switch (draft.type) {
    case 'line': return <line x1={draft.x1} y1={draft.y1} x2={draft.x2} y2={draft.y2} />;
    case 'circle': return <circle cx={draft.cx} cy={draft.cy} r={draft.r} />;
    case 'pline': return draft.closed
      ? <polygon points={draft.points.map((p) => p.join(',')).join(' ')} />
      : <polyline points={draft.points.map((p) => p.join(',')).join(' ')} />;
    case 'arc': return <path d={arcPath([draft.cx, draft.cy], draft.r, draft.start, draft.end)} />;
    default: return null;
  }
}

function LiveOverlay({ live, view }: { live: DrawingStore; view: View }) {
  const preview = useStoreSlice(live, (snapshot) => snapshot.preview);
  const cursors = useStoreSlice(live, (snapshot) => snapshot.cursors);
  const { scene } = live.getSnapshot();
  return (
    <>
      <g className="canvas-ghost" style={{ transform: cameraTransform(view) }}>
        {preview.map((draft, index) => <Ghost key={index} draft={draft} />)}
      </g>
      {cursors.map((cursor) => {
        const colour = { color: `var(--presence-${cursor.colour})` };
        return (
          <g key={cursor.username} style={colour}>
            {cursor.selection.slice(0, REMOTE_SELECTION_LIMIT).map((id) => {
              const bounds = scene.byId.get(id)?.bounds;
              if (!bounds) return null;
              const [left, bottom] = at(view, bounds[0], bounds[1]);
              const [right, top] = at(view, bounds[2], bounds[3]);
              return <rect key={id} className="canvas-ring" x={left - RING_PAD_PX} y={top - RING_PAD_PX} width={right - left + 2 * RING_PAD_PX} height={bottom - top + 2 * RING_PAD_PX} />;
            })}
            {cursor.x !== null && cursor.y !== null && (
              <g className="canvas-crosshair" data-colour={cursor.colour} data-x={fmtData(cursor.x)} data-y={fmtData(cursor.y)} transform={`translate(${at(view, cursor.x, cursor.y).join(' ')})`}>
                <line x1={-CROSS_ARM_PX} y1={0} x2={CROSS_ARM_PX} y2={0} />
                <line x1={0} y1={-CROSS_ARM_PX} x2={0} y2={CROSS_ARM_PX} />
                <text x={CROSS_ARM_PX} y={-CROSS_ARM_PX}>{cursor.username}</text>
              </g>
            )}
          </g>
        );
      })}
    </>
  );
}

function PinMarker({ pin, view, fresh }: { pin: IssuePin; view: View; fresh: boolean }) {
  const marker = useRef<SVGGElement>(null);
  const [x, y] = at(view, pin.x, pin.y);
  useLayoutEffect(() => {
    if (fresh && marker.current) animateWithId(marker.current, [{ transform: 'scale(0.8)' }, { transform: 'scale(1)' }], { id: 'sheet-pin', duration: 200 });
  }, [fresh]);
  return (
    <g transform={`translate(${x} ${y})`}>
      <g ref={marker} className="canvas-pin" data-issue-pin={pin.id} style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
        <title>{pin.title}</title>
        <path d={`M 0 0 L 0 ${-PIN_STEM_PX}`} stroke="var(--ink-bright)" strokeWidth={1.5} />
        <circle cx={0} cy={-PIN_STEM_PX - PIN_RADIUS_PX} r={PIN_RADIUS_PX} />
      </g>
    </g>
  );
}

function Pins({ pins, view }: { pins: readonly IssuePin[]; view: View }) {
  const [present] = useState(() => new Set(pins.map((pin) => pin.id)));
  return <>{pins.map((pin) => <PinMarker key={pin.id} pin={pin} view={view} fresh={!present.has(pin.id)} />)}</>;
}

/** A cloud outlined by bumps along the box, an arrow with a head at its second point, or text at its first point. */
function MarkupMark({ markup, view }: { markup: Markup; view: View }) {
  const [x1, y1] = at(view, markup.x1, markup.y1);
  const [x2, y2] = at(view, markup.x2, markup.y2);
  const flag = markup.flag === null ? {} : { 'data-flag': markup.flag };
  let shape: ReactElement;
  if (markup.kind === 'arrow') {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = (turn: number): string => `${x2 - ARROW_HEAD_PX * Math.cos(angle + turn)} ${y2 - ARROW_HEAD_PX * Math.sin(angle + turn)}`;
    shape = <path d={`M ${x1} ${y1} L ${x2} ${y2} M ${head(0.4)} L ${x2} ${y2} L ${head(-0.4)}`} />;
  } else if (markup.kind === 'text') {
    shape = <text x={x1} y={y1}>{markup.text}</text>;
  } else {
    const [left, right, top, bottom] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)];
    const edge = (fromX: number, fromY: number, toX: number, toY: number): string => {
      const bumps = Math.max(1, Math.round(distance([fromX, fromY], [toX, toY]) / CLOUD_BUMP_PX));
      const step = [(toX - fromX) / bumps, (toY - fromY) / bumps];
      return Array.from({ length: bumps }, (_, i) => `A ${CLOUD_BUMP_PX / 2} ${CLOUD_BUMP_PX / 2} 0 0 1 ${fromX + step[0] * (i + 1)} ${fromY + step[1] * (i + 1)}`).join(' ');
    };
    shape = <path d={`M ${left} ${top} ${edge(left, top, right, top)} ${edge(right, top, right, bottom)} ${edge(right, bottom, left, bottom)} ${edge(left, bottom, left, top)}`} />;
  }
  return (
    <g className="canvas-markup" data-markup={markup.kind} {...flag}>
      {shape}
      {markup.flag !== null && <text className="canvas-flag" x={Math.min(x1, x2)} y={Math.max(y1, y2) + FLAG_OFFSET_PX}>{GEOMETRY_CHANGED_LABEL}</text>}
    </g>
  );
}

/** The swipe divider at `swipe` percent of the pane; a change of the percent slides it with the `compare-swipe` animation. */
function SwipeDivider({ compare, width, height, onChange }: { compare: CompareLayers; width: number; height: number; onChange: ((percent: number) => void) | undefined }) {
  const divider = useRef<SVGGElement>(null);
  const shown = useRef(compare.swipe);
  const x = (width * compare.swipe) / 100;
  useLayoutEffect(() => {
    const before = (width * shown.current) / 100;
    shown.current = compare.swipe;
    if (divider.current && before !== x) {
      animateWithId(divider.current, [{ transform: `translateX(${before}px)` }, { transform: `translateX(${x}px)` }], { id: 'compare-swipe', duration: 120 });
    }
  }, [compare.swipe, width, x]);
  const move = (clientX: number, target: SVGGElement): void => {
    const left = target.ownerSVGElement?.getBoundingClientRect().left ?? 0;
    onChange?.(swipeFromPointer(clientX - left, width));
  };
  return (
    <g
      ref={divider} className="canvas-divider" data-swipe-divider="" style={{ transform: `translateX(${x}px)`, visibility: compare.overlay ? 'hidden' : undefined }}
      onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (event.buttons === 1) move(event.clientX, event.currentTarget); }}
    >
      <line x1={0} y1={0} x2={0} y2={height} />
      <circle cx={0} cy={height / 2} r={7} />
    </g>
  );
}

interface OverlayProps {
  store: SceneStore;
  live: DrawingStore | undefined;
  compare: CompareLayers | null;
  pins: readonly IssuePin[];
  markups: readonly Markup[];
  onSwipeChange: ((percent: number) => void) | undefined;
}

export function Overlay({ store, live, compare, pins, markups, onSwipeChange }: OverlayProps) {
  const view = useStoreSlice(store, (snapshot) => snapshot.view);
  const pane = useStoreSlice(store, (snapshot) => snapshot.pane);
  const grips = useStoreSlice(store, (snapshot) => snapshot.grips);
  const selectionWindow = useStoreSlice(store, (snapshot) => snapshot.window);
  const snap = useStoreSlice(store, (snapshot) => snapshot.hover.snap);
  const [snapX, snapY] = snap ? worldToScreen(view, snap.point) : [0, 0];
  return (
    <g className="canvas-overlay">
      {live && <LiveOverlay live={live} view={view} />}
      {markups.map((markup) => <MarkupMark key={markup.id} markup={markup} view={view} />)}
      <Pins pins={pins} view={view} />
      {selectionWindow && <rect className="canvas-window" data-window={selectionWindow.mode} x={selectionWindow.x} y={selectionWindow.y} width={selectionWindow.width} height={selectionWindow.height} />}
      {grips.map(({ entity, grip }) => {
        const [x, y] = at(view, grip.x, grip.y);
        return (
          <rect
            key={`${entity}:${grip.kind}:${grip.index}`} className="canvas-grip" data-grip={grip.kind} data-x={fmtData(grip.x)} data-y={fmtData(grip.y)}
            x={x - GRIP_HALF_PX} y={y - GRIP_HALF_PX} width={2 * GRIP_HALF_PX} height={2 * GRIP_HALF_PX}
          />
        );
      })}
      {snap && <SnapMarker kind={snap.kind} x={snapX} y={snapY} />}
      {compare && <SwipeDivider compare={compare} width={pane.width} height={pane.height} onChange={onSwipeChange} />}
    </g>
  );
}
