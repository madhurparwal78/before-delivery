// Shared browser helpers: fetch, announcements, motion, countdowns.

export interface SlaView {
  id: string;
  definition: string;
  priority: number;
  stage: 'in_progress' | 'paused' | 'completed' | 'cancelled';
  start_at: string;
  target_seconds: number;
  elapsed_seconds: number;
  remaining_seconds: number;
  paused_seconds: number;
  percent: number;
  breached: boolean;
  ticking: boolean;
  next_change_at: string | null;
  server_time: string;
}

export interface RecordSummary {
  number: string;
  table: string;
  state: string;
  state_label: string;
  short_description: string;
  priority: number | null;
  assigned_to: string | null;
  sla: {
    percent: number;
    remaining_seconds: number;
    ticking: boolean;
    next_change_at: string | null;
    server_time: string;
    stage: string;
    breached: boolean;
  } | null;
  label: string;
}

export interface RecordView {
  number: string;
  table: string;
  state: string;
  state_label: string;
  fields: Record<string, { value: unknown; display: string; version: number; label: string; mandatory: boolean; read_only: boolean; visible: boolean }>;
  priority_overridden: boolean;
  slas: SlaView[];
  links: { parent: string | null; children: string[]; problem: string | null; incidents: string[]; fix_change: string | null };
  workaround: { problem: string; text: string } | null;
  transitions: Array<{ to: string; label: string }>;
}

/** Fetch JSON from the app's own origin, with the one error body. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(init?.headers as Record<string, string> | undefined) },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(body?.error?.message ?? 'Request failed') as Error & { status?: number; code?: string; body?: unknown };
    err.status = res.status;
    err.code = body?.error?.code;
    err.body = body;
    throw err;
  }
  return body as T;
}

/** The Announcements status region: one live region for every result.
 *  The last announcement survives a re-render. */
let lastAnnouncement = '';

export function announce(text: string): void {
  lastAnnouncement = text;
  const region = document.querySelector('[role="status"][aria-label="Announcements"]');
  if (region) region.textContent = text;
}

export function currentAnnouncement(): string {
  return lastAnnouncement;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Motion: 180 or 420 ms, one curve that starts fast and settles softly. */
export function animate(el: Element, keyframes: Keyframe[], duration: 180 | 420): Animation {
  return el.animate(keyframes, {
    duration,
    easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)',
    fill: 'forwards',
  });
}

/** A countdown from the last server message plus the browser's elapsed delta.
 *  A wrong device clock never changes what is shown. */
export function shownRemaining(sla: SlaView, receivedAt: number): number {
  const sinceReceipt = (performance.now() - receivedAt) / 1000;
  if (!sla.ticking) return sla.remaining_seconds;
  if (sla.next_change_at === null) return sla.remaining_seconds - sinceReceipt;
  const nextChange = Date.parse(sla.next_change_at);
  const serverNow = Date.parse(sla.server_time);
  const untilChange = Math.max(0, (nextChange - serverNow) / 1000);
  return sla.remaining_seconds - Math.min(sinceReceipt, untilChange);
}

/** Duration as H:MM:SS with whole hours and padded minutes and seconds. */
export function hms(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** SLA countdown copy per the published rules. */
export function countdownText(sla: SlaView, remaining: number): string {
  if (sla.stage === 'completed') return sla.breached ? 'Missed' : 'Met';
  if (sla.stage === 'paused') return `Paused at ${hms(remaining)} left`;
  if (sla.breached) return `Breached by ${hms(-remaining)}`;
  return `${hms(remaining)} left`;
}

export function navigate(path: string): void {
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
