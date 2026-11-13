import { queryOne } from '../db/index.js';

/** The three sandbox outcome classes. The server decides every card outcome. */
export type CardClass = 'declined' | 'single_use' | 'approved';

const ALWAYS_DECLINED = '4000000000000002';
const FIRST_CHARGE_ONLY = '4000000000000341';

export interface CardDetails {
  class: CardClass;
  last4: string;
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      const doubled = digit * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    } else {
      sum += digit;
    }
  }
  return sum % 10 === 0;
}

/** Reads a card number: 16 digits, spaces allowed, Luhn-checked. */
export function readCardNumber(input: unknown): CardDetails | null {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/ /g, '');
  if (!/^\d{16}$/.test(digits) || !passesLuhn(digits)) return null;
  const cardClass: CardClass =
    digits === ALWAYS_DECLINED ? 'declined' : digits === FIRST_CHARGE_ONLY ? 'single_use' : 'approved';
  return { class: cardClass, last4: digits.slice(-4) };
}

/**
 * Makes one charge attempt against the sandbox. Every attempt counts, approved or
 * declined; the `single_use` class is counted per person across every instance.
 */
export async function attemptCharge(userId: string, cardClass: CardClass): Promise<boolean> {
  if (cardClass === 'declined') return false;
  if (cardClass === 'approved') return true;
  const row = await queryOne<{ charges: number }>(
    `INSERT INTO card_charge_counts (user_id, card_class, charges) VALUES ($1, $2, 1)
     ON CONFLICT (user_id, card_class) DO UPDATE SET charges = card_charge_counts.charges + 1
     RETURNING charges`,
    [userId, cardClass],
  );
  return (row?.charges ?? 1) === 1;
}

export function isCardClass(value: string): value is CardClass {
  return value === 'declined' || value === 'single_use' || value === 'approved';
}
