import { useCallback, useEffect, useRef, useState } from 'react';

const GAP_MS = 450;

/**
 * Posts queued messages to a live region one after another, so a burst of state
 * changes is announced in order rather than collapsing into the last one.
 */
export function useAnnouncer(): {
  message: string | null;
  announce(...messages: readonly string[]): void;
  replace(message: string | null): void;
} {
  const [message, setMessage] = useState<string | null>(null);
  const queue = useRef<string[]>([]);
  const timer = useRef<number | null>(null);

  const drain = useCallback(() => {
    const next = queue.current.shift();
    if (next === undefined) {
      timer.current = null;
      return;
    }
    setMessage(next);
    timer.current = window.setTimeout(drain, GAP_MS);
  }, []);

  const announce = useCallback(
    (...messages: readonly string[]) => {
      if (messages.length === 0) return;
      queue.current.push(...messages);
      if (timer.current === null) drain();
    },
    [drain],
  );

  /** Shows a message at once, dropping anything still queued. */
  const replace = useCallback((next: string | null) => {
    queue.current = [];
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setMessage(next);
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return { message, announce, replace };
}
