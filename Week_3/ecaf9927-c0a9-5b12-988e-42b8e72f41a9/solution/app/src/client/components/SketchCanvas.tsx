import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
import type { Constraint, ConstraintKind, Entity, Point2, Sketch } from '../../shared/api';
import { formatDimension } from '../../shared/units';
import { glyphAnchor, toScreen, toWorld, type View, entityById } from '../lib/geometry';
import { prefersReducedMotion } from '../lib/overlay';
import { useWorkbench } from '../workbench';

const RING_PX_PER_FREEDOM = 6;
const RING_MS = 230;
const COUNT_MS = 333;
const FLASH_MS = 167;
const SNAP_MM = 0.5;

interface NavItem {
  ref: string;
  name: string;
  at: Point2;
  kind: 'origin' | 'entity' | 'point';
}

/** The order of the roving highlight: the origin, then each entity in creation order, each followed by its points. */
function navigation(sketch: Sketch): NavItem[] {
  const items: NavItem[] = [{ ref: 'origin', name: 'Origin', at: { x: 0, y: 0 }, kind: 'origin' }];
  for (const entity of sketch.entities) {
    if (entity.type === 'point') {
      items.push({ ref: entity.id, name: entity.label, at: { x: entity.x, y: entity.y }, kind: 'point' });
      continue;
    }
    const centre = entity.type === 'line' ? { x: (entity.start.x + entity.end.x) / 2, y: (entity.start.y + entity.end.y) / 2 } : entity.center;
    items.push({ ref: entity.id, name: entity.label, at: centre, kind: 'entity' });
    for (const p of sketch.points.filter((point) => point.ref.startsWith(`${entity.id}.`))) {
      items.push({ ref: p.ref, name: p.name, at: { x: p.x, y: p.y }, kind: 'point' });
    }
  }
  return items;
}

