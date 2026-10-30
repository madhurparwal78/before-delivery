// The visitor's agenda lives in browser storage, so it survives a reload in the same browser.
import { useSyncExternalStore } from "react";
import { clashPairs } from "../../shared/clash.ts";
import type { Session } from "../types.ts";

const KEY = "kf-agenda";
const listeners = new Set<() => void>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(ids: string[]): void {
  cache = ids;
  localStorage.setItem(KEY, JSON.stringify(ids));
  listeners.forEach((l) => l());
}

export function useAgenda(): string[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, read);
}

export function toggleAgenda(id: string): boolean {
  const ids = read();
  const adding = !ids.includes(id);
  write(adding ? [...ids, id] : ids.filter((x) => x !== id));
  return adding;
}

/** Agenda sessions in real-time order, with every clashing pair (instants, so the clock change is honoured). */
export function agendaView(sessions: readonly Session[], ids: readonly string[]) {
  const chosen = sessions.filter((s) => ids.includes(s.id)).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const pairs = clashPairs(chosen.map((s) => ({ id: s.id, startsAt: Date.parse(s.starts_at), endsAt: Date.parse(s.ends_at) })));
  const clashesOf = (id: string) => pairs.filter((p) => p.includes(id)).map((p) => (p[0] === id ? p[1] : p[0]));
  return { chosen, pairs, clashesOf };
}
