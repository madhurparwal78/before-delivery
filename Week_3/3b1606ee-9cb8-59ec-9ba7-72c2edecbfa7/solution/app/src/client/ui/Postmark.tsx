import { useLayoutEffect, useRef, useState } from 'react';
import { formatTime } from '../lib/format';
import { useReducedMotion } from '../lib/hooks';
import { sendMotionFor, strike } from '../lib/motion';

interface Roll {
  from: string;
  to: string;
}

/**
 * A round ink ring holding its label and a time. When the label or time changes after the first paint it is struck
 * again (and the digits change one at a time); after a reload nothing moves.
 */
export function Postmark({ letterId, label, time }: { letterId: string; label: string; time: string | null }) {
  const ring = useRef<HTMLSpanElement>(null);
  const previous = useRef<{ label: string; shown: string | null } | null>(null);
  const [roll, setRoll] = useState<Roll | null>(null);
  const [inked, setInked] = useState(false);
  const reduced = useReducedMotion();
  const shown = time ? formatTime(time) : null;

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { label, shown };
    if (!before || (before.label === label && before.shown === shown)) return;
    if (reduced) {
      setInked(true);
      const timer = setTimeout(() => setInked(false), 2000);
      return () => clearTimeout(timer);
    }
    const send = sendMotionFor(letterId);
    const run = (): void => {
      if (ring.current) strike(ring.current);
      if (before.shown && shown) setRoll({ from: before.shown, to: shown });
    };
    if (send) void send.landing.then(run);
    else run();
    return undefined;
  }, [label, shown, letterId, reduced]);

  const changing = roll ? [...roll.to].filter((char, at) => char !== roll.from[at]).length : 0;
  let finished = 0;
  return (
    <span className="postmark" data-testid="postmark">
      <span ref={ring} className={`postmark__ring${label.length > 12 ? ' postmark__ring--long' : ''}`}>
        <span className={`postmark__label${inked ? ' postmark__label--inked' : ''}`} data-testid="postmark-label">
          {label}
        </span>
        {time && shown && (
          <time
            className="postmark__time"
            dateTime={time}
            onAnimationEnd={() => {
              finished += 1;
              if (finished >= changing) setRoll(null);
            }}
          >
            {roll
              ? [...roll.to].map((char, at) =>
                  char === roll.from[at] ? (
                    <span key={at}>{char}</span>
                  ) : (
                    <span key={at} className="digit" style={{ ['--i' as string]: at }}>
                      <span className="digit__old">{roll.from[at] ?? ''}</span>
                      <span className="digit__new">{char}</span>
                    </span>
                  ),
                )
              : shown}
          </time>
        )}
      </span>
    </span>
  );
}
