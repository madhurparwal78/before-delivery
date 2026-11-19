import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { announceFromServer } from '../lib/announce';
import { useLive } from '../lib/live';
import { useReducedMotion } from '../lib/env';

export interface BeaconValues {
  waiting: number;
  overdue: number;
  dueWithinHour: number;
}

const COUNT_MS = 1600;
const ROLL_MS = 600;
const EASING = '0.16, 1, 0.3, 1';
const TAIL_MS = 1000;

type Phase = 'count' | 'idle' | 'roll';

/** Indices of the digits that change between two totals; a change in the number of digits rolls every digit. */
function changedDigits(before: number, after: number): number[] {
  const [a, b] = [String(before), String(after)];
  return [...b].map((_, i) => i).filter((i) => a.length !== b.length || a[i] !== b[i]);
}

function BeaconCard({ label, tone, value, index }: { label: string; tone: 'mint' | 'rose' | 'sky'; value: number; index: number }) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('count');
  const [rolling, setRolling] = useState<number[]>([]);
  const [generation, setGeneration] = useState(0);
  const phaseRef = useRef<Phase>('count');
  const shown = useRef(value);
  const timer = useRef<number | undefined>(undefined);

  const go = (next: Phase, after: number) => {
    phaseRef.current = next;
    setPhase(next);
    window.clearTimeout(timer.current);
    if (next !== 'idle') {
      timer.current = window.setTimeout(() => {
        phaseRef.current = 'idle';
        setPhase('idle');
        setRolling([]);
      }, after);
    }
  };

  useEffect(() => {
    if (!reduced) go('count', index * 150 + COUNT_MS + TAIL_MS);
    return () => window.clearTimeout(timer.current);
    // The first count starts once, when the card first has a total.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (value === shown.current) return;
    const before = shown.current;
    shown.current = value;
    if (reduced || phaseRef.current === 'count') return;
    setRolling(changedDigits(before, value));
    setGeneration((g) => g + 1);
    go('roll', ROLL_MS + TAIL_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const digits = [...String(value)];
  const motion = reduced
    ? { 'data-motion': 'none', 'data-motion-ms': '0' }
    : phase === 'count'
      ? { 'data-motion': 'beacon-count', 'data-motion-ms': String(COUNT_MS), 'data-motion-easing': EASING }
      : phase === 'roll'
        ? { 'data-motion': 'beacon-roll', 'data-motion-ms': String(ROLL_MS), 'data-motion-easing': EASING }
        : { 'data-motion': 'idle' };
  return (
    <div role="status" aria-label={label} aria-live="off" data-value={value} {...motion} className={`beacon tint-${tone}`}>
      <span className="beacon-digits" aria-hidden="true">
        {digits.map((digit, i) => {
          const rolls = phase === 'roll' && rolling.includes(i);
          const style = { '--d': Number(digit), '--delay': `${index * 150}ms` } as CSSProperties;
          return (
            <span
              key={rolls ? `r${generation}-${i}` : i}
              className="digit"
              data-digit={digit}
              data-rolling={rolls ? 'true' : undefined}
              data-anim={reduced ? 'none' : phase === 'count' ? 'count' : rolls ? 'roll' : 'none'}
              style={style}
            >
              <span className="digit-strip">
                {Array.from({ length: 10 }, (_, n) => (
                  <span key={n}>{n}</span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
      <span className="sr-only">{value}</span>
      <span className="beacon-caption">{label}</span>
    </div>
  );
}

/** The three Kennel beacon cards. Server-started overdue changes are announced from here, in every window showing them. */
export function KennelBeacons({ values }: { values: BeaconValues | undefined }) {
  useLive(['overdue'], (event) => {
    if (event.t === 'overdue') announceFromServer(`Overdue now ${event.total}. ${event.patient}, ${event.treatment} due ${event.due}.`);
  });
  if (!values) {
    return (
      <div className="beacons" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="beacon skeleton-card" />
        ))}
      </div>
    );
  }
  return (
    <div className="beacons">
      <BeaconCard label="Waiting" tone="mint" value={values.waiting} index={0} />
      <BeaconCard label="Overdue" tone="rose" value={values.overdue} index={1} />
      <BeaconCard label="Due within the hour" tone="sky" value={values.dueWithinHour} index={2} />
    </div>
  );
}
