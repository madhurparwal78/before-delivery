import { useEffect, useState, type ReactElement } from 'react';
import { useShop } from '../state/shop.js';

function format(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/**
 * Counts down from the server's expiry time, corrected for the gap between the
 * browser clock and the server clock. The tick only changes the time shown.
 */
export function HoldTimer(): ReactElement {
  const { cart, serverOffsetMs } = useShop();
  const expiresAt = cart?.hold.expires_at ?? null;
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (expiresAt === null) {
      setLeft(0);
      return;
    }
    const tick = () =>
      setLeft(Math.round((Date.parse(expiresAt) - (Date.now() + serverOffsetMs)) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, serverOffsetMs]);

  return (
    <p className="hold-timer">
      <span>Hold time left</span>
      <output role="timer" aria-label="Hold time left" className="mono">
        {format(left)}
      </output>
    </p>
  );
}
