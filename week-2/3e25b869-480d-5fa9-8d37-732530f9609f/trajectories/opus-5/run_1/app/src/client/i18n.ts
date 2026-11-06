import { formatMoney } from '../shared/money.js';
import { formatDropTime, formatLongDate } from '../shared/toronto.js';
import { isLocale, type Locale, type Money } from '../shared/types.js';

let active: Locale = 'en-CA';

export function locale(): Locale {
  return active;
}

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function initLocale(): Locale {
  const cookie = readCookie('pdl_locale');
  if (cookie && isLocale(cookie)) active = cookie;
  else active = navigator.language.toLowerCase().startsWith('fr') ? 'fr-CA' : 'en-CA';
  document.documentElement.lang = active;
  return active;
}

export function setLocale(next: Locale): void {
  active = next;
  document.cookie = `pdl_locale=${next}; Path=/; SameSite=Lax; Max-Age=${365 * 24 * 60 * 60}`;
  document.documentElement.lang = next;
}

export function otherLocale(): Locale {
  return active === 'fr-CA' ? 'en-CA' : 'fr-CA';
}

export function cash(value: Money): string {
  return formatMoney(value, active);
}

export function longDate(date: string): string {
  return formatLongDate(date, active);
}

export function dropTime(instant: string): string {
  return formatDropTime(new Date(instant), active);
}
