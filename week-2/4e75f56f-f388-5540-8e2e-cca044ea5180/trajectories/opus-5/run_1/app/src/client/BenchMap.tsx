import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BenchView } from '../shared/api.js';
import { BENCH_ROWS, type Tier } from '../shared/benches.js';
import { benchUpdates } from '../shared/copy.js';
import { useLab } from './store.js';
import type { Viewport } from './hooks.js';

export type BenchText =
  | 'Open'
  | 'Atelier only'
  | 'Sold out'
  | 'Held'
  | 'Held by you'
  | 'Offered to you'
  | 'Sold'
  | 'Yours';

const GLYPHS: Record<BenchText, string> = {
  Open: '\u25a1',
  'Atelier only': '\u25c6',
  'Sold out': '\u25c6',
  Held: '\u25d4',
  'Held by you': '\u25c9',
  'Offered to you': '\u25c9',
  Sold: '\u25cf',
  Yours: '\u2588',
};

export function benchStateText(
  bench: BenchView,
  tier: Tier,
  atelierSoldOut: boolean,
): BenchText {
  if (bench.state === 'open') {
    if (bench.tier === 'atelier') {
      if (atelierSoldOut) return 'Sold out';
      return tier === 'bench' ? 'Atelier only' : 'Open';
    }
    return 'Open';
  }
  if (bench.state === 'held') return 'Held';
  if (bench.state === 'held_by_you') return 'Held by you';
  if (bench.state === 'offered_to_you') return 'Offered to you';
  if (bench.state === 'sold') return 'Sold';
  return 'Yours';
}

export function BenchMap({ viewport }: { readonly viewport: Viewport }): ReactNode {
  const lab = useLab();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [focused, setFocused] = useState<string | null>(null);

  const benches = lab.benches?.benches ?? [];
  const atelierSoldOut = lab.benches?.tiers.atelier.sold_out ?? false;
  const isClinic = lab.me?.account.role === 'clinic';

  const texts = useMemo(() => {
    const map = new Map<string, BenchText>();
    for (const bench of benches) map.set(bench.label, benchStateText(bench, lab.tier, atelierSoldOut));
    return map;
  }, [benches, lab.tier, atelierSoldOut]);

  const order = useMemo(() => benches.map((bench) => bench.label), [benches]);

  const defaultFocus = useMemo(() => {
    const mine = benches.find((bench) => bench.state === 'held_by_you');
    if (mine !== undefined) return mine.label;
    const open = benches.find((bench) => texts.get(bench.label) === 'Open');
    return open?.label ?? order[0] ?? null;
  }, [benches, order, texts]);

  useEffect(() => {
    if (focused === null || !order.includes(focused)) setFocused(defaultFocus);
  }, [defaultFocus, focused, order]);

  const moveTo = useCallback((label: string | undefined) => {
    if (label === undefined) return;
    setFocused(label);
    buttons.current.get(label)?.focus();
  }, []);

  const activate = useCallback(
    (label: string) => {
      const text = texts.get(label);
      if (text === 'Atelier only') {
        lab.announce(benchUpdates.atelierOnly(label));
        return;
      }
      if (text !== 'Open') return;
      if (isClinic) {
        lab.toggleSelection(label);
        return;
      }
      void lab.holdBenches([label]);
    },
    [isClinic, lab, texts],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>, label: string) => {
      const index = order.indexOf(label);
      const column = index % 6;
      const row = Math.floor(index / 6);
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate(label);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (lab.selection.length > 0) {
          lab.clearSelection();
          return;
        }
        void lab.releaseHold();
        return;
      }
      if (viewport === 'phone') {
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          event.preventDefault();
          moveTo(order[Math.min(order.length - 1, index + 1)]);
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
          event.preventDefault();
          moveTo(order[Math.max(0, index - 1)]);
        } else if (event.key === 'Home') {
          event.preventDefault();
          moveTo(order[0]);
        } else if (event.key === 'End') {
          event.preventDefault();
          moveTo(order[order.length - 1]);
        }
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveTo(order[row * 6 + Math.min(5, column + 1)]);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveTo(order[row * 6 + Math.max(0, column - 1)]);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveTo(order[Math.min(3, row + 1) * 6 + column]);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveTo(order[Math.max(0, row - 1) * 6 + column]);
      } else if (event.key === 'Home') {
        event.preventDefault();
        moveTo(order[row * 6]);
      } else if (event.key === 'End') {
        event.preventDefault();
        moveTo(order[row * 6 + 5]);
      }
    },
    [activate, lab, moveTo, order, viewport],
  );

  return (
    <div className="bench-map" role="grid" aria-label="Bench map" id="bench-map">
      {BENCH_ROWS.map((row) => (
        <div className="bench-row" role="row" aria-label={`Row ${row}`} key={row}>
          <span className="row-label" aria-hidden="true">
            {row}
          </span>
          {benches
            .filter((bench) => bench.row === row)
            .map((bench) => {
              const text = texts.get(bench.label) ?? 'Open';
              const selected = lab.selection.includes(bench.label);
              return (
                <div role="gridcell" key={bench.label} className="bench-cell">
                  <button
                    type="button"
                    ref={(element) => {
                      if (element === null) buttons.current.delete(bench.label);
                      else buttons.current.set(bench.label, element);
                    }}
                    tabIndex={focused === bench.label ? 0 : -1}
                    aria-label={`Bench ${bench.label}, ${text}`}
                    aria-pressed={isClinic && text === 'Open' ? selected : undefined}
                    className={`bench bench-${text.toLowerCase().replace(/ /g, '-')}${selected ? ' bench-picked' : ''}`}
                    data-bench={bench.label}
                    data-state={text}
                    onFocus={() => setFocused(bench.label)}
                    onKeyDown={(event) => onKeyDown(event, bench.label)}
                    onClick={() => activate(bench.label)}
                  >
                    <span className="bench-glyph" aria-hidden="true">
                      {GLYPHS[text]}
                    </span>
                    <span className="bench-label num" aria-hidden="true">
                      {bench.label}
                    </span>
                    <span className="bench-state" aria-hidden="true">
                      {text}
                    </span>
                  </button>
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}
