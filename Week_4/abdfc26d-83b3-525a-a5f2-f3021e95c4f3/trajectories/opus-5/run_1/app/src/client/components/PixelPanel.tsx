import { useEffect, useState } from 'react';
import { useReducedMotion } from '../lib/hooks.js';

export type AssistantState = 'idle' | 'drafting' | 'rendering' | 'error';

const GRID = 10;
const CELLS = GRID * GRID;

/** The two yellow 2x2 eyes. */
const EYES = new Set<number>();
for (const [row, column] of [
  [3, 2],
  [3, 6],
] as const) {
  for (let dr = 0; dr < 2; dr += 1) {
    for (let dc = 0; dc < 2; dc += 1) {
      EYES.add((row + dr) * GRID + (column + dc));
    }
  }
}

function baseShade(index: number): number {
  const row = Math.floor(index / GRID);
  if (row < 2) return -1; // olive top rows
  return 0.42 + ((index * 37) % 23) / 90;
}

/**
 * The assistant render-status pixel panel: still when idle, one cell changing
 * shade every 100 to 200 ms while work is pending, grey still eyes on error,
 * and a fixed pattern per state under reduced motion.
 */
export function PixelPanel({
  state,
  size = 'large',
}: {
  state: AssistantState;
  size?: 'large' | 'small';
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const pending = state === 'drafting' || state === 'rendering';
  const [flicker, setFlicker] = useState<{ index: number; shade: number } | null>(null);

  useEffect(() => {
    if (!pending || reducedMotion) {
      setFlicker(null);
      return;
    }
    let timer = 0;
    const tick = (): void => {
      const index = 2 * GRID + Math.floor(Math.random() * (CELLS - 2 * GRID));
      if (!EYES.has(index)) {
        setFlicker({ index, shade: 0.25 + Math.random() * 0.7 });
      }
      timer = window.setTimeout(tick, 100 + Math.random() * 100);
    };
    timer = window.setTimeout(tick, 120);
    return () => window.clearTimeout(timer);
  }, [pending, reducedMotion]);

  const cells = [];
  for (let index = 0; index < CELLS; index += 1) {
    const isEye = EYES.has(index);
    let className = 'pixel-panel__cell';
    let style: React.CSSProperties | undefined;

    if (isEye) {
      className += state === 'error' ? ' pixel-panel__cell--eye-muted' : ' pixel-panel__cell--eye';
    } else if (baseShade(index) < 0) {
      className += ' pixel-panel__cell--olive';
    } else {
      // Under reduced motion each state keeps one fixed pattern.
      const lit =
        reducedMotion && pending
          ? (index * (state === 'drafting' ? 7 : 11)) % 5 === 0
          : flicker?.index === index;
      const shade = lit ? (flicker?.shade ?? 0.85) : baseShade(index);
      style = { opacity: shade };
    }
    cells.push(<span key={index} className={className} style={style} />);
  }

  return (
    <figure className={`pixel-panel pixel-panel--${size}`}>
      <div className="pixel-panel__face" role="img" aria-label={`Assistant status: ${state}`}>
        <div className="pixel-panel__grid" aria-hidden="true">
          {cells}
        </div>
      </div>
      <figcaption className="pixel-panel__caption muted">Assistant / {state}</figcaption>
    </figure>
  );
}
