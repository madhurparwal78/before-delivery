import { Hold } from './types';

/** A hold's label comes only from the server's status and release reason. */
export function holdLabel(hold: Hold): string {
  switch (hold.status) {
    case 'pending-payment':
      return 'Pending';
    case 'held':
      return 'Held';
    case 'converted-to-sale':
      return 'Bought';
    default:
      return hold.release_reason === 'expired' ? 'Expired' : 'Released';
  }
}

export const HOLD_COPY = {
  waiting: 'Waiting for billing to confirm your deposit',
  held: 'Board held. Deposit paid.',
  declined: 'Your card was declined. The board is still available.',
  paymentFailed: 'Billing did not confirm the payment. You were not charged.',
  alreadyHeldHeading: 'Already held by another maker',
  alreadyHeldText: 'Someone held this board a moment before you. Your card was not charged.',
  billingHold: 'Billing is offline. Your card was not charged.',
  billingPurchase: 'Billing is offline. Your hold is safe and nothing was charged.',
  billingCancel: 'Billing is offline. Your hold is unchanged.',
  paused: 'Paused while billing is offline.',
  released: 'Hold released. Deposit refunded.',
  notActive: 'This hold is no longer active.',
  expired: 'Hold expired. The deposit was kept.',
  storage: "Cut tickets can't be saved right now. Your hold is safe and nothing was charged.",
  generic: 'Something went wrong. Try again.'
} as const;

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The card number check the dialog runs before it sends anything. */
export function cardNumberLooksValid(raw: string): boolean {
  const digits = raw.replace(/ /g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let at = digits.length - 1; at >= 0; at -= 1) {
    let value = Number(digits[at]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}
