import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { Format, MatchView } from '../../shared/api.js';
import { isOpen, regionCurrentRound } from '../../shared/rounds.js';
import { nextFocus, winnerTarget, type RegionModel } from '../bracketModel.js';
import { useTrace, type TraceController } from '../trace.js';
import { MatchCard } from './MatchCard.js';

interface Line { d: string; key: string }

// Position of an element inside the tree, from layout offsets (unaffected by the whole-bracket scale).
function placeIn(tree: HTMLElement, el: HTMLElement): { left: number; right: number; mid: number } {
  let left = 0;
  let top = 0;
  for (let node: HTMLElement | null = el; node && node !== tree; node = node.offsetParent as HTMLElement | null) {
    left += node.offsetLeft;
    top += node.offsetTop;
  }
  return { left, right: left + el.offsetWidth, mid: top + el.offsetHeight / 2 };
}

const cardIn = (tree: HTMLElement, id: string): HTMLElement | null => tree.querySelector<HTMLElement>(`[data-match-id="${id}"]`);

export function Region({ region, format, whole, controller, onOpen, reveal }: {
  region: RegionModel;
  format: Format;
  whole: boolean;
  controller: TraceController;
  onOpen: (match: MatchView) => void;
  // The region holding the current round scrolls its first open card into view when the page loads.
  reveal: boolean;
}): ReactNode {
  const scroller = useRef<HTMLDivElement>(null);
  const tree = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [scale, setScale] = useState(1);
  const [treeHeight, setTreeHeight] = useState(0);
  const trace = useTrace(controller);
  const matches = useMemo(() => region.rounds.flatMap((r) => r.matches), [region]);
  const current = useMemo(() => regionCurrentRound(
    matches.map((m) => ({ bracket: m.bracket, round: m.round, open: isOpen(m.state, m.upper, m.lower) })), region.bracket), [matches, region.bracket]);
  const defaultId = region.rounds.find((r) => r.round === current)?.matches[0]?.id ?? null;
  const tabStop = focused && matches.some((m) => m.id === focused) ? focused : defaultId;
  const flat = format === 'round_robin' || format === 'swiss';
  const structure = region.rounds.map((r) => `${r.round}:${r.matches.length}`).join(',');

  // The current round starts at the left edge of the bracket area.
  const placed = useRef(false);
  useLayoutEffect(() => {
    const area = scroller.current;
    if (whole && area) {
      area.scrollLeft = 0;
      placed.current = false;
      return;
    }
    if (placed.current || !area || !tree.current || !region.rounds.length) return;
    const column = tree.current.querySelector<HTMLElement>(`[data-round-col="${current}"]`);
    if (!column) return;
    area.scrollLeft = column.offsetLeft;
    placed.current = true;
    const first = reveal && defaultId ? cardIn(tree.current, defaultId) : null;
    if (first) {
      const box = first.getBoundingClientRect();
      window.scrollBy({ top: box.top + box.height / 2 - window.innerHeight / 2, behavior: 'instant' });
    }
  }, [current, whole, region.rounds.length, reveal, defaultId]);

  useLayoutEffect(() => {
    const el = tree.current;
    if (!el || flat) return;
    const next: Line[] = [];
    for (const round of region.rounds) {
      for (const match of round.matches) {
        const target = winnerTarget(region, match, format);
        const from = cardIn(el, match.id);
        const to = target && cardIn(el, target.id);
        if (!from || !to || target?.bracket !== match.bracket) continue;
        const a = placeIn(el, from);
        const b = placeIn(el, to);
        const turn = (a.right + b.left) / 2;
        next.push({ key: `${match.id}`, d: `M${a.right} ${a.mid}H${turn}V${b.mid}H${b.left}` });
      }
    }
    setLines(next);
    setTreeHeight(el.offsetHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure, flat, format]);

  useEffect(() => {
    if (!whole || !scroller.current || !tree.current) return;
    const fit = (): void => {
      const area = scroller.current as HTMLElement;
      const content = tree.current as HTMLElement;
      setScale(Math.min(1, area.clientWidth / content.scrollWidth));
      setTreeHeight(content.offsetHeight);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(scroller.current);
    return () => observer.disconnect();
  }, [whole, structure]);

  const keyNav = (event: KeyboardEvent<HTMLButtonElement>, match: MatchView): void => {
    const target = nextFocus(region, match, event.key, format);
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!target || !tree.current) return;
    const el = cardIn(tree.current, target.id);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const down = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !scroller.current) return;
    drag.current = { x: event.clientX, left: scroller.current.scrollLeft, moved: false };
  };
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (!state || !scroller.current) return;
    const dx = event.clientX - state.x;
    if (Math.abs(dx) > 5) state.moved = true;
    if (state.moved) scroller.current.scrollLeft = state.left - dx;
  };
  const up = (): void => {
    const moved = drag.current?.moved;
    drag.current = null;
    if (moved) {
      const stop = (event: Event): void => { event.stopPropagation(); event.preventDefault(); };
      window.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
    }
  };

  const segmentPath = (from: string, to: string): string | null => {
    const el = tree.current;
    const target = el && cardIn(el, to);
    if (!el || !target) return null;
    const b = placeIn(el, target);
    const source = cardIn(el, from);
    if (!source) return `M0 ${b.mid}H${b.left}`;
    const a = placeIn(el, source);
    const turn = (a.right + b.left) / 2;
    return `M${a.right} ${a.mid}H${turn}V${b.mid}H${b.left}`;
  };

  return (
    <section aria-label={region.name} className={`region ${whole ? 'region-whole' : ''}`}>
      {region.bracket === 'main' && format === 'single_elimination' ? null : <p className="region-label">{region.name}</p>}
      <div ref={scroller} className="scroller" style={whole ? { height: treeHeight * scale } : undefined}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div ref={tree} className={`tree ${flat ? 'tree-flat' : ''}`} style={whole ? { transform: `scale(${scale})` } : undefined}>
          {!flat ? (
            <svg className="connectors" width="100%" height={treeHeight} aria-hidden="true" focusable="false">
              {lines.map((line) => <path key={line.key} d={line.d} />)}
            </svg>
          ) : null}
          <svg className="trace" width="100%" height={treeHeight} aria-hidden="true" focusable="false">
            {trace.segments.map((s) => {
              const d = segmentPath(s.from, s.to);
              return d ? <path key={s.id} d={d} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - s.progress} data-trace-path="" /> : null;
            })}
          </svg>
          {region.rounds.map((round) => (
            <div className="round" key={round.round} data-round-col={round.round}>
              <p className="round-label">{round.label}</p>
              <div className="round-cards">
                {round.matches.map((match) => (
                  <div className="slot" key={match.id}>
                    <MatchCard match={match} tabIndex={match.id === tabStop ? 0 : -1} shutter={trace.shutters.get(match.id)}
                      willReset={trace.willReset.has(match.id)} onOpen={onOpen} onKeyNav={keyNav}
                      onFocused={(m) => setFocused(m.id)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
