import { useEffect, useState } from 'react';
import { serverNow } from './serverTime';

const TICK_MS = 200;

function secondsLeft(deadlineAt: number | null): number {
  if (deadlineAt === null) return 0;
  return Math.max(0, Math.ceil((deadlineAt - serverNow()) / 1000));
}

/** Whole seconds left, drawn from the server deadline and this device's offset. */
export function useSecondsLeft(deadlineAt: number | null): number {
  const [left, setLeft] = useState(() => secondsLeft(deadlineAt));
  useEffect(() => {
    setLeft(secondsLeft(deadlineAt));
    if (deadlineAt === null) return undefined;
    const timer = setInterval(() => setLeft(secondsLeft(deadlineAt)), TICK_MS);
    return () => clearInterval(timer);
  }, [deadlineAt]);
  return left;
}
