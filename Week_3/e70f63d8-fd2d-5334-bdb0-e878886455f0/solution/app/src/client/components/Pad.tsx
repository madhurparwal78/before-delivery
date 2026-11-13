import type { JSX } from 'preact';
import { MAX_RUNS } from '../../shared/rules.js';
import type { Extra } from '../../shared/wire.js';

export const EXTRA_LABELS: { extra: Exclude<Extra, 'none'>; label: string; hint: string }[] = [
  { extra: 'wide', label: 'Wide', hint: 'D' },
  { extra: 'no-ball', label: 'No-ball', hint: 'N' },
  { extra: 'bye', label: 'Bye', hint: 'B' },
  { extra: 'leg-bye', label: 'Leg bye', hint: 'L' },
];

const RUN_KEYS = Array.from({ length: MAX_RUNS + 1 }, (_, value) => value);

interface PadProps {
  /** Runs, extras and Wicket; Undo has its own flag. */
  scoring: boolean;
  undo: boolean;
  busy: boolean;
  armed: Extra | null;
  onDigit: (value: number) => void;
  onExtra: (extra: Exclude<Extra, 'none'>) => void;
  onWicket: () => void;
  onUndo: () => void;
}

/** The scoring pad: a four-by-four grid of square keys. Each key does exactly what its keyboard key does. */
export const Pad = ({ scoring, undo, busy, armed, onDigit, onExtra, onWicket, onUndo }: PadProps): JSX.Element => (
  <div role="group" aria-label="Scoring pad" class="pad" aria-busy={busy}>
    {RUN_KEYS.map((value) => (
      <button type="button" key={value} class="key" data-key={value} disabled={!scoring} onClick={() => onDigit(value)}>{value}</button>
    ))}
    {EXTRA_LABELS.map(({ extra, label, hint }) => (
      <ExtraKey key={extra} extra={extra} label={label} hint={hint} scoring={scoring} armed={armed === extra} onExtra={onExtra} />
    ))}
    <button type="button" class="key key-wicket" data-key="W" disabled={!scoring} onClick={onWicket}>
      Wicket<span class="hint" aria-hidden="true">W</span>
    </button>
    <button type="button" class="key key-undo" data-key="U" disabled={!undo} onClick={onUndo}>
      Undo<span class="hint" aria-hidden="true">U</span>
    </button>
  </div>
);

const ExtraKey = ({ extra, label, hint, scoring, armed, onExtra }: {
  extra: Exclude<Extra, 'none'>; label: string; hint: string; scoring: boolean; armed: boolean; onExtra: (extra: Exclude<Extra, 'none'>) => void;
}): JSX.Element => (
  <button type="button" class="key key-extra" data-key={hint} aria-pressed={armed} disabled={!scoring} onClick={() => onExtra(extra)}>
    {label}<span class="hint" aria-hidden="true">{hint}</span>
    {armed ? <span class="armed-tag" aria-hidden="true">armed</span> : null}
  </button>
);
