import { HttpError } from './util.js';

export interface CardInput {
  number: string;
  expiry: string;
  cvc: string;
}

export interface ValidCard {
  last4: string;
}

/** The one place that judges card fields. Declines are decided before billing is touched. */
export function validateCard(card: CardInput): ValidCard {
  const fields: Record<string, string> = {};
  const number = String(card.number ?? '').replace(/\s+/g, '');
  if (!/^\d{13,19}$/.test(number) || !luhnValid(number)) {
    fields['card.number'] = 'Enter a valid card number.';
  }
  const expiryMatch = /^(\d{2})\/(\d{2})$/.exec(String(card.expiry ?? ''));
  if (!expiryMatch) {
    fields['card.expiry'] = 'Enter the expiry as MM/YY.';
  } else {
    const month = Number(expiryMatch[1]);
    const year = 2000 + Number(expiryMatch[2]);
    const now = new Date();
    const expiryEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));
    if (month < 1 || month > 12 || expiryEnd < now) {
      fields['card.expiry'] = 'That expiry date has passed.';
    }
  }
  if (!/^\d{3}$/.test(String(card.cvc ?? ''))) {
    fields['card.cvc'] = 'Enter the three digits on the back of the card.';
  }
  if (Object.keys(fields).length > 0) {
    throw new HttpError(422, 'invalid_card', 'Check the card details.', fields);
  }
  return { last4: number.slice(-4) };
}

function luhnValid(number: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = number.length - 1; i >= 0; i--) {
    let digit = number.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export const DECLINING_LAST4 = '0002';

/** The simulated processor decision for a card, judged by its last four digits. */
export function cardDecision(last4: string): 'approve' | 'decline' {
  return last4 === DECLINING_LAST4 ? 'decline' : 'approve';
}

export function declineError(): HttpError {
  return new HttpError(402, 'card_declined', 'Your card was declined. Nothing was charged.');
}

export type PaymentKind = 'deposit' | 'balance' | 'care' | 'change' | 'renewal';

export function paymentKindLabel(kind: PaymentKind): string {
  switch (kind) {
    case 'deposit':
      return 'Deposit';
    case 'balance':
      return 'Launch balance';
    case 'care':
      return 'Care plan';
    case 'change':
      return 'Plan change';
    case 'renewal':
      return 'Renewal';
  }
}
