import type { Item, ListSummary, Profile, SyncOp, TripList } from '../shared/types.js';

interface Cache {
  profile: Profile | null;
  items: Item[];
  lists: ListSummary[];
  listsById: Record<string, TripList>;
}

const CACHE_KEY = 'skinout.cache';
const QUEUE_KEY = 'skinout.queue';

function read<T>(key: string, fallback: T): T {
  try {
    const text = window.localStorage.getItem(key);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* a full or blocked store only costs the offline copy */
  }
}

export const cache: Cache = read<Cache>(CACHE_KEY, {
  profile: null,
  items: [],
  lists: [],
  listsById: {},
});

export function saveCache(): void {
  write(CACHE_KEY, cache);
}

/** Offline changes wait here, one op per hiker input, and survive reloads. */
export function queuedOps(): SyncOp[] {
  return read<SyncOp[]>(QUEUE_KEY, []);
}

export function queueOp(op: SyncOp): void {
  write(QUEUE_KEY, [...queuedOps(), op]);
}

export function clearQueue(): void {
  write(QUEUE_KEY, []);
}

export function newOpId(): string {
  return crypto.randomUUID();
}
