import { memo } from 'preact/compat';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { boundaryRect, connectorPath, type Box } from '../../shared/layout.ts';
import type { Derived, DocTopic } from '../../shared/model.ts';
import { COPY } from '../../shared/rules.ts';
import { ancestorsOf, childrenOf, isWithin, lockOf, rootOf } from '../../shared/tree.ts';
import { MINIMAP_STEP, boundsOf, formatPan, formatZoom, type View } from '../../shared/viewport.ts';
import { navigate } from '../router.ts';
import { Glyph } from './glyphs.tsx';
import type { ArrowKey } from './nav.ts';
import { motionOk, newOpId, type CursorInfo, type Editing, type MapSession } from './session.ts';
import { useSession } from './useSession.ts';

const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const LONG_PRESS_MS = 500;
const DRAG_PX = 8;
const EDGE_PX = 40;
const EDGE_STEP = 8;
const EDGE_MS = 16;

export interface CanvasActions {
  openMenu: (topicId: string) => void;
  openFind: () => void;
  focusBranch: () => void;
  openLink: () => void;
  addBoundary: () => void;
  openComment: (topicId: string) => void;
}

const branchColour = (colour: string): string => (colour.startsWith('#') ? colour : colour === 'accent' ? 'var(--accent)' : `var(--c-${colour})`);

interface TopicProps {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  side: string;
  colour: string;
  shape: string;
  text: string;
  icon: string;
  percent: string;
  percentText: string;
  dim: boolean;
  diff: string;
  drop: boolean;
  level: number;
  pos: number;
  size: number;
  expanded: boolean | null;
  selected: boolean;
  label: string;
  tabIndex: number;
  lines: string;
  votes: number;
  hiddenCount: number;
  blockedBy: string;
  blockedCount: number;
  overdue: boolean;
  lockedBy: string;
  editing: Editing | null;
  editVersion: number;
  onEdit: (value: string, caret: number) => void;
  onCommit: () => void;
  onCancel: () => void;
}

function TitleInput(props: { editing: Editing; onEdit: TopicProps['onEdit']; onCommit: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const { editing } = props;
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.value = editing.value;
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    if (editing.version === 1 && editing.mode === 'select') input.setSelectionRange(0, input.value.length);
    else input.setSelectionRange(editing.caret, editing.caret);
  }, [editing.version]);
  return (
    <input
      ref={ref}
      class="title-input"
      type="text"
      aria-label="Topic title"
      defaultValue={editing.value}
      onInput={(event) => props.onEdit(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)}
      onFocus={(event) => {
        const input = event.currentTarget;
        if (input.selectionStart === 0 && input.selectionEnd === 0 && editing.caret > 0) input.setSelectionRange(editing.caret, editing.caret);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          props.onCommit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          props.onCancel();
        } else if (event.key === 'Tab') event.preventDefault();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onDblClick={(event) => event.stopPropagation()}
    />
  );
}

