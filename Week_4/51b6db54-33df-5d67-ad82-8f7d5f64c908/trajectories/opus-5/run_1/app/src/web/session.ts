import { DEFAULT_SETTINGS, formatAverage, formatDate, formatNumber, formatRelative, type Settings } from '../shared/format.js';
import { api } from './api.js';

export interface Me {
  id: number;
  email: string;
  name: string;
  number_format: Settings['number_format'];
  time_zone: Settings['time_zone'];
}

let me: Me | null = null;
let settings: Settings = DEFAULT_SETTINGS;
let clockOffsetMs = 0;

export async function loadMe(): Promise<Me | null> {
  const result = await api.get<Me>('/api/me');
  me = result.ok ? result.body : null;
  if (me !== null) {
    settings = { number_format: me.number_format, time_zone: me.time_zone };
  }
  return me;
}

export function person(): Me | null {
  return me;
}

export function viewerSettings(): Settings {
  return settings;
}

export function setViewerSettings(next: Settings): void {
  settings = next;
  if (me !== null) {
    me.number_format = next.number_format;
    me.time_zone = next.time_zone;
  }
}

export function num(value: number): string {
  return formatNumber(value, settings.number_format);
}

export function average(total: number, count: number): string {
  return formatAverage(total, count, settings.number_format);
}

export function date(at: string | Date): string {
  return formatDate(at, settings);
}

/** Relative times follow the business clock, never the device clock. */
export async function loadBusinessClock(): Promise<void> {
  const result = await api.get<{ now: string }>('/api/config');
  if (!result.ok) return;
  clockOffsetMs = new Date(result.body.now).getTime() - Date.now();
}

export function businessNow(): Date {
  return new Date(Date.now() + clockOffsetMs);
}

export function relative(at: string | Date): string {
  return formatRelative(at, businessNow());
}

const livingTimes = new Set<HTMLElement>();

/** Relative times on open pages follow the business clock, not the device clock. */
export function relativeText(node: HTMLElement, at: string): HTMLElement {
  node.dataset.at = at;
  node.textContent = relative(at);
  livingTimes.add(node);
  return node;
}

export function startRelativeTicker(): void {
  window.setInterval(() => {
    for (const node of [...livingTimes]) {
      if (!node.isConnected) {
        livingTimes.delete(node);
        continue;
      }
      const at = node.dataset.at;
      if (at !== undefined) node.textContent = relative(at);
    }
  }, 1000);
}
