import { useEffect, useState } from 'preact/hooks';

export interface ToastLine { id: number; text: string }

const lines: ToastLine[] = [];
let toastMs = 4000;
const listeners = new Set<() => void>();
let nextId = 1;
const removalTimers = new Map<number, ReturnType<typeof setTimeout>>();

export function configureToasts(ms: number): void {
  toastMs = ms;
}

export function say(text: string): void {
  if (lines.some((l) => l.text === text)) {
    const existing = lines.find((l) => l.text === text)!;
    clearTimeout(removalTimers.get(existing.id));
    removalTimers.set(existing.id, setTimeout(() => removeLine(existing.id), toastMs));
    bump();
    return;
  }
  const line = { id: nextId++, text };
  lines.push(line);
  if (lines.length > 3) {
    const oldest = lines.shift()!;
    clearTimeout(removalTimers.get(oldest.id));
    removalTimers.delete(oldest.id);
  }
  removalTimers.set(line.id, setTimeout(() => removeLine(line.id), toastMs));
  bump();
}

function removeLine(id: number): void {
  const idx = lines.findIndex((l) => l.id === id);
  if (idx !== -1) lines.splice(idx, 1);
  removalTimers.delete(id);
  bump();
}

function bump(): void {
  for (const l of listeners) l();
}

export function useStatus(): ToastLine[] {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return lines;
}

export function formatCountdown(seconds: number): string {
  const total = Math.max(0, seconds);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `Hand-in in ${d}d ${h}h ${m}m`;
}

export function savedTimeLabel(iso: string, timeZone: string | null): string {
  const date = new Date(iso);
  const zone = timeZone ?? undefined;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

export function shortBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
