import { useCallback, useEffect, useRef, useState } from "react";

/** How long a swiped decision waits for an Undo before it is sent (browser clock). */
const UNDO_MS = 5000;

interface Held<T> {
  value: T;
  /** True once the Undo period is over and the decision is on its way to the server. */
  sent: boolean;
}

/**
 * Decisions that wait five seconds for an Undo. `fire` sends one; the entry stays held, and hidden by the caller,
 * until it settles. Leaving the screen sends whatever is still waiting.
 */
export function useUndoQueue<T extends { key: string }>(fire: (value: T) => Promise<void>): { held: Held<T>[]; hold(value: T): void; undo(key: string): void } {
  const [held, setHeld] = useState<Held<T>[]>([]);
  const timers = useRef(new Map<string, { id: number; value: T }>());
  const latest = useRef(fire);
  latest.current = fire;

  const send = useCallback((value: T): void => {
    timers.current.delete(value.key);
    setHeld((list) => list.map((entry) => (entry.value.key === value.key ? { ...entry, sent: true } : entry)));
    void latest.current(value).finally(() => setHeld((list) => list.filter((entry) => entry.value.key !== value.key)));
  }, []);

  const hold = useCallback(
    (value: T): void => {
      setHeld((list) => [...list.filter((entry) => entry.value.key !== value.key), { value, sent: false }]);
      timers.current.set(value.key, { id: window.setTimeout(() => send(value), UNDO_MS), value });
    },
    [send],
  );

  const undo = useCallback((key: string): void => {
    const waiting = timers.current.get(key);
    if (waiting) window.clearTimeout(waiting.id);
    timers.current.delete(key);
    setHeld((list) => list.filter((entry) => entry.value.key !== key));
  }, []);

  useEffect(() => {
    const waiting = timers.current;
    return () => {
      for (const { id, value } of [...waiting.values()]) {
        window.clearTimeout(id);
        void latest.current(value);
      }
      waiting.clear();
    };
  }, []);

  return { held, hold, undo };
}
