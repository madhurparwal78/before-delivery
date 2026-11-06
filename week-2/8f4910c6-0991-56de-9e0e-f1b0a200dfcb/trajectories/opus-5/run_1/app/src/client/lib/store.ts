import type { OfficeRecord } from '../../shared/types.js';
import { call } from './api.js';

const TRAY_KEY = 'rungboard.tray';
const DRAFT_PREFIX = 'rungboard.draft.';

export type TrayEntry = { slug: string; displayName: string };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A browser with no storage simply keeps nothing.
  }
}

export const TRAY_LIMIT = 12;

export function tray(): TrayEntry[] {
  return read<TrayEntry[]>(TRAY_KEY, []);
}

export function trayHas(slug: string): boolean {
  return tray().some((entry) => entry.slug === slug);
}

export function trayAdd(entry: TrayEntry): 'added' | 'full' {
  const current = tray();
  if (current.some((item) => item.slug === entry.slug)) return 'added';
  if (current.length >= TRAY_LIMIT) return 'full';
  write(TRAY_KEY, [...current, entry]);
  return 'added';
}

export function trayRemove(slug: string): void {
  write(TRAY_KEY, tray().filter((entry) => entry.slug !== slug));
}

export function trayMove(slug: string, delta: number): number {
  const current = tray();
  const index = current.findIndex((entry) => entry.slug === slug);
  const next = index + delta;
  if (index === -1 || next < 0 || next >= current.length) return index;
  const copy = [...current];
  const [moved] = copy.splice(index, 1);
  copy.splice(next, 0, moved);
  write(TRAY_KEY, copy);
  return next;
}

export function draft<T>(name: string, fallback: T): T {
  return read<T>(`${DRAFT_PREFIX}${name}`, fallback);
}

export function saveDraft(name: string, value: unknown): void {
  write(`${DRAFT_PREFIX}${name}`, value);
}

export function clearDraft(name: string): void {
  try {
    window.localStorage.removeItem(`${DRAFT_PREFIX}${name}`);
  } catch {
    // nothing kept
  }
}

let offices: OfficeRecord[] | null = null;

export async function loadOffices(): Promise<OfficeRecord[]> {
  if (offices) return offices;
  const result = await call<{ offices: OfficeRecord[] }>('GET', '/api/offices');
  offices = result.body?.offices ?? [];
  return offices;
}

export async function officeOf(id: string): Promise<OfficeRecord> {
  const all = await loadOffices();
  return all.find((office) => office.id === id) ?? all[0];
}
