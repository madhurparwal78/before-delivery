import { checkoutCopy } from '../../shared/copy.js';
import { billingDate } from '../../shared/time.js';

/** How a test card answers charges. There is no card network. */
export type CardBehaviour = 'approve' | 'decline' | 'first_only';

export interface StoredCard {
  brand: string;
  last4: string;
  expiryMonth: number;
  expiryYear: number;
  behaviour: CardBehaviour;
  charges: number;
}

const TEST_CARDS: Readonly<Record<string, CardBehaviour>> = {
  '4242424242424242': 'approve',
  '4000000000000002': 'decline',
  '4000000000000341': 'first_only',
};

function luhnPasses(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function brandOf(digits: string): string {
  if (digits.startsWith('4')) return 'Visa';
  if (/^5[1-5]/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'American Express';
  return 'Card';
}

export type CardValidation =
  | { ok: true; card: StoredCard }
  | { ok: false; fields: Record<string, string> };

/**
 * Checks a card the way the shop does: Luhn, an expiry no earlier than the
 * current month in America/Toronto, and a three-digit security code. Only the
 * brand, last four digits, expiry and charging behaviour are ever kept.
 */
export function validateCard(input: unknown, now: Date): CardValidation {
  const fields: Record<string, string> = {};
  const card = (input ?? {}) as Record<string, unknown>;

  const rawNumber = typeof card.number === 'string' ? card.number.replace(/ /g, '') : '';
  const numberValid = /^\d{13,19}$/.test(rawNumber) && luhnPasses(rawNumber);
  if (!numberValid) fields.card_number = checkoutCopy.fields.cardNumber;

  const month = card.expiry_month;
  const year = card.expiry_year;
  const monthValid = typeof month === 'number' && Number.isInteger(month) && month >= 1 && month <= 12;
  const yearValid = typeof year === 'number' && Number.isInteger(year) && year >= 1000 && year <= 9999;
  let expiryValid = monthValid && yearValid;
  if (expiryValid) {
    const [currentYear, currentMonth] = billingDate(now).split('-').map(Number);
    expiryValid =
      (year as number) > currentYear! ||
      ((year as number) === currentYear! && (month as number) >= currentMonth!);
  }
  if (!expiryValid) fields.card_expiry = checkoutCopy.fields.expiry;

  const cvcValid = typeof card.cvc === 'string' && /^\d{3}$/.test(card.cvc);
  if (!cvcValid) fields.card_cvc = checkoutCopy.fields.cvc;

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    card: {
      brand: brandOf(rawNumber),
      last4: rawNumber.slice(-4),
      expiryMonth: month as number,
      expiryYear: year as number,
      behaviour: TEST_CARDS[rawNumber] ?? 'approve',
      charges: 0,
    },
  };
}

/** The published test cards decide every charge. */
export function chargeApproved(card: {
  card_behaviour: CardBehaviour;
  card_charges: number;
}): boolean {
  switch (card.card_behaviour) {
    case 'approve':
      return true;
    case 'decline':
      return false;
    case 'first_only':
      return card.card_charges === 0;
  }
}
