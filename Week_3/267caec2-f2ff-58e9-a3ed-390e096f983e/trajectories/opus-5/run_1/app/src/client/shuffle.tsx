import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Glyph, ordinal, prefersReducedMotion } from './ui';

export interface ShuffleRow {
  id: string;
  entryNumber: number;
  rank: number;
  score: string | null;
  cut: 'above' | 'below';
  cells: (view: RowView) => JSX.Element;
}

export interface RowView {
  score: string | null;
  cut: 'above' | 'below';
  delta: JSX.Element | null;
}

const ROLL_MS = 320;
const TRAVEL_MS = 480;
const STAGGER_MS = 40;

function easeOutCubicInverse(progress: number): number {
  return 1 - Math.cbrt(1 - progress);
}

function summarise(
  moves: { entryNumber: number; from: number; to: number; cut: 'above' | 'below'; crossed: boolean }[],
  scoresChanged: boolean,
): string | null {
  if (moves.length === 0) return scoresChanged ? 'Scores updated, no change in order.' : null;
  const crossed = moves.filter((move) => move.crossed);
  const pool = crossed.length > 0 ? crossed : moves;
  const named = [...pool].sort(
    (a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from) || a.to - b.to,
  )[0];
  const line = `Entry ${named.entryNumber} moved from ${ordinal(named.from)} to ${ordinal(named.to)}, now ${
    named.cut === 'above' ? 'above' : 'below'
  } the cut.`;
  return moves.length === 1 ? line : `${line} ${moves.length - 1} other entries moved.`;
}

