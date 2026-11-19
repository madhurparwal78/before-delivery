import { useCallback, useEffect, useState } from 'react';

/**
 * Text drafts, divider positions, marker coordinates, staged orders and queued
 * audit marks are kept in the browser per namespace and workspace, and survive
 * reload and sign-in. Staged photo files are not kept: they live only in the
 * open tab. Ordinary browser storage is used; no service worker is involved.
 */

const PREFIX = 'flan';

function keyFor(ns: string, workspace: string, name: string): string {
  return `${PREFIX}:${ns}:${workspace}:${name}`;
}

function read<T>(storageKey: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(storageKey: string, value: unknown): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Storage being unavailable only costs the draft its persistence.
  }
}

export function useDraft<T>(
  ns: string,
  workspace: string,
  name: string,
  initial: T,
): [T, (next: T) => void] {
  const storageKey = keyFor(ns, workspace, name);
  const [value, setValue] = useState<T>(() => read(storageKey, initial));

  useEffect(() => {
    setValue(read(storageKey, initial));
    // Only the storage key identifies the draft; `initial` is its fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      write(storageKey, next);
    },
    [storageKey],
  );

  return [value, update];
}

export function readDraft<T>(ns: string, workspace: string, name: string, fallback: T): T {
  return read(keyFor(ns, workspace, name), fallback);
}

export function writeDraft(ns: string, workspace: string, name: string, value: unknown): void {
  write(keyFor(ns, workspace, name), value);
}
