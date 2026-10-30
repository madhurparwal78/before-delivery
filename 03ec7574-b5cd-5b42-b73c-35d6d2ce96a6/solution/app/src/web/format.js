import { formatAmount, iso } from '../lib/core.js';

// How amounts, times and addresses read on screen.
export const money = (raw, asset) => `${formatAmount(raw, asset)} ${asset.toUpperCase()}`;
export const when = (value) => (value ? iso(value).replace('T', ' ').replace(/:\d\dZ$/, ' UTC') : '');
export const short = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '');

export function hours(seconds) {
  const h = seconds / 3600;
  const text = Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${text} ${h === 1 ? 'hour' : 'hours'}`;
}

export const STATUS_LABELS = { pending_approval: 'Pending approval', executed: 'Executed', rejected: 'Rejected',
  cancelled: 'Cancelled', expired: 'Expired' };
