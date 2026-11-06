// DOM helpers, the two live regions, field errors and the published copy.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') throw new Error('never insert html');
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export const ICONS: Record<string, string> = {
  village: '<path d="M3 21h18M5 21V9l7-6 7 6v12"/>',
  raid: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/>',
  log: '<path d="M12 8v4l2 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"/>',
  clan: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  league: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V9m4 0v5.66M12 3a9 9 0 0 0-9 9v10h18V12a9 9 0 0 0-9-9Z"/>',
  rewards: '<path d="M3 8h18v13H3zM3 8l2-4h14l2 4M12 12v5"/>',
  profile: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/>',
  ops: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  signout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
};

export function icon(name: string, label?: string): HTMLElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', label ? 'true' : 'true');
  svg.innerHTML = ICONS[name] ?? '';
  if (label) {
    const span = el('span', { class: 'sr-only', text: label });
    const wrap = el('span', { style: 'display:inline-flex;align-items:center' }, svg, span);
    return wrap;
  }
  return svg as unknown as HTMLElement;
}

// --- the two live regions, present on every screen ---

let noticesRegion: HTMLElement | null = null;
let alertsRegion: HTMLElement | null = null;

export function ensureLiveRegions(): void {
  if (noticesRegion === null || alertsRegion === null) {
    const notices = el('div', { id: 'tide-notices', role: 'status', 'aria-label': 'Tide notices' });
    const alerts = el('div', { id: 'tide-alerts', role: 'alert', 'aria-label': 'Tide alerts' });
    document.body.append(notices, alerts);
    noticesRegion = notices;
    alertsRegion = alerts;
  }
  noticesRegion.replaceChildren();
  alertsRegion.replaceChildren();
}

function show(region: HTMLElement | null, message: string): void {
  if (region === null) ensureLiveRegions();
  const target = region ?? noticesRegion;
  target?.replaceChildren(el('p', { class: 'message', text: message }));
}

// Success and notice copy goes to Tide notices.
export function notice(message: string): void {
  show(noticesRegion, message);
}

// Error, outage and session copy goes to Tide alerts.
export function alertMessage(message: string): void {
  show(alertsRegion, message);
}

export function clearNotices(): void {
  noticesRegion?.replaceChildren();
  alertsRegion?.replaceChildren();
}

// --- field errors ---

export interface FieldErrors {
  [field: string]: string;
}

export function showFieldErrors(container: HTMLElement, errors: FieldErrors): void {
  for (const [field, message] of Object.entries(errors)) {
    const control = container.querySelector<HTMLElement>(`[data-field="${cssEscape(field)}"]`);
    if (!control) continue;
    let errorEl = container.querySelector<HTMLElement>(`[data-field-error="${cssEscape(field)}"]`);
    if (!errorEl) {
      errorEl = el('p', { class: 'field-error', 'data-field-error': field });
      control.insertAdjacentElement('afterend', errorEl);
    }
    errorEl.textContent = message;
    const describedBy = `${control.id ? control.id : ''}-error`.replace(/^-/, '');
    errorEl.id = describedBy;
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', describedBy);
  }
}

export function clearFieldErrors(container: HTMLElement): void {
  container.querySelectorAll('[data-field-error]').forEach((node) => node.remove());
  container.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));
  container.querySelectorAll('[aria-describedby]').forEach((node) => node.removeAttribute('aria-describedby'));
}

function cssEscape(value: string): string {
  return (window.CSS && CSS.escape) ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

// --- formatters ---

export function commaFormat(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatAmounts(amounts: { brine: number; peat: number; copper: number }): string {
  const parts: string[] = [];
  if (amounts.brine !== 0) parts.push(`${commaFormat(amounts.brine)} brine`);
  if (amounts.peat !== 0) parts.push(`${commaFormat(amounts.peat)} peat`);
  if (amounts.copper !== 0) parts.push(`${commaFormat(amounts.copper)} copper`);
  return parts.length === 0 ? 'nothing' : parts.join(', ');
}

// Local times in the islander's saved zone.
export function formatClock(instant: number, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(instant));
}

export function formatDateTime(instant: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')}`;
}

export function countdownText(remainingMs: number): string {
  const total = Math.max(0, Math.round(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function focusTrap(container: HTMLElement): (event: KeyboardEvent) => void {
  const handler = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const focusables = Array.from(container.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')).filter((node) => !node.hasAttribute('disabled'));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', handler);
  return handler;
}

export function uniqueId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function idempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
