// Drafts kept in browser storage per namespace and workspace; they survive reload and sign-in.

import { useCallback, useEffect, useRef, useState } from "react";

export function readDraft<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeDraft<T>(key: string, value: T | null): void {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(value));
}

/** A value mirrored to browser storage under `key`; `clear` removes it. */
export function useDraft<T>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void, () => void] {
  const initial = useRef(fallback);
  const [value, setValue] = useState<T>(() => readDraft(key, fallback));
  useEffect(() => setValue(readDraft(key, initial.current)), [key]);
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        writeDraft(key, resolved);
        return resolved;
      });
    },
    [key],
  );
  const clear = useCallback(() => {
    writeDraft(key, null);
    setValue(initial.current);
  }, [key]);
  return [value, set, clear];
}
