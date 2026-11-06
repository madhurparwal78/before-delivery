// The collection board: index cards on a pannable, zoomable surface with arrows for link edges.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import '../styles/board.css';
import { api, get, NetworkError } from '../api.ts';
import { announce, showAlert } from '../feedback.ts';
import { reducedMotion, QUIRE_CURVE_CSS } from '../motion.ts';
import { navigate } from '../router.ts';
import { useSync } from '../sync.ts';
import type { BoardJson } from '../types.ts';
import {
  arrowEnds, CARD_H, CARD_W, formatTransform, HOME_VIEW, nudge, NUDGE_SAVE_MS, snap, wheelDeltaPx, wheelZoom, WHEEL_ZOOM_PX,
  type BoardView, type Point,
} from '../../shared/board.ts';
import { BOARD_REFUSAL_SLIDE_MS, BOARD_SLIDE_MS } from '../../shared/motion.ts';
import { compareIds, compareText } from '../../shared/query.ts';

interface Card { id: string; title: string; x: number; y: number }
interface Edge { id: string; from: string; to: string }
interface Lasso { x1: number; y1: number; x2: number; y2: number }
interface Slide { id: string; from: Point; ms: number }

/** A pointer press on the board: a pan, a lasso, a card press (maybe a drag) or a pinch. */
type Press =
  | { kind: 'pan'; pointerId: number; sx: number; sy: number; view: BoardView }
  | { kind: 'lasso'; pointerId: number; bx: number; by: number }
  | { kind: 'card'; pointerId: number; id: string; sx: number; sy: number; shift: boolean; active: boolean; starts: Map<string, Point> }
  | { kind: 'pinch' };

/** Pointer, wheel and pinch slack before a card press becomes a drag. */
const DRAG_START_PX = 4;
const REFUSED = "Those cards couldn't be moved.";
/** Width of the arrowhead marker in board units. */
const ARROWHEAD = 8;

function byPlace(a: Card, b: Card): number {
  return a.y - b.y || a.x - b.x || compareText(a.title, b.title) || compareIds(a.id, b.id);
}

/** The card's drawn top-left in board units, including any running slide. */
function drawnAt(el: HTMLElement): Point {
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform === 'none' ? undefined : getComputedStyle(el).transform);
  return { x: m.m41, y: m.m42 };
}

const translate = (p: Point): string => `translate(${p.x}px, ${p.y}px)`;

