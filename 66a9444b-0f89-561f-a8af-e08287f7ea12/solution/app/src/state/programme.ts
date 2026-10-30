// The public programme, fetched once and refreshed every 15 seconds and after each of the visitor's actions.
import { useEffect, useSyncExternalStore } from "react";
import { api } from "../api.ts";
import type { Programme } from "../types.ts";

const REFRESH_MS = 15_000;
let current: Programme | null = null;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

export function refreshProgramme(): Promise<void> {
  inflight ??= api.get<Programme>("/api/programme").then((r) => {
    if (r.ok) {
      current = r.data;
      listeners.forEach((l) => l());
    }
  }).finally(() => { inflight = null; });
  return inflight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!current) void refreshProgramme();
  return () => listeners.delete(listener);
}

export function useProgramme(live = false): Programme | null {
  const programme = useSyncExternalStore(subscribe, () => current);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void refreshProgramme(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [live]);
  return programme;
}
