import { useEffect, useRef, useState, type ReactNode } from 'react';
import { money } from '../format.js';
import { useReducedMotion } from '../scene/index.js';

const COUNT_MS = 680;

/** The displayed amount counts to its final value over 680 ms; the final value is in `data-cents` at once. */
function useCount(target: number): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (reduced) {
      current.current = target;
      setShown(target);
      return undefined;
    }
    const begin = current.current;
    if (begin === target) return undefined;
    const started = performance.now();
    let frame = 0;
    const step = (): void => {
      const t = Math.min(1, (performance.now() - started) / COUNT_MS);
      const value = t >= 1 ? target : Math.round(begin + (target - begin) * (1 - (1 - t) ** 3));
      current.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced]);
  return shown;
}

export type Word = 'quoted' | 'checking' | 'not current' | 'scheduled' | 'pending' | 'paid' | 'failed' | 'overdue' | 'returned' | 'partly returned' | 'corrected';

/** A money figure with the status word printed beside it. */
export function Money({ cents, word, figures = false, className = '' }: { cents: number; word: Word; figures?: boolean; className?: string }): ReactNode {
  const shown = useCount(cents);
  return (
    <span className={`money ${className}`} data-cents={cents} data-figures={figures ? word : undefined}>
      <span className="num">{money(shown)}</span>
      <span className="word" data-word={word}>{word}</span>
    </span>
  );
}
