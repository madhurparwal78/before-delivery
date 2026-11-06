import type { Account, Station } from './api';
import { api } from './api';

/** The business clock, read once from the server then advanced with a monotonic timer. */
export class ClientClock {
  private base = 0;
  private origin = 0;
  private rate = 1;
  private loaded = false;

  async load(): Promise<void> {
    const body = await api.clock();
    this.base = Date.parse(body.now);
    this.origin = performance.now();
    this.rate = body.rate;
    this.loaded = true;
  }

  get ready(): boolean {
    return this.loaded;
  }

  now(): number {
    return this.base + (performance.now() - this.origin) * this.rate;
  }
}

export interface AppState {
  account: Account | null;
  stations: Station[];
  readonly clock: ClientClock;
}

export function createState(): AppState {
  return { account: null, stations: [], clock: new ClientClock() };
}

export const DRAFT_PREFIX = 'pakka.draft:';
export const SEEN_PREFIX = 'pakka.seen:';

export function readDraft<T>(key: string): T | null {
  const raw = sessionStorage.getItem(DRAFT_PREFIX + key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: unknown): void {
  sessionStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(value));
}

export function clearDraft(key: string): void {
  sessionStorage.removeItem(DRAFT_PREFIX + key);
}

export function clearAllDrafts(): void {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(DRAFT_PREFIX)) sessionStorage.removeItem(key);
  }
}

/** What this device last showed for a PNR, so a change plays the Chart drop only once. */
export function readSeenStatuses(pnr: string): Record<string, string> | null {
  const raw = localStorage.getItem(SEEN_PREFIX + pnr);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return null;
  }
}

export function writeSeenStatuses(pnr: string, statuses: Record<string, string>): void {
  localStorage.setItem(SEEN_PREFIX + pnr, JSON.stringify(statuses));
}
