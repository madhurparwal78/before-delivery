import { postJson, type DayCell, type DayDetail } from './api.js';

const QUEUE_KEY = 'sixbell.queue';
const DAY_KEY = 'sixbell.days';

type QueuedEntry = {
  entry_key: string;
  start_utc: string;
  end_utc: string;
  kind: 'rest' | 'work';
  ship_date: string;
};

type SyncReport = { synced: number; late: number };

type Listener = () => void;

const listeners = new Set<Listener>();
let writeFailedOffline = false;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is full or blocked; the queue stays in memory for this page only.
  }
}

function queuedEntries(): QueuedEntry[] {
  return read<QueuedEntry[]>(QUEUE_KEY, []);
}

export function queueCount(): number {
  return queuedEntries().length;
}

export function enqueue(entry: QueuedEntry): void {
  const queue = queuedEntries().filter((item) => item.entry_key !== entry.entry_key);
  queue.push(entry);
  write(QUEUE_KEY, queue);
  writeFailedOffline = true;
  notify();
}

export function markWriteFailedOffline(): void {
  writeFailedOffline = true;
  notify();
}

export function offline(): boolean {
  return !window.navigator.onLine || (writeFailedOffline && queueCount() > 0);
}

export function onConnectionChange(listener: Listener): void {
  listeners.add(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Keeps the current ship's day and the two days before it usable after a reload. */
export function cacheDay(crewId: string, day: DayDetail): void {
  const days = read<Record<string, DayDetail>>(DAY_KEY, {});
  days[`${crewId}:${day.ship_date}`] = day;
  const keys = Object.keys(days).sort();
  while (keys.length > 12) {
    const oldest = keys.shift();
    if (oldest !== undefined) delete days[oldest];
  }
  write(DAY_KEY, days);
}

export function cachedDay(crewId: string, shipDate: string): DayDetail | null {
  const days = read<Record<string, DayDetail>>(DAY_KEY, {});
  return days[`${crewId}:${shipDate}`] ?? null;
}

/** Paints queued cells over a cached day so an offline change shows at once. */
export function applyQueueToCells(day: DayDetail): DayCell[] {
  const cells = day.cells.map((cell) => ({ ...cell }));
  for (const entry of queuedEntries()) {
    if (entry.ship_date !== day.ship_date) continue;
    for (const cell of cells) {
      if (cell.start_utc >= entry.start_utc && cell.start_utc < entry.end_utc) {
        cell.state = entry.kind;
      }
    }
  }
  return cells;
}

export async function sendQueue(): Promise<SyncReport | null> {
  const queue = queuedEntries();
  if (queue.length === 0) {
    writeFailedOffline = false;
    notify();
    return null;
  }
  const result = await postJson<{
    results: { entry_key: string; outcome: string }[];
  }>('/api/watch-entries/sync', {
    entries: queue.map((entry) => ({
      entry_key: entry.entry_key,
      start_utc: entry.start_utc,
      end_utc: entry.end_utc,
      kind: entry.kind,
    })),
  });
  if (!result.ok) return null;
  const results = result.body.results ?? [];
  const accepted = results.filter((item) =>
    ['applied', 'late', 'replayed'].includes(item.outcome),
  );
  const late = results.filter((item) => item.outcome === 'late');
  const handled = new Set(results.map((item) => item.entry_key));
  write(
    QUEUE_KEY,
    queuedEntries().filter((entry) => !handled.has(entry.entry_key)),
  );
  writeFailedOffline = false;
  notify();
  return { synced: accepted.length, late: late.length };
}

export function startConnectionWatch(): void {
  window.addEventListener('online', () => {
    // A write that failed for lack of a connection no longer counts once the browser is back online.
    writeFailedOffline = false;
    notify();
  });
  window.addEventListener('offline', notify);
}
