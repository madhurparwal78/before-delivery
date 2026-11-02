export type CardBehaviour = 'approve' | 'decline' | 'one_shot';

export interface StoredCard {
  brand: string;
  last4: string;
  behaviour: CardBehaviour;
  used: boolean;
  expiry_month: number;
  expiry_year: number;
}

export interface CardInput {
  number: string;
  expiry_month: number;
  expiry_year: number;
  cvc: string;
}

export function luhnValid(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export function brandOf(digits: string): string {
  if (digits.startsWith('4')) return 'Visa';
  if (/^5[1-5]/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'American Express';
  if (digits.startsWith('6')) return 'Discover';
  return 'Card';
}

export function behaviourOf(digits: string): CardBehaviour {
  if (digits === '4000000000000341') return 'one_shot';
  if (digits === '4000000000000002') return 'decline';
  return 'approve';
}

/** Decides a charge against the stored card rules. Returns true when the charge is approved. */
export function chargeApproved(card: StoredCard): boolean {
  if (card.behaviour === 'approve') return true;
  if (card.behaviour === 'decline') return false;
  return !card.used;
}

export function markCardUsed(card: StoredCard): void {
  if (card.behaviour === 'one_shot') card.used = true;
}

export function toStoredCard(input: CardInput): StoredCard {
  const digits = input.number.replace(/\s+/g, '');
  return {
    brand: brandOf(digits),
    last4: digits.slice(-4),
    behaviour: behaviourOf(digits),
    used: false,
    expiry_month: input.expiry_month,
    expiry_year: input.expiry_year,
  };
}

/** Expiry must not be before the current month in America/Toronto. */
export function expiryValid(month: number, year: number, torontoNow: Date): boolean {
  const expiryEnd = new Date(Date.UTC(year, month, 1));
  const now = new Date(Date.UTC(torontoNow.getUTCFullYear(), torontoNow.getUTCMonth() + 1, 1));
  return expiryEnd >= now;
}