function entityPath(entity: Entity, view: View): string | null {
  if (entity.type === 'line') {
    const a = toScreen(view, entity.start);
    const b = toScreen(view, entity.end);
    return `M${a.x} ${a.y}L${b.x} ${b.y}`;
  }
  if (entity.type === 'arc') {
    const rad = Math.PI / 180;
    const start = entity.start_angle_deg * rad;
    const sweep = ((((entity.end_angle_deg - entity.start_angle_deg) * rad) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
    const a = toScreen(view, { x: entity.center.x + entity.radius * Math.cos(start), y: entity.center.y + entity.radius * Math.sin(start) });
    const b = toScreen(view, { x: entity.center.x + entity.radius * Math.cos(start + sweep), y: entity.center.y + entity.radius * Math.sin(start + sweep) });
    const r = entity.radius * view.scale;
    return `M${a.x} ${a.y}A${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 0 ${b.x} ${b.y}`;
  }
  return null;
}

const GLYPH_SYMBOLS: Partial<Record<ConstraintKind, string>> = {
  coincident: 'M-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
  horizontal: 'M-5 0H5',
  vertical: 'M0 -5V5',
  parallel: 'M-5 3L1 -4M-1 4L5 -3',
  perpendicular: 'M-5 4H5M0 4V-4',
  equal: 'M-5 -2H5M-5 2H5',
  fix: 'M-4 -4H4V4H-4Z',
};

interface GlyphProps {
  label: string;
  kind: ConstraintKind;
  text?: string;
  at: Point2;
  ghost?: boolean;
  named?: boolean;
  outlined?: boolean;
}

function Glyph({ label, kind, text, at, ghost, named, outlined }: GlyphProps) {
  const symbol = GLYPH_SYMBOLS[kind];
  const width = symbol ? 26 : Math.max(30, 12 + (text?.length ?? 0) * 7.4);
  return (
    <g
      role="img"
      aria-label={label}
      className={`glyph${ghost ? ' ghost' : ''}${named ? ' named' : ''}${outlined ? ' conflict' : ''}`}
      data-glyph={ghost ? 'ghost' : label}
      transform={`translate(${at.x} ${at.y})`}
    >
      <rect x={-width / 2} y={-11} width={width} height={22} rx={5} />
      {outlined && <rect className="outline" x={-width / 2 + 3} y={-8} width={width - 6} height={16} rx={3} />}
      {symbol ? <path d={symbol} fill="none" /> : <text y={4} textAnchor="middle" className="num">{text}</text>}
    </g>
  );
}

interface Props {
  sketch: Sketch;
  camera: View;
  setCamera: (view: View) => void;
  width: number;
  height: number;
}

export function SketchCanvas({ sketch, camera, setCamera, width, height }: Props) {
  const wb = useWorkbench();
  const { selection, cursor, tool, slackShown, motion, flash, steadyConflict, member } = wb;
  const unit = member?.units ?? 'mm';
  const precision = member?.precision ?? 2;
  const group = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const items = useMemo(() => navigation(sketch), [sketch]);
  const [draft, setDraft] = useState<Point2[]>([]);
  const [hover, setHover] = useState<Point2 | null>(null);
  const pointers = useRef(new Map<number, Point2>());
  const gesture = useRef<{ moved: boolean; start: Point2; camera: View; ref?: string; pinch?: number; mid?: Point2 } | null>(null);
  const reduced = prefersReducedMotion();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const held = slackShown === 0;
  const countFrom = useRef(sketch.slack);
  /** Bumped by every change so a late finish of an older animation does nothing. */
  const run = useRef(0);

  /** Each whole number between the old total and the new one is shown once, evenly spaced over a third of a second. */
  const countTo = (from: number, target: number) => {
    const steps = Math.abs(target - from);
    if (steps === 0) {
      wb.setSlackShown(target);
      return;
    }
    for (let k = 1; k <= steps; k++) {
      timers.current.push(setTimeout(() => wb.setSlackShown(from + Math.sign(target - from) * k), (COUNT_MS / steps) * k));
    }
  };

  useEffect(() => {
    wb.registerCanvasFocus(() => group.current?.focus());
    return () => wb.registerCanvasFocus(null);
  }, [wb]);

  /* ---- slack rings: resize first, then the readout counts ---- */
  const freedoms = (s: Sketch) => new Map(s.points.map((p) => [p.ref, p.freedom as number]));
  const [rings, setRings] = useState(() => new Map<string, { freedom: number; from?: number }>([...freedoms(sketch)].map(([ref, freedom]) => [ref, { freedom }])));
  const previous = useRef(sketch);
  const lastMotion = useRef(motion);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = sketch;
    if (before.id !== sketch.id) {
      setRings(new Map([...freedoms(sketch)].map(([ref, freedom]) => [ref, { freedom }])));
      return;
    }
    if (before.revision === sketch.revision) return;
    const animate = motion !== lastMotion.current;
    lastMotion.current = motion;
    // A change that arrives while the last one is still counting settles the readout on the last one first.
    run.current += 1;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    wb.setSlackShown(before.slack);
    countFrom.current = before.slack;
    const old = freedoms(before);
    const next = new Map<string, { freedom: number; from?: number }>();
    for (const [ref, freedom] of freedoms(sketch)) {
      const was = old.get(ref) ?? 0;
      next.set(ref, was === freedom ? { freedom } : { freedom, from: was });
    }
    if (reduced || !animate) {
      setRings(new Map([...next].map(([ref, ring]) => [ref, { freedom: ring.freedom }])));
      wb.setSlackShown(sketch.slack);
      return;
    }
    if (![...next.values()].some((ring) => ring.from !== undefined)) {
      setRings(new Map([...next].map(([ref, ring]) => [ref, { freedom: ring.freedom }])));
      countTo(before.slack, sketch.slack);
      return;
    }
    setRings(next);
  }, [sketch]);

  useEffect(() => {
    const moving = [...rings].filter(([, ring]) => ring.from !== undefined);
    if (moving.length === 0 || !svg.current) return;
    const target = sketch.slack;
    const animations = moving.flatMap(([ref, ring]) => {
      const element = svg.current?.querySelector<SVGElement>(`[data-ring="${CSS.escape(ref)}"]`);
      if (!element) return [];
      const big = Math.max(ring.freedom, ring.from ?? 0);
      return [
        element.animate([{ transform: `scale(${(ring.from ?? 0) / big})` }, { transform: `scale(${ring.freedom / big})` }], {
          duration: RING_MS,
          easing: 'cubic-bezier(.2,.9,.2,1)',
          fill: 'forwards',
        }),
      ];
    });
    // The animations are stepped by the page's own frame clock rather than left to play on their own,
    // so the rings and the readout that follows them always agree on when the rings are done.
    animations.forEach((a) => a.pause());
    const mine = run.current;
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      if (mine !== run.current) return;
      const elapsed = Math.min(now - started, RING_MS);
      animations.forEach((a) => (a.currentTime = elapsed));
      if (elapsed < RING_MS) {
        frame = requestAnimationFrame(step);
        return;
      }
      animations.forEach((a) => a.cancel());
      flushSync(() => setRings(new Map([...rings].map(([ref, ring]) => [ref, { freedom: ring.freedom }]))));
      countTo(countFrom.current, target);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [rings]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /* ---- conflict flash: the ghost and the named glyph turn red and back, twice ---- */
  useEffect(() => {
    if (!flash || reduced || !svg.current) return;
    const nodes = [...svg.current.querySelectorAll<SVGElement>('[data-glyph="ghost"], .glyph.named')];
    const animations = nodes.map((node) =>
      node.animate([{ color: 'var(--ink)' }, { color: 'var(--danger)', offset: 0.5 }, { color: 'var(--ink)' }], { duration: FLASH_MS, iterations: 2, easing: 'ease-in-out' }),
    );
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      animations.forEach((a) => a.cancel());
      wb.clearFlash();
    };
    void Promise.all(animations.map((a) => a.finished)).then(finish, () => undefined);
    const timer = setTimeout(finish, FLASH_MS * 2 + 30);
    return () => clearTimeout(timer);
  }, [flash]);

  /* ---- selection ---- */
  const toggle = useCallback(
    (ref: string, how: 'replace' | 'toggle') => {
      wb.setCursor(ref);
      if (how === 'replace') wb.select(selection.length === 1 && selection[0] === ref ? [] : [ref]);
      else wb.select(selection.includes(ref) ? selection.filter((r) => r !== ref) : [...selection, ref]);
    },
    [wb, selection],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return;
    if (steadyConflict || flash) wb.clearConflictOutline();
    const at = Math.max(0, items.findIndex((i) => i.ref === cursor));
    const move = (to: number) => {
      event.preventDefault();
      wb.setCursor((items[(to + items.length) % items.length] as NavItem).ref);
    };
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        return move(at + 1);
      case 'ArrowLeft':
      case 'ArrowUp':
        return move(at - 1);
      case ' ':
      case 'Enter':
        event.preventDefault();
        return toggle((items[at] as NavItem).ref, 'toggle');
      case '+':
      case '=':
        event.preventDefault();
        return setCamera(zoomed(camera, 1.25, width / 2, height / 2));
      case '-':
      case '_':
        event.preventDefault();
        return setCamera(zoomed(camera, 0.8, width / 2, height / 2));
    }
  };

  /* ---- pointer: pan, zoom, draw ---- */
  const place = useCallback(
    async (points: Point2[]) => {
      const [a, b, c] = points as [Point2, Point2, Point2];
      const mm = (p: Point2) => ({ x: p.x, y: p.y });
      if (tool === 'line') await wb.placeEntity({ type: 'line', start: mm(a), end: mm(b) });
      if (tool === 'circle') await wb.placeEntity({ type: 'circle', center: mm(a), radius: Math.hypot(b.x - a.x, b.y - a.y) });
      if (tool === 'arc') {
        const angle = (p: Point2) => (Math.atan2(p.y - a.y, p.x - a.x) * 180) / Math.PI;
        await wb.placeEntity({ type: 'arc', center: mm(a), radius: Math.hypot(b.x - a.x, b.y - a.y), start_angle_deg: angle(b), end_angle_deg: angle(c) });
      }
      if (tool === 'point') await wb.placeEntity({ type: 'point', x: a.x, y: a.y });
      wb.setTool('select');
      group.current?.focus();
    },
    [tool, wb],
  );

  const localPoint = (event: { clientX: number; clientY: number }): Point2 => {
    const box = group.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };
  const snapped = (p: Point2): Point2 => {
    const w = toWorld(camera, p);
    return { x: Math.round(w.x / SNAP_MM) * SNAP_MM, y: Math.round(w.y / SNAP_MM) * SNAP_MM };
  };
  const needed = { line: 2, circle: 2, arc: 3, point: 1 } as const;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (steadyConflict || flash) wb.clearConflictOutline();
    group.current?.focus({ preventScroll: true });
    const point = localPoint(event);
    pointers.current.set(event.pointerId, point);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const pinch = pointers.current.size === 2 ? distance([...pointers.current.values()] as [Point2, Point2]) : undefined;
    gesture.current = { moved: false, start: point, camera, pinch, ref: (event.target as Element).closest<SVGElement>('[data-ref]')?.dataset['ref'] };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = localPoint(event);
    if (tool !== 'select') setHover(snapped(point));
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, point);
    const g = gesture.current;
    if (pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()] as [Point2, Point2];
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const zoom = zoomed(camera, g.pinch ? distance([p, q]) / g.pinch : 1, mid.x, mid.y);
      setCamera({ ...zoom, ox: zoom.ox + mid.x - (g.mid?.x ?? mid.x), oy: zoom.oy + mid.y - (g.mid?.y ?? mid.y) });
      g.pinch = distance([p, q]);
      g.mid = mid;
      g.moved = true;
      return;
    }
    if (Math.hypot(point.x - g.start.x, point.y - g.start.y) > 4) g.moved = true;
    if (g.moved && tool === 'select') setCamera({ ...g.camera, ox: g.camera.ox + point.x - g.start.x, oy: g.camera.oy + point.y - g.start.y });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
    if (!g || g.moved) return;
    const ref = g.ref;
    if (tool === 'select') {
      if (ref) toggle(ref, event.pointerType === 'touch' || event.shiftKey ? 'toggle' : 'replace');
      else wb.select([]);
      return;
    }
    const next = [...draft, snapped(localPoint(event))];
    if (next.length >= needed[tool]) {
      setDraft([]);
      void place(next);
    } else setDraft(next);
  };

  useEffect(() => {
    const node = group.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = node.getBoundingClientRect();
      setCamera(zoomed(camera, event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - box.left, event.clientY - box.top));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [camera, setCamera]);

  useEffect(() => setDraft([]), [tool]);

  /* ---- drawing ---- */
  const strokeClass = `stroke ${held ? 'held' : 'slack'}`;
  const selected = new Set(selection);
  const cursorItem = items.find((i) => i.ref === cursor);
  const constraintFor = (label: string): Constraint | undefined => sketch.constraints.find((c) => c.label === label);
  const named = flash ? constraintFor(flash.namedLabel) : undefined;

  /** Glyphs start beside what they constrain and step aside when another glyph already sits there. */
  const glyphPlaces = useMemo(() => {
    const placed: Point2[] = [];
    const places = new Map<string, Point2>();
    const steps: [number, number][] = [[0, 0], [30, 0], [0, -26], [30, -26], [-30, 0], [-30, -26], [0, 26], [30, 26], [60, 0], [60, -26]];
    const entries = [...sketch.constraints.map((c) => ({ key: c.id, kind: c.kind, refs: c.refs })), ...(flash ? [{ key: 'ghost', kind: flash.kind, refs: flash.refs }] : [])];
    for (const entry of entries) {
      const anchor = toScreen(camera, glyphAnchor(sketch, entry.kind, entry.refs));
      const spot = steps
        .map(([dx, dy]) => ({ x: anchor.x + 14 + dx, y: anchor.y - 16 + dy }))
        .find((candidate) => placed.every((other) => Math.abs(other.x - candidate.x) >= 30 || Math.abs(other.y - candidate.y) >= 24));
      const chosen = spot ?? { x: anchor.x + 14, y: anchor.y - 16 };
      placed.push(chosen);
      places.set(entry.key, chosen);
    }
    return places;
  }, [sketch, camera, flash]);
  const glyphAt = (key: string): Point2 => glyphPlaces.get(key) ?? { x: 0, y: 0 };
  const glyphText = (c: Constraint): string | undefined =>
    c.value_mm === undefined ? undefined : formatDimension(c.value_mm, c.tolerance, unit, precision, false);

  return (
    <div
      ref={group}
      role="group"
      aria-label="Sketch canvas"
      tabIndex={0}
      className="sketch-canvas"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => {
        pointers.current.delete(event.pointerId);
        gesture.current = null;
      }}
    >
      <svg ref={svg} width={width} height={height} viewBox={`0 0 ${width} ${height}`} focusable="false">
        <g className="strokes">
          {sketch.entities.map((entity) => {
            const isSelected = selected.has(entity.id);
            if (entity.type === 'point') {
              const p = toScreen(camera, entity);
              return (
                <g key={entity.id}>
                  {isSelected && <circle className="halo" cx={p.x} cy={p.y} r={6} />}
                  <circle className={`${strokeClass} dot`} cx={p.x} cy={p.y} r={isSelected ? 4 : 3} />
                </g>
              );
            }
            const path = entityPath(entity, camera);
            const centre = entity.type === 'circle' ? toScreen(camera, entity.center) : null;
            return (
              <g key={entity.id}>
                {isSelected && (path ? <path className="halo" d={path} /> : centre && <circle className="halo" cx={centre.x} cy={centre.y} r={(entity as Extract<Entity, { type: 'circle' }>).radius * camera.scale} />)}
                {path ? (
                  <path className={`${strokeClass}${isSelected ? ' selected' : ''}`} d={path} />
                ) : (
                  centre && <circle className={`${strokeClass}${isSelected ? ' selected' : ''}`} cx={centre.x} cy={centre.y} r={(entity as Extract<Entity, { type: 'circle' }>).radius * camera.scale} fill="none" />
                )}
              </g>
            );
          })}
          {(() => {
            const o = toScreen(camera, { x: 0, y: 0 });
            return <path className="origin-mark" d={`M${o.x - 7} ${o.y}H${o.x + 7}M${o.x} ${o.y - 7}V${o.y + 7}`} />;
          })()}
        </g>

        <g className="glyphs">
          {sketch.constraints.map((c) => (
            <Glyph
              key={c.id}
              label={c.label}
              kind={c.kind}
              text={glyphText(c)}
              at={glyphAt(c.id)}
              named={named?.id === c.id}
              outlined={named?.id === c.id && steadyConflict && reduced}
            />
          ))}
          {flash && (steadyConflict || !reduced) && (
            <Glyph
              label={flash.refusedLabel}
              kind={flash.kind}
              text={flash.value === undefined ? undefined : formatDimension(flash.value, undefined, unit, precision, false)}
              at={glyphAt('ghost')}
              ghost
              outlined={reduced}
            />
          )}
        </g>

        <g className="targets" style={{ pointerEvents: tool === 'select' ? 'all' : 'none' }}>
          {sketch.entities.map((entity) => {
            if (entity.type === 'point') return null;
            const path = entityPath(entity, camera);
            const centre = entity.type === 'circle' ? toScreen(camera, entity.center) : null;
            return (
              <g key={entity.id} role="button" tabIndex={-1} aria-label={entity.label} aria-pressed={selected.has(entity.id)} data-ref={entity.id}>
                {path ? <path className="target" d={path} /> : centre && <circle className="target" cx={centre.x} cy={centre.y} r={(entity as Extract<Entity, { type: 'circle' }>).radius * camera.scale} fill="none" />}
              </g>
            );
          })}
          <g role="button" tabIndex={-1} aria-label="Origin" aria-pressed={selected.has('origin')} data-ref="origin">
            <circle className="target-point" {...pointProps(toScreen(camera, { x: 0, y: 0 }))} />
          </g>
          {sketch.points.map((p) => {
            const entity = entityById(sketch, p.ref.split('.')[0] as string);
            return (
              <g key={p.ref} role="button" tabIndex={-1} aria-label={p.name} aria-pressed={selected.has(p.ref)} data-ref={p.ref} className={entity?.type === 'point' ? 'point-target' : undefined}>
                <circle className="target-point" {...pointProps(toScreen(camera, p))} />
              </g>
            );
          })}
        </g>

        <g className="rings" aria-hidden={false}>
          {sketch.points.map((p) => {
            const ring = rings.get(p.ref);
            if (!ring) return null;
            const big = Math.max(ring.freedom, ring.from ?? 0);
            if (big === 0) return null;
            const at = toScreen(camera, p);
            return <circle key={p.ref} role="img" aria-label={`Slack ring at ${p.name}`} data-ring={p.ref} className="ring" cx={at.x} cy={at.y} r={RING_PX_PER_FREEDOM * big} />;
          })}
        </g>

        {cursorItem && (
          <g>
            <circle className="cursor-gap" {...pointProps(toScreen(camera, cursorItem.at))} r={cursorItem.kind === 'entity' ? 9 : 13} />
            <circle className="cursor-ring" {...pointProps(toScreen(camera, cursorItem.at))} r={cursorItem.kind === 'entity' ? 9 : 13} />
          </g>
        )}
        {draft.map((p, i) => {
          const at = toScreen(camera, p);
          return <circle key={i} className="draft" cx={at.x} cy={at.y} r={4} />;
        })}
        {draft.length > 0 && hover && tool === 'line' && (
          <path className="draft-line" d={`M${toScreen(camera, draft[0] as Point2).x} ${toScreen(camera, draft[0] as Point2).y}L${toScreen(camera, hover).x} ${toScreen(camera, hover).y}`} />
        )}
      </svg>
    </div>
  );
}

const pointProps = (p: Point2) => ({ cx: p.x, cy: p.y, r: 22 });

const distance = ([p, q]: [Point2, Point2]): number => Math.hypot(p.x - q.x, p.y - q.y);

function zoomed(view: View, factor: number, px: number, py: number): View {
  const scale = Math.min(400, Math.max(0.2, view.scale * factor));
  const ratio = scale / view.scale;
  return { scale, ox: px - (px - view.ox) * ratio, oy: py - (py - view.oy) * ratio };
}
