// Small DOM helpers shared by every screen.

export function el(tag: string, attrs: Record<string, string | number | boolean | null> = {}, text?: string): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === false) continue;
    if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

export function text(value: string): Text {
  return document.createTextNode(value);
}

export function announce(statusEl: HTMLElement, message: string): void {
  statusEl.textContent = '';
  // A fresh node forces the region to announce again.
  const span = document.createElement('span');
  span.textContent = message;
  statusEl.appendChild(span);
}

export function statusRegion(name: string, classes: string[] = []): HTMLElement {
  const region = el('div', { role: 'status', 'aria-label': name }, '');
  region.className = ['status-region', ...classes].join(' ');
  return region;
}

export function formatSpeed(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  return roundHalfUp(n).toFixed(2);
}

export function formatPercent(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  return `${roundHalfUp(n).toFixed(2)}%`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '-';
  return `${roundHalfUp(ms / 1000).toFixed(2)} s`;
}

/** Round half up to two decimals. */
export function roundHalfUp(value: number): number {
  const negative = value < 0;
  const abs = Math.abs(value);
  const rounded = Math.ceil(abs * 100 - 0.5) / 100;
  return negative ? -rounded : rounded;
}

/** Whole numbers rounded half up. */
export function roundHalfUpInt(value: number): number {
  return Math.ceil(value - 0.5);
}

export function utcDateString(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function utcDateTimeString(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${utcDateString(iso)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function utcDateTimeFull(iso: string): string {
  return `${utcDateTimeString(iso)} UTC`;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}
