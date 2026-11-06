/** DOM helpers and the shared UI regions. */

export function h(tag: string, attrs: Record<string, string | number | boolean | ((ev: Event) => void)> = {}, ...children: (Node | string | null | undefined)[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (key === 'class' && typeof value === 'string') {
      element.className = value;
    } else if (key === 'text' && typeof value === 'string') {
      element.textContent = value;
    } else if (typeof value === 'function') {
      element.addEventListener(key.replace(/^on/, ''), value as (ev: Event) => void);
    } else if (typeof value === 'boolean') {
      if (value) element.setAttribute(key, '');
    } else {
      element.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

export function clear(element: HTMLElement): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

export function money(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? '-$' : '$'}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

export function hoursText(hours: number): string {
  const rounded = Math.round(hours * 4) / 4;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

export const STATUS_WORDS: Record<string, string> = {
  held: 'Held',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Completed',
  no_show: 'No-show',
  cancelled_free: 'Cancelled',
  cancelled_late: 'Late cancel',
  expired: 'Expired',
};

export const DOC_STATUS_WORDS: Record<string, string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  expiring: 'Expiring',
  expired: 'Expired',
  superseded: 'Superseded',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthName(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

export function headingDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' }).format(d);
  const day = Number(date.slice(8, 10));
  const month = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long' }).format(d);
  return `${weekday} ${day} ${month} ${date.slice(0, 4)}`;
}

export function blockLabel(block: { stationName: string; kind: string; localDate: string; localStart: string | null | undefined; localEnd: string | null | undefined; days: number | null }): string {
  if (block.kind === 'shelf') {
    return `${block.stationName} ${block.localDate} for ${block.days === 1 ? '1 day' : `${block.days} days`}`;
  }
  return `${block.stationName} ${block.localDate} ${block.localStart ?? ''}–${block.localEnd ?? ''}`;
}

export function statusWords(block: { status: string; conflict?: boolean; billingStatus?: string }): string {
  let words = STATUS_WORDS[block.status] ?? 'Confirmed';
  if (block.conflict) words += ', Conflict';
  if (block.billingStatus === 'pending_billing') words += ', Pending billing';
  else if (block.billingStatus === 'billed') words += ', Billed';
  return words;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