const TopicNode = memo(function TopicNode(p: TopicProps) {
  const style = {
    left: `${p.x - Math.floor(p.w / 2)}px`,
    top: `${p.y - Math.floor(p.h / 2)}px`,
    width: `${p.w}px`,
    height: `${p.h}px`,
    '--branch': branchColour(p.colour),
  };
  const chips: string[] = [];
  if (p.percentText) chips.push(p.percentText);
  if (p.overdue) chips.push('Overdue');
  if (p.blockedBy) chips.push(`Blocked by ${p.blockedBy}`);
  if (p.blockedCount > 0) chips.push(`${p.blockedCount} blocked`);
  return (
    <div
      role="treeitem"
      class="topic"
      data-topic-id={p.id}
      data-x={p.x}
      data-y={p.y}
      data-w={p.w}
      data-h={p.h}
      data-side={p.side}
      data-colour={p.colour}
      data-shape={p.shape}
      data-text={p.text}
      data-icon={p.icon || undefined}
      data-percent={p.percent}
      data-dim={p.dim ? 'true' : undefined}
      data-diff={p.diff || undefined}
      data-drop-target={p.drop ? 'true' : undefined}
      aria-level={p.level}
      aria-setsize={p.size}
      aria-posinset={p.pos}
      aria-expanded={p.expanded === null ? undefined : p.expanded}
      aria-selected={p.selected ? 'true' : undefined}
      aria-label={p.label}
      tabIndex={p.tabIndex}
      style={style}
    >
      {p.editing ? (
        <TitleInput editing={p.editing} onEdit={p.onEdit} onCommit={p.onCommit} onCancel={p.onCancel} />
      ) : (
        <>
          {p.icon ? (
            <span class="topic-icon">
              <Glyph name={p.icon} size={16} />
            </span>
          ) : null}
          <span class="topic-title">{p.lines}</span>
          {p.votes > 0 ? (
            // The count is drawn (::before), not written: the treeitem's name says it in the published grammar ("1 vote"),
            // and the written "1" beside the title would not be part of it (WCAG 2.5.3, label in name; axe reads
            // aria-hidden text as visible). The clipped copy keeps the number in the topic's text content.
            <span class="topic-votes" aria-hidden="true">
              <Glyph name="star" size={12} />
              <span class="figure vote-figure" data-figure={p.votes} />
              <span class="visually-hidden">{p.votes}</span>
            </span>
          ) : null}
        </>
      )}
      {p.hiddenCount > 0 ? <span class="topic-collapsed figure" aria-hidden="true">{p.hiddenCount}</span> : null}
      {chips.length > 0 || p.lockedBy ? (
        <span class="topic-chips" aria-hidden="true">
          {chips.map((chip) =>
            /^\d+%$/.test(chip) ? (
              // The figure is drawn, not written: the label already says "N% done", and the written text would sit
              // out of order against it (WCAG 2.5.3, label in name).
              <span key={chip} class="chip chip-figure figure" data-figure={chip} />
            ) : (
              <span key={chip} class="chip figure">
                {chip}
              </span>
            ),
          )}
          {p.lockedBy ? (
            <span class="chip chip-lock">
              <Glyph name="lock" size={12} />
              Locked by {p.lockedBy}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
});

/** Which topics are in the page: all of them, or on a large map only those near the view. */
function pageIds(session: MapSession): string[] {
  const { layout, settings, view, size } = session;
  const all = layout.order.filter((id) => layout.boxes.has(id) && session.shown(id));
  const byCreation = (a: string, b: string): number => (session.display.topics[a]?.n ?? 0) - (session.display.topics[b]?.n ?? 0);
  if (all.length < settings.virtual_from) return [...all].sort(byCreation);
  const keep = new Set<string>();
  const focus = session.display.topics[session.focusId];
  if (focus) {
    keep.add(focus.id);
    for (const a of ancestorsOf(session.display.topics, focus.id)) keep.add(a.id);
  }
  const margin = settings.dom_margin_px;
  const cx = size.w / 2;
  const cy = size.h / 2;
  const near: { id: string; d: number }[] = [];
  for (const id of all) {
    const b = layout.boxes.get(id) as Box;
    const left = (b.x - b.w / 2) * view.zoom + view.panX;
    const right = (b.x + b.w / 2) * view.zoom + view.panX;
    const top = (b.y - b.h / 2) * view.zoom + view.panY;
    const bottom = (b.y + b.h / 2) * view.zoom + view.panY;
    if (right < -margin || left > size.w + margin || bottom < -margin || top > size.h + margin) continue;
    if (keep.has(id)) continue;
    near.push({ id, d: Math.hypot((left + right) / 2 - cx, (top + bottom) / 2 - cy) });
  }
  near.sort((a, b) => a.d - b.d);
  for (const entry of near) {
    if (keep.size >= settings.dom_ceiling) break;
    keep.add(entry.id);
  }
  const rest = all
    .filter((id) => !keep.has(id))
    .map((id) => {
      const b = layout.boxes.get(id) as Box;
      return { id, d: Math.hypot(b.x * view.zoom + view.panX - cx, b.y * view.zoom + view.panY - cy) };
    })
    .sort((a, b) => a.d - b.d);
  for (const entry of rest) {
    if (keep.size >= settings.dom_ceiling) break;
    keep.add(entry.id);
  }
  return all.filter((id) => keep.has(id)).sort(byCreation);
}

function Connectors(props: { session: MapSession; ids: Set<string>; drawFirst: boolean }) {
  const { session, ids } = props;
  const { display, layout, derived } = session;
  const paths: preact.JSX.Element[] = [];
  for (const id of ids) {
    const topic = display.topics[id];
    const box = layout.boxes.get(id);
    const parent = topic?.parent_id ? layout.boxes.get(topic.parent_id) : undefined;
    if (!topic || !box || !parent || !topic.parent_id || !ids.has(topic.parent_id)) continue;
    const colour = derived.get(id)?.colour ?? 'accent';
    const heavy = (session.places.get(id)?.level ?? 3) <= 2;
    paths.push(
      <path
        key={id}
        class={`connector${props.drawFirst && heavy ? ' connector-draw' : ''}`}
        data-connector={id}
        d={connectorPath(display.layout, parent, box)}
        style={{ stroke: branchColour(colour) }}
        stroke-width={heavy ? 6 : 4}
        fill="none"
        stroke-linecap="round"
        pathLength={1}
      />,
    );
  }
  return <>{paths}</>;
}

function nearestShown(session: MapSession, id: string): string | null {
  if (session.layout.boxes.has(id)) return id;
  for (const a of ancestorsOf(session.display.topics, id)) if (session.layout.boxes.has(a.id)) return a.id;
  return null;
}

function Links(props: { session: MapSession; ids: Set<string> }) {
  const { session } = props;
  const out: preact.JSX.Element[] = [];
  for (const link of session.display.links) {
    const from = nearestShown(session, link.from);
    const to = nearestShown(session, link.to);
    if (!from || !to || from === to || !props.ids.has(from) || !props.ids.has(to)) continue;
    const a = session.layout.boxes.get(from) as Box;
    const b = session.layout.boxes.get(to) as Box;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 - 40;
    out.push(
      <g key={link.id}>
        <path
          class={`cross-link ${link.type}`}
          data-from={link.from}
          data-to={link.to}
          data-drawn-from={from}
          data-drawn-to={to}
          d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`}
          fill="none"
          marker-end={link.type === 'depends' ? 'url(#arrow)' : undefined}
        />
        {link.label ? (
          <text x={mx} y={(a.y + b.y) / 2 - 20} class="link-label" text-anchor="middle">
            {link.label}
          </text>
        ) : null}
      </g>,
    );
  }
  return <>{out}</>;
}

function Boundaries(props: { session: MapSession }) {
  const { session } = props;
  const out: preact.JSX.Element[] = [];
  for (const boundary of session.display.boundaries) {
    if (!session.layout.boxes.has(boundary.topic_id) || !session.shown(boundary.topic_id)) continue;
    const rect = boundaryRect(session.layout, session.display, boundary.topic_id);
    if (!rect) continue;
    out.push(
      <g key={boundary.id}>
        <rect
          class="boundary"
          data-boundary={boundary.id}
          data-x={rect.x}
          data-y={rect.y}
          data-w={rect.w}
          data-h={rect.h}
          x={rect.x - Math.floor(rect.w / 2)}
          y={rect.y - Math.floor(rect.h / 2)}
          width={rect.w}
          height={rect.h}
          rx={18}
          fill="none"
        />
        {boundary.label ? (
          <text class="link-label" x={rect.x} y={rect.y - Math.floor(rect.h / 2) - 6} text-anchor="middle">
            {boundary.label}
          </text>
        ) : null}
      </g>,
    );
  }
  return <>{out}</>;
}

function Presence(props: { session: MapSession }) {
  const { session } = props;
  const out: preact.JSX.Element[] = [];
  for (const cursor of session.cursors.values()) {
    if (cursor.user === session.me.name) continue;
    out.push(<RemoteCursor key={`c-${cursor.user}`} cursor={cursor} session={session} />);
    const box = cursor.topicId ? session.layout.boxes.get(cursor.topicId) : undefined;
    if (box) {
      out.push(
        <div
          key={`r-${cursor.user}`}
          class="selection-ring"
          data-selected-by={cursor.user}
          data-colour={cursor.colour}
          style={{
            left: `${box.x - Math.floor(box.w / 2) - 5}px`,
            top: `${box.y - Math.floor(box.h / 2) - 5}px`,
            width: `${box.w + 10}px`,
            height: `${box.h + 10}px`,
            '--branch': branchColour(cursor.colour),
          }}
        />,
      );
    }
  }
  return <>{out}</>;
}

function RemoteCursor(props: { cursor: CursorInfo; session: MapSession }) {
  const { cursor } = props;
  const label = props.session.people.find((p) => p.name === cursor.user);
  return (
    <div class="remote-cursor" data-user={cursor.user} data-colour={cursor.colour} style={{ left: `${cursor.x}px`, top: `${cursor.y}px`, '--branch': branchColour(cursor.colour) }}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path d="M2 2l12 5-5 2-2 5z" fill="var(--branch)" />
      </svg>
      <span class="remote-name">
        {cursor.user}
        {label?.guest ? ' (guest)' : ''}
      </span>
    </div>
  );
}

function Minimap(props: { session: MapSession }) {
  const { session } = props;
  const boxes = [...session.layout.boxes.values()].filter((b) => session.shown(b.id));
  const rect = {
    x: -session.view.panX / session.view.zoom,
    y: -session.view.panY / session.view.zoom,
    w: session.size.w / session.view.zoom,
    h: session.size.h / session.view.zoom,
  };
  const bounds = boundsOf(boxes) ?? { left: -100, top: -50, right: 100, bottom: 50 };
  const pad = 40;
  const left = Math.min(bounds.left, rect.x) - pad;
  const top = Math.min(bounds.top, rect.y) - pad;
  const view = {
    x: left,
    y: top,
    w: Math.max(bounds.right, rect.x + rect.w) + pad - left,
    h: Math.max(bounds.bottom, rect.y + rect.h) + pad - top,
  };
  const pct = (value: number, origin: number, total: number): string => `${(((value - origin) / total) * 100).toFixed(3)}%`;
  const drawn = boxes.map((b) => `M${b.x - b.w / 2},${b.y - b.h / 2}h${b.w}v${b.h}h${-b.w}z`).join('');
  const centre = (event: MouseEvent): void => {
    const target = event.currentTarget as HTMLElement;
    const r = target.getBoundingClientRect();
    const x = view.x + ((event.clientX - r.left) / r.width) * view.w;
    const y = view.y + ((event.clientY - r.top) / r.height) * view.h;
    session.setView({ ...session.view, panX: session.size.w / 2 - x * session.view.zoom, panY: session.size.h / 2 - y * session.view.zoom });
  };
  const onKey = (event: KeyboardEvent): void => {
    const step: Record<string, [number, number]> = { ArrowRight: [-MINIMAP_STEP, 0], ArrowLeft: [MINIMAP_STEP, 0], ArrowDown: [0, -MINIMAP_STEP], ArrowUp: [0, MINIMAP_STEP] };
    const move = step[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    session.panBy(move[0], move[1]);
  };
  return (
    <div role="region" aria-label="Minimap" class="map-minimap" onPointerDown={(event) => event.stopPropagation()}>
      <div class="map-minimap-surface" onClick={centre}>
        <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <path d={drawn} class="map-minimap-topics" />
        </svg>
        <button
          type="button"
          class="map-minimap-view"
          aria-label="Visible area"
          onKeyDown={onKey}
          onClick={(event) => event.stopPropagation()}
          style={{ left: pct(rect.x, view.x, view.w), top: pct(rect.y, view.y, view.h), width: `${Math.min(100, (rect.w / view.w) * 100).toFixed(3)}%`, height: `${Math.min(100, (rect.h / view.h) * 100).toFixed(3)}%` }}
        />
      </div>
    </div>
  );
}

type Gesture =
  | { kind: 'pan'; start: View; x: number; y: number; moved: boolean }
  | { kind: 'topic'; id: string; x: number; y: number; dragging: boolean; pressed: boolean; timer: number | null; touch: boolean }
  | { kind: 'pinch'; start: View; distance: number };

export function Canvas(props: { session: MapSession; actions: CanvasActions }) {
  const { session, actions } = props;
  useSession(session);
  const regionRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const edgeTimer = useRef<number | null>(null);
  const edgeDir = useRef({ x: 0, y: 0 });
  const previous = useRef({ layout: session.display.layout, boxes: new Map<string, { x: number; y: number }>(), zoom: session.view.zoom });
  const hadChildren = useRef(true);

  const ids = useMemo(() => pageIds(session), [session.layout, session.view, session.size, session.focusId, session.focusBranch, session.settings]);
  const idSet = useMemo(() => new Set(ids), [ids]);
  const root = rootOf(session.display.topics);
  const empty = root !== undefined && childrenOf(session.display.topics, root.id).length === 0 && session.shown(root.id);
  const drawFirst = !hadChildren.current && !empty;
  const dropTarget = session.dropTarget;

  // Measure the canvas.
  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!region) return undefined;
    const measure = (): void => {
      const r = region.getBoundingClientRect();
      if (r.width !== session.size.w || r.height !== session.size.h) session.setSize(r.width, r.height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    return () => observer.disconnect();
  }, [session]);

  // Wheel needs a non-passive listener so it can stop the page scrolling.
  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!region) return undefined;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const r = region.getBoundingClientRect();
      if (event.ctrlKey) session.zoomWheel(event.deltaY, event.clientX - r.left, event.clientY - r.top);
      else session.panBy(-event.deltaX, -event.deltaY);
    };
    region.addEventListener('wheel', onWheel, { passive: false });
    return () => region.removeEventListener('wheel', onWheel);
  }, [session]);

  // Focus requests: bring the topic into view, then focus its element.
  useLayoutEffect(() => {
    const wanted = session.focusWanted;
    if (!wanted || !session.display.topics[wanted]) return;
    session.keepFocusInView(wanted);
    if (session.focusIn !== 'map') return;
    const element = treeRef.current?.querySelector<HTMLElement>(`[data-topic-id="${CSS.escape(wanted)}"]`);
    if (!element) return;
    if (document.activeElement !== element) element.focus({ preventScroll: true });
    session.focusWanted = null;
  });

  // Published animations: regrow on a layout switch, enter for new topics.
  useLayoutEffect(() => {
    const prev = previous.current;
    const mode = session.display.layout;
    const tree = treeRef.current;
    const stage = stageRef.current;
    if (tree && stage && motionOk()) {
      if (prev.layout !== mode) {
        for (const id of ids) {
          const old = prev.boxes.get(id);
          const box = session.layout.boxes.get(id);
          const element = tree.querySelector<HTMLElement>(`[data-topic-id="${CSS.escape(id)}"]`);
          if (!old || !box || !element) continue;
          const dx = (old.x - box.x) * session.view.zoom;
          const dy = (old.y - box.y) * session.view.zoom;
          element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }], { duration: 320, easing: EASE, id: 'regrow-topic' });
        }
        for (const connector of stage.querySelectorAll<SVGElement>('[data-connector]')) {
          connector.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 320, easing: EASE, fill: 'backwards', id: 'regrow-connector' });
        }
      }
      for (const id of session.entering) {
        const element = tree.querySelector<HTMLElement>(`[data-topic-id="${CSS.escape(id)}"]`);
        element?.animate([{ transform: 'scale(0.9)' }, { transform: 'scale(1)' }], { duration: 160, easing: EASE, id: 'topic-enter' });
      }
    }
    session.entering = new Set();
    previous.current = { layout: mode, boxes: new Map([...session.layout.boxes].map(([id, b]) => [id, { x: b.x, y: b.y }])), zoom: session.view.zoom };
    hadChildren.current = !empty;
  });

  // The presentation camera: Fit to screen glides while presenting.
  useLayoutEffect(() => {
    const from = session.cameraFrom;
    const stage = stageRef.current;
    if (!from) return;
    session.cameraFrom = null;
    if (!stage || !motionOk()) return;
    const v = session.view;
    stage.animate(
      [
        { transform: `translate(${from.panX}px, ${from.panY}px) scale(${from.zoom})` },
        { transform: `translate(${v.panX}px, ${v.panY}px) scale(${v.zoom})` },
      ],
      { duration: 400, easing: EASE, id: 'camera' },
    );
  });

  const toLocal = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = (regionRef.current as HTMLElement).getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  };

  const stopEdge = (): void => {
    if (edgeTimer.current !== null) window.clearInterval(edgeTimer.current);
    edgeTimer.current = null;
    edgeDir.current = { x: 0, y: 0 };
  };

  const edgePan = (point: { x: number; y: number }): void => {
    const dir = {
      x: point.x < EDGE_PX ? 1 : point.x > session.size.w - EDGE_PX ? -1 : 0,
      y: point.y < EDGE_PX ? 1 : point.y > session.size.h - EDGE_PX ? -1 : 0,
    };
    edgeDir.current = dir;
    if (dir.x === 0 && dir.y === 0) {
      stopEdge();
      return;
    }
    if (edgeTimer.current === null) {
      edgeTimer.current = window.setInterval(() => session.panBy(edgeDir.current.x * EDGE_STEP, edgeDir.current.y * EDGE_STEP), EDGE_MS);
    }
  };

  const clearPress = (g: Gesture | null): void => {
    if (g?.kind === 'topic' && g.timer !== null) window.clearTimeout(g.timer);
  };

  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target as HTMLElement;
    if (target.closest('.title-input, button, .map-minimap, .band')) return;
    if (session.editing) session.commitEdit();
    pointers.current.set(event.pointerId, toLocal(event));
    if (pointers.current.size === 2) {
      clearPress(gesture.current);
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = { kind: 'pinch', start: session.view, distance: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    const topicEl = target.closest<HTMLElement>('[data-topic-id]');
    const at = toLocal(event);
    if (topicEl) {
      const id = topicEl.dataset.topicId as string;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        session.toggleSelect(id);
        topicEl.focus({ preventScroll: true });
        return;
      }
      session.clearSelection();
      session.setFocus(id);
      const touch = event.pointerType !== 'mouse';
      const g: Gesture = { kind: 'topic', id, x: at.x, y: at.y, dragging: false, pressed: false, timer: null, touch };
      if (touch) {
        g.timer = window.setTimeout(() => {
          g.pressed = true;
          g.timer = null;
          topicEl.focus({ preventScroll: true });
          actions.openMenu(id);
        }, LONG_PRESS_MS);
      }
      gesture.current = g;
      return;
    }
    session.clearSelection();
    gesture.current = { kind: 'pan', start: session.view, x: at.x, y: at.y, moved: false };
  };

  const onPointerMove = (event: PointerEvent): void => {
    const at = toLocal(event);
    if (event.pointerType === 'mouse') {
      const m = session.view;
      session.sendCursor((at.x - m.panX) / m.zoom, (at.y - m.panY) / m.zoom, event.timeStamp);
    }
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, at);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      const pts = [...pointers.current.values()];
      const a = pts[0];
      const b = pts[1];
      if (!a || !b) return;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      session.pinch(g.start, (g.start.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / g.distance, mid.x, mid.y);
      return;
    }
    if (g.kind === 'pan') {
      const dx = at.x - g.x;
      const dy = at.y - g.y;
      if (Math.hypot(dx, dy) > 0) g.moved = true;
      session.setView({ ...g.start, panX: g.start.panX + dx, panY: g.start.panY + dy });
      return;
    }
    if (g.pressed) return;
    if (!g.dragging && Math.hypot(at.x - g.x, at.y - g.y) > DRAG_PX) {
      clearPress(g);
      if (!session.canEdit) return;
      g.dragging = true;
    }
    if (!g.dragging) return;
    const under = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-topic-id]');
    const targetId = under?.dataset.topicId ?? null;
    const valid = targetId !== null && !isWithin(session.display.topics, targetId, g.id);
    const next = valid ? targetId : null;
    if (next !== session.dropTarget) {
      session.dropTarget = next;
      if (next) session.announce(`Drop to make ${session.label(g.id)} a child of ${session.label(next)}`);
      session.notify();
    }
    edgePan(at);
  };

  const finishGesture = (event: PointerEvent, cancelled: boolean): void => {
    if (!pointers.current.delete(event.pointerId)) return;
    const g = gesture.current;
    if (pointers.current.size > 0 && g?.kind === 'pinch') {
      gesture.current = null;
      return;
    }
    gesture.current = null;
    stopEdge();
    clearPress(g);
    if (g?.kind === 'topic' && g.dragging && !cancelled) {
      const target = session.dropTarget;
      session.dropTarget = null;
      if (target) {
        const last = childrenOf(session.display.topics, target).filter((t) => t.id !== g.id).at(-1);
        if (session.collapsed.has(target)) session.setCollapsed(target, false);
        session.submit([{ op_id: newOpId(), kind: 'move', topic_id: g.id, parent_id: target, after: last?.id ?? null }]);
      }
      session.notify();
      return;
    }
    if (g?.kind === 'topic') {
      session.dropTarget = null;
      if (g.touch && !g.pressed) session.requestFocus(g.id);
    }
  };

  const latest = useRef({ move: onPointerMove, finish: finishGesture });
  latest.current = { move: onPointerMove, finish: finishGesture };
  useLayoutEffect(() => {
    const move = (event: PointerEvent): void => latest.current.move(event);
    const up = (event: PointerEvent): void => latest.current.finish(event, false);
    const cancel = (event: PointerEvent): void => latest.current.finish(event, true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      if (edgeTimer.current !== null) window.clearInterval(edgeTimer.current);
    };
  }, []);

  const idOf = (event: Event): string | null => (event.target as HTMLElement).closest<HTMLElement>('[data-topic-id]')?.dataset.topicId ?? null;

  const onKeyDown = (event: KeyboardEvent): void => {
    if ((event.target as HTMLElement).tagName === 'INPUT') return;
    const id = idOf(event);
    if (!id) return;
    if (id !== session.focusId) session.setFocus(id);
    const key = event.key;
    const ctrl = event.ctrlKey || event.metaKey;
    const done = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (ctrl && key.toLowerCase() === 'z') {
      done();
      if (event.shiftKey) session.redo();
      else session.undo();
    } else if (ctrl && key.toLowerCase() === 'c') {
      done();
      session.copy();
    } else if (ctrl && key.toLowerCase() === 'v') {
      done();
      session.paste();
    } else if (ctrl && key.toLowerCase() === 'f' && event.shiftKey) {
      done();
      actions.focusBranch();
    } else if (ctrl && key.toLowerCase() === 'f') {
      done();
      actions.openFind();
    } else if (ctrl && event.shiftKey && key.toLowerCase() === 'l') {
      done();
      if (session.guardEdit()) actions.openLink();
    } else if (ctrl && event.shiftKey && key.toLowerCase() === 'b') {
      done();
      if (session.guardEdit()) actions.addBoundary();
    } else if (event.altKey && key === 'Enter') {
      done();
      session.addFloating();
    } else if (event.altKey && key.startsWith('Arrow')) {
      done();
      if (event.shiftKey) session.moveFloating(key as ArrowKey);
      else session.move(key as ArrowKey);
    } else if (event.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      done();
      session.extendSelection(key === 'ArrowDown' ? 1 : -1);
    } else if (!ctrl && !event.altKey && key.startsWith('Arrow')) {
      done();
      session.arrow(key as ArrowKey);
    } else if (key === 'Home' || key === 'End') {
      done();
      session.jump(key);
    } else if (key === 'Tab' && !event.shiftKey && !ctrl) {
      done();
      session.addChild(session.focusId);
    } else if (key === 'Enter' && !ctrl) {
      done();
      session.addSibling(session.focusId);
    } else if (key === 'F2') {
      done();
      session.startRename(session.focusId, null);
    } else if (key === 'Delete') {
      done();
      session.deleteSelection();
    } else if (key === ' ') {
      done();
      session.toggleCollapse(session.focusId);
    } else if (key === 'ContextMenu' || (event.shiftKey && key === 'F10')) {
      done();
      actions.openMenu(session.focusId);
    } else if (key.length === 1 && !ctrl && !event.altKey) {
      done();
      session.startRename(session.focusId, key);
    }
  };

  const places = session.places;
  const counts = session.counts;
  const view = session.view;

  return (
    <div
      ref={regionRef}
      role="region"
      aria-label="Canvas"
      class="canvas"
      onPointerDown={onPointerDown}
      onContextMenu={(event) => {
        const id = idOf(event);
        if (!id) return;
        event.preventDefault();
        actions.openMenu(id);
      }}
      onDblClick={(event) => {
        const id = idOf(event);
        if (id) session.startRename(id, null);
      }}
    >
      <div
        ref={stageRef}
        class="stage"
        data-zoom={formatZoom(view.zoom)}
        data-pan-x={formatPan(view.panX)}
        data-pan-y={formatPan(view.panY)}
        data-layout={session.display.layout}
        data-revision={session.revision}
        style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
      >
        <svg class="layer" width="1" height="1" overflow="visible" aria-hidden="true">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0,1 L10,5 L0,9 z" class="arrow-head" />
            </marker>
          </defs>
          <Boundaries session={session} />
          <Connectors session={session} ids={idSet} drawFirst={drawFirst} />
          <Links session={session} ids={idSet} />
          {empty && root && session.layout.boxes.has(root.id) ? (
            <path class="empty-ribbon" d={`M${(session.layout.boxes.get(root.id) as Box).x + 120},${(session.layout.boxes.get(root.id) as Box).y} C${(session.layout.boxes.get(root.id) as Box).x + 200},${(session.layout.boxes.get(root.id) as Box).y} ${(session.layout.boxes.get(root.id) as Box).x + 240},${(session.layout.boxes.get(root.id) as Box).y - 40} ${(session.layout.boxes.get(root.id) as Box).x + 320},${(session.layout.boxes.get(root.id) as Box).y - 40}`} fill="none" stroke-linecap="round" />
          ) : null}
        </svg>
        <div
          ref={treeRef}
          role="tree"
          aria-label="Map"
          class="tree"
          onKeyDown={onKeyDown}
          onFocusIn={(event) => {
            const id = idOf(event);
            session.focusIn = 'map';
            if (id && id !== session.focusId) session.setFocus(id);
          }}
        >
          {ids.map((id) => {
            const topic = session.display.topics[id] as DocTopic;
            const box = session.layout.boxes.get(id) as Box;
            const d = session.derived.get(id) as Derived;
            const place = places.get(id) ?? { level: 1, pos: 1, size: 1 };
            const lock = lockOf(session.display.topics, id);
            const collapsed = session.collapsed.has(id);
            const editing = session.editing?.topicId === id && session.editing.where === 'map' ? session.editing : null;
            const blocker = d.blocked_by[0] ? (session.display.topics[d.blocked_by[0]]?.title ?? '') : '';
            return (
              <TopicNode
                key={id}
                id={id}
                x={box.x}
                y={box.y}
                w={box.w}
                h={box.h}
                side={box.side}
                colour={d.colour}
                shape={d.shape}
                text={d.text}
                icon={topic.icon ?? ''}
                percent={typeof d.percent === 'number' ? String(d.percent) : ''}
                percentText={typeof d.percent === 'number' ? `${d.percent}%` : d.percent === 'dash' ? '—' : ''}
                dim={session.isDimmed(id)}
                diff={session.diffMarks.get(id) ?? ''}
                drop={dropTarget === id}
                level={place.level}
                pos={place.pos}
                size={place.size}
                expanded={d.subtopics > 0 ? !collapsed : null}
                selected={session.selection.includes(id)}
                label={session.labelFor(id)}
                tabIndex={session.focusId === id ? 0 : -1}
                lines={box.lines.join('\n')}
                votes={counts.votes[id] ?? 0}
                hiddenCount={collapsed ? d.subtopics : 0}
                blockedBy={blocker}
                blockedCount={d.blocked_count}
                overdue={d.overdue}
                lockedBy={lock?.holder ?? ''}
                editing={editing}
                editVersion={editing?.version ?? 0}
                onEdit={(value, caret) => session.editInput(value, caret)}
                onCommit={() => session.commitEdit()}
                onCancel={() => session.cancelEdit()}
              />
            );
          })}
        </div>
        <Presence session={session} />
      </div>
      {empty ? <p class="empty-prompt">{COPY.empty_map}</p> : null}
      {session.focusBranch ? <Breadcrumb session={session} /> : null}
      <Minimap session={session} />
    </div>
  );
}

function Breadcrumb(props: { session: MapSession }) {
  const { session } = props;
  const focus = session.focusBranch;
  if (!focus) return null;
  const chain = ancestorsOf(session.display.topics, focus).reverse();
  return (
    <nav aria-label="Breadcrumb" class="breadcrumb">
      <ol>
        {chain.map((topic, at) => (
          <li key={topic.id}>
            <a
              href={`/m/${session.mapId}${at === 0 ? '' : `?focus=${encodeURIComponent(topic.id)}`}`}
              onClick={(event) => {
                event.preventDefault();
                navigate(`/m/${session.mapId}${at === 0 ? '' : `?focus=${encodeURIComponent(topic.id)}`}`);
              }}
            >
              {topic.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
