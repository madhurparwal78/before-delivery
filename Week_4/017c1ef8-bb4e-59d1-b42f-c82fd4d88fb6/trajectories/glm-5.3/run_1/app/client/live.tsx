import { useEffect, useRef, useState } from 'react';
import type { LiveBus } from './app-context.js';

/** Live region: announces the exact published string for each async result. */
export const LiveRegion = ({ role, name, text }: { role: 'status' | 'alert'; name: string; text: string }): JSX.Element => {
  const [value, setValue] = useState('');
  const keyRef = useRef(0);
  useEffect(() => {
    if (!text) { setValue(''); return; }
    keyRef.current += 1;
    setValue(text);
  }, [text]);
  return (
    <div role={role === 'status' ? 'status' : 'alert'} aria-live="polite" className="visually-hidden" data-region={name}>
      {value}
    </div>
  );
};

export const useLiveSubscription = (bus: LiveBus, handler: (event: string, data: unknown) => void): void => {
  useEffect(() => bus.subscribe(handler), [bus, handler]);
};

/** Relative-time label that re-renders every minute and on clock moves. */
export const useTicker = (now: () => Date): void => {
  const [, force] = useState(0);
  useEffect(() => {
    void now;
    const id = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [now]);
};

export const makeIdempotencyKey = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
