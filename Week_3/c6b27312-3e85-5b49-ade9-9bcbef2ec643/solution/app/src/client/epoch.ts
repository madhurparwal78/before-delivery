// The painted epoch (DP-75): advances by one per painted result, persists per tab in sessionStorage.
import { useCallback, useRef, useState } from "react";

function stored(key: string): number {
  const n = Number(window.sessionStorage.getItem(key) ?? 0);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function useEpoch(key: string): [number, (by?: number) => void] {
  const current = useRef<{ key: string; value: number } | null>(null);
  if (!current.current || current.current.key !== key) current.current = { key, value: stored(key) };
  const [epoch, setEpoch] = useState(current.current.value);
  const bump = useCallback((by = 1) => {
    const entry = current.current as { key: string; value: number };
    entry.value += by;
    window.sessionStorage.setItem(entry.key, String(entry.value));
    setEpoch(entry.value);
  }, []);
  return [epoch, bump];
}