export function RankedTable({
  label,
  columns,
  rows,
  cut,
  cutLabel,
  onAnnounce,
}: {
  label: string;
  columns: JSX.Element;
  rows: ShuffleRow[];
  cut: number;
  cutLabel: string;
  onAnnounce: (line: string) => void;
}): JSX.Element {
  const [shown, setShown] = useState<ShuffleRow[]>(rows);
  const [scoreView, setScoreView] = useState<Record<string, string | null>>({});
  const [cutView, setCutView] = useState<Record<string, 'above' | 'below'>>({});
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const [cutTop, setCutTop] = useState<number | null>(null);

  const frame = useRef<HTMLDivElement>(null);
  const rowNodes = useRef(new Map<string, HTMLTableRowElement>());
  const previous = useRef<ShuffleRow[]>(rows);
  const oldTops = useRef<Record<string, number>>({});
  const busy = useRef(false);
  const queued = useRef<ShuffleRow[] | null>(null);
  const timers = useRef<number[]>([]);
  const pendingFlip = useRef(false);

  const placeCutRule = (): void => {
    const list = previous.current;
    if (list.length === 0) {
      setCutTop(null);
      return;
    }
    if (cut >= list.length) {
      const last = rowNodes.current.get(list[list.length - 1].id);
      setCutTop(last === undefined ? null : last.offsetTop + last.offsetHeight);
      return;
    }
    const boundary = rowNodes.current.get(list[cut].id);
    setCutTop(boundary === undefined ? null : boundary.offsetTop);
  };

  useLayoutEffect(() => {
    const same =
      previous.current.length === rows.length &&
      previous.current.every(
        (row, index) =>
          row.id === rows[index].id && row.score === rows[index].score && row.cut === rows[index].cut,
      );
    if (same) {
      previous.current = rows;
      setShown(rows);
      placeCutRule();
      return;
    }
    if (busy.current) {
      queued.current = rows;
      return;
    }
    busy.current = true;
    const measured: Record<string, number> = {};
    for (const [id, node] of rowNodes.current) measured[id] = node.offsetTop;
    oldTops.current = measured;
    pendingFlip.current = true;
    setShown(rows);
  }, [rows, cut]);

  useLayoutEffect(() => {
    if (!pendingFlip.current) return;
    pendingFlip.current = false;
    const before = previous.current;
    const after = shown;
    previous.current = after;

    const oldRanks = new Map(before.map((row) => [row.id, row]));
    const moves = after
      .filter((row) => {
        const old = oldRanks.get(row.id);
        return old !== undefined && old.rank !== row.rank;
      })
      .map((row) => {
        const old = oldRanks.get(row.id) as ShuffleRow;
        return { row, from: old.rank, to: row.rank, crossed: old.cut !== row.cut };
      });
    const scoresChanged = after.some((row) => {
      const old = oldRanks.get(row.id);
      return old !== undefined && old.score !== row.score;
    });
    const line = summarise(
      moves.map((move) => ({
        entryNumber: move.row.entryNumber,
        from: move.from,
        to: move.to,
        cut: move.row.cut,
        crossed: move.crossed,
      })),
      scoresChanged,
    );

    const settle = (): void => {
      setScoreView(Object.fromEntries(after.map((row) => [row.id, row.score])));
      setCutView(Object.fromEntries(after.map((row) => [row.id, row.cut])));
      placeCutRule();
      if (line !== null) onAnnounce(line);
      busy.current = false;
      const next = queued.current;
      queued.current = null;
      if (next !== null) {
        const measured: Record<string, number> = {};
        for (const [id, node] of rowNodes.current) measured[id] = node.offsetTop;
        oldTops.current = measured;
        busy.current = true;
        pendingFlip.current = true;
        setShown(next);
      }
    };

    if (prefersReducedMotion()) {
      setDeltas(Object.fromEntries(moves.map((move) => [move.row.id, move.to - move.from])));
      settle();
      return;
    }

    setDeltas({});
    setScoreView(Object.fromEntries(before.map((row) => [row.id, row.score])));
    setCutView(Object.fromEntries(before.map((row) => [row.id, row.cut])));

    const newTops: Record<string, number> = {};
    for (const [id, node] of rowNodes.current) newTops[id] = node.offsetTop;
    const heights: Record<string, number> = {};
    for (const [id, node] of rowNodes.current) heights[id] = node.offsetHeight;

    for (const row of after) {
      const node = rowNodes.current.get(row.id);
      const from = oldTops.current[row.id];
      if (node === undefined || from === undefined) continue;
      node.style.transition = 'none';
      node.style.transform = `translateY(${from - newTops[row.id]}px)`;
    }
    const boundaryRow = cut < after.length ? after[cut] : undefined;
    const cutY =
      boundaryRow === undefined ? Number.POSITIVE_INFINITY : newTops[boundaryRow.id] ?? Number.POSITIVE_INFINITY;
    placeCutRule();

    const startScores = Object.fromEntries(before.map((row) => [row.id, row.score]));
    const rollStart = performance.now();
    const roll = (): void => {
      const elapsed = performance.now() - rollStart;
      const fraction = Math.min(1, elapsed / ROLL_MS);
      const next: Record<string, string | null> = {};
      for (const row of after) {
        const from = startScores[row.id];
        if (from === undefined || from === null || row.score === null || from === row.score) {
          next[row.id] = row.score;
          continue;
        }
        const value = Number(from) + (Number(row.score) - Number(from)) * fraction;
        next[row.id] = value.toFixed(2);
      }
      setScoreView(next);
      if (fraction < 1) requestAnimationFrame(roll);
    };
    requestAnimationFrame(roll);

    const ordered = [...moves].sort((a, b) => a.to - b.to);
    const travelStart = window.setTimeout(() => {
      ordered.forEach((move, index) => {
        const node = rowNodes.current.get(move.row.id);
        if (node === undefined) return;
        node.style.transition = `transform ${TRAVEL_MS}ms cubic-bezier(0.33, 1, 0.68, 1) ${index * STAGGER_MS}ms`;
        node.style.transform = 'translateY(0px)';
      });
      for (const row of after) {
        if (moves.some((move) => move.row.id === row.id)) continue;
        const node = rowNodes.current.get(row.id);
        if (node === undefined) continue;
        node.style.transition = 'none';
        node.style.transform = 'translateY(0px)';
      }
      ordered.forEach((move, index) => {
        if (!move.crossed) return;
        const node = rowNodes.current.get(move.row.id);
        if (node === undefined) return;
        const height = heights[move.row.id] ?? node.offsetHeight;
        const fromCentre = (oldTops.current[move.row.id] ?? 0) + height / 2;
        const toCentre = (newTops[move.row.id] ?? 0) + height / 2;
        const span = toCentre - fromCentre;
        const progress = span === 0 ? 1 : (cutY - fromCentre) / span;
        const clamped = Math.min(1, Math.max(0, progress));
        const at = index * STAGGER_MS + TRAVEL_MS * easeOutCubicInverse(clamped);
        timers.current.push(
          window.setTimeout(() => {
            setCutView((current) => ({ ...current, [move.row.id]: move.row.cut }));
          }, at),
        );
      });
    }, ROLL_MS);
    timers.current.push(travelStart);

    const total = ROLL_MS + Math.max(0, ordered.length - 1) * STAGGER_MS + TRAVEL_MS + 40;
    timers.current.push(
      window.setTimeout(() => {
        for (const node of rowNodes.current.values()) {
          node.style.transition = '';
          node.style.transform = '';
        }
        settle();
      }, total),
    );
  }, [shown]);

  useEffect(() => {
    const onResize = (): void => placeCutRule();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
    };
  }, []);

  useEffect(() => {
    placeCutRule();
  }, [shown.length, cut]);

  return (
    <div class="ranked" ref={frame}>
      <table aria-label={label}>
        <thead>{columns}</thead>
        <tbody>
          {shown.map((row) => {
            const view: RowView = {
              score: row.id in scoreView ? scoreView[row.id] : row.score,
              cut: cutView[row.id] ?? row.cut,
              delta:
                deltas[row.id] === undefined || deltas[row.id] === 0 ? null : (
                  <span class="delta">
                    <Glyph shape={deltas[row.id] < 0 ? 'arrow-up' : 'arrow-down'} tone="award" />
                    {deltas[row.id] < 0 ? 'up' : 'down'} {Math.abs(deltas[row.id])}
                  </span>
                ),
            };
            return (
              <tr
                key={row.id}
                class="row-travel"
                ref={(node) => {
                  if (node === null) rowNodes.current.delete(row.id);
                  else rowNodes.current.set(row.id, node);
                }}
              >
                {row.cells(view)}
              </tr>
            );
          })}
        </tbody>
      </table>
      {cutTop === null ? null : (
        <span class="cut-rule" role="separator" aria-label={cutLabel} style={{ top: `${cutTop}px` }} />
      )}
    </div>
  );
}
