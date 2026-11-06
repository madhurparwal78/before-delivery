// Cart announcements: the published copy, joined in the published order.
import type { Messages } from '../shared/copy.js';
import { formatMoney } from '../shared/money.js';
import type { Locale } from '../shared/catalog.js';

/** Time left as m:ss. */
export function timeLeft(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Event messages (already in bar order), then the total message when the cart total changed. */
export function cartMessage(m: Messages, l: Locale, events: string[], before: number | null, after: number): string {
  const parts = [...events];
  if (before !== null && before !== after) parts.push(m.cartTotal(formatMoney(after, l)));
  return parts.join(' ');
}
