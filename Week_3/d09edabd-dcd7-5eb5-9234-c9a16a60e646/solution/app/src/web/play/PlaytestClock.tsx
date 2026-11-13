import { useEffect } from 'react';
import { mmss } from '../../shared/format';
import { secondsLeft, useTicker } from '../ui/countdown';

const RECHECK_MS = 1000;

interface Props {
  remainingSeconds: number;
  /** `performance.now()` when the figure arrived from the server. */
  receivedAt: number;
  /** The clock reached zero: ask the server what happened. */
  onExpire: () => void;
}

/** The server's remaining time counted down by the time elapsed on this page since it arrived. */
export function PlaytestClock({ remainingSeconds, receivedAt, onExpire }: Props) {
  useTicker();
  const shown = secondsLeft(remainingSeconds, receivedAt);
  useEffect(() => {
    if (shown > 0) return;
    const timer = window.setTimeout(onExpire, RECHECK_MS);
    return () => window.clearTimeout(timer);
  }, [shown, receivedAt, onExpire]);

  return (
    <span role="timer" aria-label="Playtest clock" className="clock">
      {mmss(shown)}
    </span>
  );
}
