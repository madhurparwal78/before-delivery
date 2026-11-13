import { useEffect, useRef, useState } from 'react';

const ROLL_MS = 600;

export interface RollingNumberProps {
  value: number;
  animate: boolean;
}

/** The scoreboard drum: each digit rolls separately while the total counts up. */
export const RollingNumber = ({ value, animate }: RollingNumberProps) => {
  const [shown, setShown] = useState(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!animate) {
      setShown(value);
      return;
    }
    const from = shown;
    if (from === value) return;
    const started = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - started) / ROLL_MS);
      setShown(Math.round(from + (value - from) * progress));
      if (progress < 1) frame.current = window.requestAnimationFrame(step);
    };
    frame.current = window.requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
    // The roll starts from whatever is on screen when the new value lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, animate]);

  const text = String(shown);
  return (
    <>
      {[...text].map((digit, index) => (
        <span key={`${index}-${digit}`} className={animate ? 'digit digit-roll' : 'digit'}>
          {digit}
        </span>
      ))}
    </>
  );
};
