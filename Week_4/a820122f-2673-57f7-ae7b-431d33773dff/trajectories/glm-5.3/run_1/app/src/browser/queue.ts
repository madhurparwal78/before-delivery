import { apiJson } from "./api.js";

/**
 * The offline queue: entries held on the phone with their entry keys, kept in
 * localStorage so they survive a reload, sent when the connection returns.
 */

export interface QueuedEntry {
  entry_key: string;
  start_utc: string;
  end_utc: string;
  kind: "rest" | "work";
}

const STORE_KEY = "sixbell-queue";

export function readQueue(): QueuedEntry[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as QueuedEntry[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(entries: QueuedEntry[]): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(entries));
}

export function enqueue(entry: QueuedEntry): QueuedEntry[] {
  const queue = readQueue().filter((e) => e.entry_key !== entry.entry_key);
  queue.push(entry);
  writeQueue(queue);
  return queue;
}


export interface SyncResult {
  entry_key: string;
  outcome: "applied" | "replayed" | "late" | "conflict" | "rejected";
  entry: unknown;
  errors: Record<string, string> | null;
}

export function sendQueue(): void {
  const queue = readQueue();
  if (queue.length === 0) return;
  const syncStatus = document.querySelector<HTMLElement>("[aria-label='Sync status']");
  if (syncStatus) syncStatus.textContent = "Syncing.";
  apiJson<{ results: SyncResult[] }>("/api/watch-entries/sync", {
    method: "POST",
    body: JSON.stringify({ entries: queue }),
  })
    .then((response) => {
      // Entries the server applied, replayed or took late leave the queue.
      // Conflicts and rejections also leave it: their keys stay unused only
      // when the server says so, and retrying them cannot help.
      const done = new Set(response.results.map((r) => r.entry_key));
      const conflictKeys = new Set(response.results.filter((r) => r.outcome === "conflict" || r.outcome === "rejected").map((r) => r.entry_key));
      const remaining = readQueue().filter((e) => !done.has(e.entry_key) && !conflictKeys.has(e.entry_key));
      writeQueue(remaining);
      window.dispatchEvent(new CustomEvent("sixbell:synced", { detail: response }));
    })
    .catch(() => undefined);
}

