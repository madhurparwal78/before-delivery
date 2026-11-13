import type { JSX } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { formatClock } from "../format";

interface ClockProps {
  /** Active time in ms, read from the page's own clock. */
  read: () => number;
  running: boolean;
}

/** `#timer`: ticks exactly on each whole second of active time. */
export function Clock({ read, running }: ClockProps): JSX.Element {
  const [seconds, setSeconds] = useState(() => Math.floor(read() / 1000));
  useLayoutEffect(() => {
    setSeconds(Math.floor(read() / 1000));
    if (!running) return undefined;
    let timer = 0;
    const tick = (): void => {
      const elapsed = read();
      setSeconds(Math.floor(elapsed / 1000));
      timer = window.setTimeout(tick, Math.max(1, 1000 - (elapsed % 1000)));
    };
    timer = window.setTimeout(tick, Math.max(1, 1000 - (read() % 1000)));
    return () => window.clearTimeout(timer);
  }, [running, read]);
  return (
    <div id="timer" class="timer" role="timer" aria-label="Time">
      {formatClock(seconds)}
    </div>
  );
}