export function BoardPage({ collectionId }: { collectionId: string }) {
  const markerId = useId().replace(/:/g, '');
  const [name, setName] = useState<string | null>(null);
  const [cards, setCardsState] = useState<Card[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [view, setViewState] = useState<BoardView>(HOME_VIEW);
  const [selected, setSelectedState] = useState<ReadonlySet<string>>(new Set());
  const [lasso, setLasso] = useState<Lasso | null>(null);

  const cardsRef = useRef<Card[]>([]);
  const viewRef = useRef<BoardView>(HOME_VIEW);
  const selectedRef = useRef<ReadonlySet<string>>(new Set());
  const confirmed = useRef(new Map<string, Point>());
  /** cards moved here and not yet confirmed by the server */
  const dirty = useRef(new Set<string>());
  const pendingNudge = useRef(new Set<string>());
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = useRef<Press | null>(null);
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<{ dist: number } | null>(null);
  const slides = useRef<Slide[]>([]);
  const cardEls = useRef(new Map<string, HTMLButtonElement>());
  const lineEls = useRef(new Map<string, SVGLineElement>());
  const edgesRef = useRef<Edge[]>([]);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const lastFocused = useRef<string | null>(null);
  const frame = useRef<number | null>(null);
  const fetchSeq = useRef(0);

  const setCards = useCallback((next: Card[]) => {
    cardsRef.current = next;
    setCardsState(next);
  }, []);
  const setView = useCallback((next: BoardView) => {
    viewRef.current = next;
    setViewState(next);
  }, []);
  const setSelected = useCallback((next: ReadonlySet<string>) => {
    selectedRef.current = next;
    setSelectedState(next);
  }, []);
  const draggingIds = (): ReadonlySet<string> => {
    const p = press.current;
    return p && p.kind === 'card' && p.active ? new Set(p.starts.keys()) : new Set();
  };

  // Arrows: recomputed from the cards' drawn positions; a frame loop runs while anything moves.
  const drawArrows = useCallback(() => {
    for (const edge of edgesRef.current) {
      const line = lineEls.current.get(edge.id);
      const a = cardEls.current.get(edge.from);
      const b = cardEls.current.get(edge.to);
      if (!line || !a || !b) continue;
      const [x1, y1, x2, y2] = arrowEnds(drawnAt(a), drawnAt(b));
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
    }
  }, []);
  const moving = useCallback((): boolean => {
    if (draggingIds().size > 0) return true;
    for (const el of cardEls.current.values()) if (el.getAnimations().some((a) => a.playState === 'running')) return true;
    return false;
  }, []);
  const kick = useCallback(() => {
    if (frame.current !== null) return;
    const step = () => {
      drawArrows();
      frame.current = moving() ? requestAnimationFrame(step) : null;
    };
    frame.current = requestAnimationFrame(step);
  }, [drawArrows, moving]);
  // A press anywhere but a card means focus left the cards on purpose; only list moves restore it.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-board-card]')) lastFocused.current = null;
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
  }, []);

  /** Moves cards to new places, sliding each from where it is drawn over `ms`. */
  const slideTo = useCallback((targets: Map<string, Point>, ms: number) => {
    const next = cardsRef.current.map((c) => {
      const t = targets.get(c.id);
      if (!t || (t.x === c.x && t.y === c.y)) return c;
      const el = cardEls.current.get(c.id);
      if (el) slides.current.push({ id: c.id, from: drawnAt(el), ms });
      return { ...c, x: t.x, y: t.y };
    });
    setCards(next);
  }, [setCards]);

  useLayoutEffect(() => {
    edgesRef.current = edges;
    for (const s of slides.current.splice(0)) {
      const el = cardEls.current.get(s.id);
      const card = cardsRef.current.find((c) => c.id === s.id);
      if (!el || !card) continue;
      const running = el.getAnimations();
      const from = running.length ? drawnAt(el) : s.from;
      for (const a of running) a.cancel();
      if (reducedMotion() || (Math.abs(from.x - card.x) < 0.01 && Math.abs(from.y - card.y) < 0.01)) continue;
      el.animate([{ transform: translate(from) }, { transform: translate(card) }], { duration: s.ms, easing: QUIRE_CURVE_CSS });
    }
    drawArrows();
    kick();
    // A card moved within the list keeps focus.
    const id = lastFocused.current;
    if (id && (document.activeElement === document.body || document.activeElement === null)) cardEls.current.get(id)?.focus({ preventScroll: true });
  });

  // Loading and refetching the board without disturbing drags, nudges, focus or selection.
  const load = useCallback(async () => {
    const seq = ++fetchSeq.current;
    try {
      const [col, board] = await Promise.all([
        get<{ id: string; name: string }>(`/api/collections/${collectionId}`),
        get<BoardJson>(`/api/collections/${collectionId}/board`),
      ]);
      if (seq !== fetchSeq.current) return;
      if (col.status === 200) setName(col.data.name);
      if (board.status !== 200) return;
      const local = new Map(cardsRef.current.map((c) => [c.id, c]));
      const keep = draggingIds();
      const targets = new Map<string, Point>();
      const next: Card[] = [];
      for (const c of board.data.cards) {
        confirmed.current.set(c.object_id, { x: c.x, y: c.y });
        const mine = local.get(c.object_id);
        if (mine && (keep.has(c.object_id) || dirty.current.has(c.object_id))) next.push({ ...mine, title: c.title });
        else if (mine) {
          next.push({ ...mine, title: c.title });
          if (mine.x !== c.x || mine.y !== c.y) targets.set(c.object_id, { x: c.x, y: c.y });
        } else next.push({ id: c.object_id, title: c.title, x: c.x, y: c.y });
      }
      const ids = new Set(next.map((c) => c.id));
      for (const id of confirmed.current.keys()) if (!ids.has(id)) confirmed.current.delete(id);
      cardsRef.current = next;
      slideTo(targets, BOARD_SLIDE_MS);
      setEdges(board.data.edges);
      if ([...selectedRef.current].some((id) => !ids.has(id))) setSelected(new Set([...selectedRef.current].filter((id) => ids.has(id))));
    } catch {
      // offline: the next live event or reset refetches
    }
  }, [collectionId, setSelected, slideTo]);
  useEffect(() => {
    void load();
  }, [load]);

  useSync((event, data) => {
    if (event === 'board.saved') {
      const d = data as { collection_id: string; positions: Array<{ object_id: string; x: number; y: number }> };
      if (d.collection_id !== collectionId) return;
      const keep = draggingIds();
      const targets = new Map<string, Point>();
      for (const p of d.positions) {
        confirmed.current.set(p.object_id, { x: p.x, y: p.y });
        if (!keep.has(p.object_id) && !dirty.current.has(p.object_id)) targets.set(p.object_id, { x: p.x, y: p.y });
      }
      slideTo(targets, BOARD_SLIDE_MS);
    } else if (event === 'object.saved' || event === 'object.removed' || event === 'backlinks.changed' || event === 'sync.reset') {
      void load();
    }
  });

  // Saving: one PUT per drag release or nudge burst; a refusal slides the cards back.
  const save = useCallback(async (ids: string[]) => {
    const positions = ids.flatMap((id) => {
      const c = cardsRef.current.find((card) => card.id === id);
      return c ? [{ object_id: id, x: c.x, y: c.y }] : [];
    });
    if (!positions.length) return;
    let ok = false;
    try {
      const r = await api<BoardJson>('PUT', `/api/collections/${collectionId}/board`, { positions });
      ok = r.status >= 200 && r.status < 300;
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
    }
    for (const p of positions) {
      const now = cardsRef.current.find((c) => c.id === p.object_id);
      if (!now || (now.x === p.x && now.y === p.y)) dirty.current.delete(p.object_id);
    }
    if (ok) {
      for (const p of positions) confirmed.current.set(p.object_id, { x: p.x, y: p.y });
      const only = positions.length === 1 ? positions[0] : undefined;
      const title = only ? cardsRef.current.find((c) => c.id === only.object_id)?.title : undefined;
      announce(only && title !== undefined ? `Moved ${title} to x ${only.x}, y ${only.y}.` : `Moved ${positions.length} cards.`);
      return;
    }
    const back = new Map<string, Point>();
    for (const p of positions) {
      dirty.current.delete(p.object_id);
      const c = confirmed.current.get(p.object_id);
      if (c) back.set(p.object_id, c);
    }
    slideTo(back, BOARD_REFUSAL_SLIDE_MS);
    showAlert(REFUSED);
  }, [collectionId, slideTo]);

  const zoomAbout = useCallback((deltaPx: number, px: number, py: number) => {
    setView(wheelZoom(viewRef.current, deltaPx, px, py));
  }, [setView]);

  // The wheel zooms about the pointer; a non-passive listener keeps the page from scrolling.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = group.getBoundingClientRect();
      zoomAbout(wheelDeltaPx(e.deltaY, e.deltaMode, r.height), e.clientX - r.left, e.clientY - r.top);
    };
    group.addEventListener('wheel', onWheel, { passive: false });
    return () => group.removeEventListener('wheel', onWheel);
  }, [zoomAbout]);

  const groupPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = groupRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const toBoard = (p: Point): Point => {
    const v = viewRef.current;
    return { x: (p.x - v.tx) / v.z, y: (p.y - v.ty) / v.z };
  };
  const touchSpan = (): { dist: number; mid: Point } | null => {
    const [a, b] = [...touches.current.values()];
    if (!a || !b) return null;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const group = e.currentTarget;
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, groupPoint(e));
      const span = touchSpan();
      if (span) {
        // A second finger turns any press into a pinch.
        const p = press.current;
        if (p && p.kind === 'card' && p.active) finishCardDrag(p);
        press.current = { kind: 'pinch' };
        pinch.current = { dist: span.dist };
        setLasso(null);
        group.setPointerCapture(e.pointerId);
        return;
      }
    }
    const cardEl = (e.target as Element).closest<HTMLElement>('[data-board-card]');
    const id = cardEl?.dataset.boardCard;
    group.setPointerCapture(e.pointerId);
    if (id) {
      press.current = { kind: 'card', pointerId: e.pointerId, id, sx: e.clientX, sy: e.clientY, shift: e.shiftKey, active: false, starts: new Map() };
      return;
    }
    lastFocused.current = null;
    if (e.shiftKey) {
      const b = toBoard(groupPoint(e));
      press.current = { kind: 'lasso', pointerId: e.pointerId, bx: b.x, by: b.y };
      setLasso({ x1: b.x, y1: b.y, x2: b.x, y2: b.y });
    } else {
      press.current = { kind: 'pan', pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, view: viewRef.current };
    }
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, groupPoint(e));
    if (!p) return;
    if (p.kind === 'pinch') {
      const span = touchSpan();
      if (!span || !pinch.current || pinch.current.dist === 0 || span.dist === 0) return;
      const ratio = span.dist / pinch.current.dist;
      pinch.current = { dist: span.dist };
      zoomAbout(-WHEEL_ZOOM_PX * Math.log2(ratio), span.mid.x, span.mid.y);
      return;
    }
    if (e.pointerId !== p.pointerId) return;
    if (p.kind === 'pan') {
      setView({ z: p.view.z, tx: p.view.tx + e.clientX - p.sx, ty: p.view.ty + e.clientY - p.sy });
    } else if (p.kind === 'lasso') {
      const b = toBoard(groupPoint(e));
      setLasso({ x1: p.bx, y1: p.by, x2: b.x, y2: b.y });
    } else {
      const dx = e.clientX - p.sx;
      const dy = e.clientY - p.sy;
      if (!p.active) {
        if (Math.hypot(dx, dy) < DRAG_START_PX) return;
        p.active = true;
        const ids = selectedRef.current.has(p.id) ? selectedRef.current : new Set([p.id]);
        for (const c of cardsRef.current) {
          if (!ids.has(c.id)) continue;
          p.starts.set(c.id, { x: c.x, y: c.y });
          cardEls.current.get(c.id)?.getAnimations().forEach((a) => a.cancel());
        }
      }
      const z = viewRef.current.z;
      setCards(cardsRef.current.map((c) => {
        const s = p.starts.get(c.id);
        if (!s) return c;
        const x = snap(s.x, dx, z);
        const y = snap(s.y, dy, z);
        return x === c.x && y === c.y ? c : { ...c, x, y };
      }));
      kick();
    }
  };

  function finishCardDrag(p: Extract<Press, { kind: 'card' }>): void {
    const moved: string[] = [];
    for (const [id, s] of p.starts) {
      const c = cardsRef.current.find((card) => card.id === id);
      if (c && (c.x !== s.x || c.y !== s.y)) {
        moved.push(id);
        dirty.current.add(id);
      }
    }
    press.current = null;
    void save(moved);
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    const p = press.current;
    if (!p) return;
    if (p.kind === 'pinch') {
      if (touches.current.size < 2) {
        press.current = null;
        pinch.current = null;
      }
      return;
    }
    if (e.pointerId !== p.pointerId) return;
    if (p.kind === 'pan') press.current = null;
    else if (p.kind === 'lasso') {
      press.current = null;
      const b = toBoard(groupPoint(e));
      const x1 = Math.min(p.bx, b.x);
      const x2 = Math.max(p.bx, b.x);
      const y1 = Math.min(p.by, b.y);
      const y2 = Math.max(p.by, b.y);
      setLasso(null);
      setSelected(new Set(cardsRef.current.filter((c) => c.x <= x2 && c.x + CARD_W >= x1 && c.y <= y2 && c.y + CARD_H >= y1).map((c) => c.id)));
    } else if (p.active) {
      finishCardDrag(p);
    } else {
      press.current = null;
      if (e.type === 'pointercancel') return;
      if (p.shift) {
        const next = new Set(selectedRef.current);
        if (next.has(p.id)) next.delete(p.id);
        else next.add(p.id);
        setSelected(next);
      } else setSelected(new Set([p.id]));
      cardEls.current.get(p.id)?.focus({ preventScroll: true });
    }
  };

  // Keyboard on a card button.
  const onCardKey = (card: Card) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = dirs[e.key];
    if (dir && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const ids = selectedRef.current.has(card.id) ? selectedRef.current : new Set([card.id]);
      setCards(cardsRef.current.map((c) => {
        if (!ids.has(c.id)) return c;
        cardEls.current.get(c.id)?.getAnimations().forEach((a) => a.cancel());
        pendingNudge.current.add(c.id);
        dirty.current.add(c.id);
        return { ...c, x: nudge(c.x, dir[0], e.shiftKey), y: nudge(c.y, dir[1], e.shiftKey) };
      }));
      if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
      nudgeTimer.current = setTimeout(() => {
        nudgeTimer.current = null;
        const batch = [...pendingNudge.current];
        pendingNudge.current.clear();
        void save(batch);
      }, NUDGE_SAVE_MS);
      return;
    }
    if (e.key === '+' || e.key === '=' || e.key === '-') {
      e.preventDefault();
      const r = groupRef.current?.getBoundingClientRect();
      if (r) zoomAbout(e.key === '-' ? 100 : -100, r.width / 2, r.height / 2);
    } else if (e.key === ' ') {
      e.preventDefault();
      const next = new Set(selectedRef.current);
      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      setSelected(next);
    } else if (e.key === 'Escape') {
      if (selectedRef.current.size) {
        e.preventDefault();
        setSelected(new Set());
      }
    } else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setSelected(new Set(cardsRef.current.map((c) => c.id)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const titleEl = cardEls.current.get(card.id)?.querySelector('.board-card-title');
      navigate(`/o/${card.id}`, titleEl ? { titleFrom: titleEl.getBoundingClientRect() } : {});
    }
  };

  const ordered = [...cards].sort(byPlace);
  const { z, tx, ty } = view;
  const lassoBox = lasso && {
    left: Math.min(lasso.x1, lasso.x2), top: Math.min(lasso.y1, lasso.y2),
    width: Math.abs(lasso.x2 - lasso.x1), height: Math.abs(lasso.y2 - lasso.y1),
  };

  return (
    <div className="board-page">
      <h1>{name ?? ''}</h1>
      <div
        role="group" aria-label="Board" className="board" ref={groupRef}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      >
        <div
          className="board-viewport" data-board-viewport="" data-board-transform={formatTransform(z, tx, ty)}
          style={{ transform: `translate(${tx}px, ${ty}px) scale(${z})` }}
        >
          <svg className="board-arrows" aria-hidden="true" focusable="false" width="1" height="1">
            <defs>
              <marker id={markerId} viewBox={`0 0 ${ARROWHEAD} ${ARROWHEAD}`} refX={ARROWHEAD} refY={ARROWHEAD / 2}
                markerWidth={ARROWHEAD} markerHeight={ARROWHEAD} markerUnits="userSpaceOnUse" orient="auto">
                <path d={`M0,0 L${ARROWHEAD},${ARROWHEAD / 2} L0,${ARROWHEAD} z`} />
              </marker>
            </defs>
            {edges.map((edge) => (
              <line
                key={edge.id} data-board-arrow={edge.id} aria-hidden="true" markerEnd={`url(#${markerId})`}
                ref={(el) => {
                  if (el) lineEls.current.set(edge.id, el);
                  else lineEls.current.delete(edge.id);
                }}
              />
            ))}
          </svg>
          {lassoBox && (
            <div className="board-lasso" data-board-lasso="" aria-hidden="true"
              style={{ transform: translate({ x: lassoBox.left, y: lassoBox.top }), width: lassoBox.width, height: lassoBox.height }} />
          )}
          <ul className="board-cards" aria-label="Board cards">
            {ordered.map((card) => {
              const on = selected.has(card.id);
              return (
                <li key={card.id}>
                  <button
                    type="button" className={`board-card${on ? ' selected' : ''}`} data-board-card={card.id}
                    aria-label={`${card.title}, x ${card.x}, y ${card.y}${on ? ', selected' : ''}`}
                    style={{ transform: translate(card) }}
                    ref={(el) => {
                      if (el) cardEls.current.set(card.id, el);
                      else cardEls.current.delete(card.id);
                    }}
                    onFocus={() => {
                      lastFocused.current = card.id;
                    }}
                    onBlur={(e) => {
                      if (e.relatedTarget) lastFocused.current = null;
                    }}
                    onKeyDown={onCardKey(card)}
                  >
                    <span className="board-card-title">{card.title}</span>
                    <span className="board-card-place mono" aria-hidden="true">x {card.x} · y {card.y}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
