import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

type Mark = (id: object, busy: boolean) => void;

const SettlingContext = createContext<Mark>(() => undefined);

/**
 * Holds the page back (hidden, still laid out) while any part of it is loading its first answer, so the page is
 * painted once at its final layout instead of shifting as each list arrives.
 */
export function SettlingProvider({ children }: { children: (settling: boolean) => ReactNode }) {
  const [busy, setBusy] = useState<ReadonlySet<object>>(() => new Set());
  const mark = useCallback<Mark>((id, loading) => {
    setBusy((current) => {
      if (current.has(id) === loading) return current;
      const next = new Set(current);
      if (loading) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  return <SettlingContext.Provider value={mark}>{children(busy.size > 0)}</SettlingContext.Provider>;
}

/** Keeps the page hidden while `loading` is true; set before the first paint, so the empty page is never shown. */
export function useSettling(loading: boolean): void {
  const mark = useContext(SettlingContext);
  const id = useMemo(() => ({}), []);
  useLayoutEffect(() => {
    mark(id, loading);
    return () => mark(id, false);
  }, [mark, id, loading]);
}
