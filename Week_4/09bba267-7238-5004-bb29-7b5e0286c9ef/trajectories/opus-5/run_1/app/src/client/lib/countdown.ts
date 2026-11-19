import { useEffect, useRef, useState } from 'react';

export function formatCountdown(secondsLeft: number): string {
  const safe = Math.max(0, secondsLeft);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Counts down from the seconds the server reported, never from the device clock. When it reaches
 * zero it asks the server, and resumes if the server still reports time left.
 */
export function useServerCountdown(serverSecondsLeft: number | null, onZero: () => void): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(serverSecondsLeft);
  const askedAtZero = useRef(false);
  const zeroHandler = useRef(onZero);
  zeroHandler.current = onZero;

  useEffect(() => {
    setSecondsLeft(serverSecondsLeft);
    askedAtZero.current = false;
  }, [serverSecondsLeft]);

  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) {
      if (askedAtZero.current) return;
      askedAtZero.current = true;
      zeroHandler.current();
      return;
    }
    const timer = setTimeout(() => {
      setSecondsLeft((current) => (current === null ? null : current - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  return secondsLeft;
}
