import { FIELD_COPY } from '../../shared/errors.js';
import { fail, validation } from '../http/app-error.js';

export type Card = { number: string; expiry: string; cvc: string; name: string };

const APPROVING = '4242424242424242';
const DECLINING = '4000000000000002';

const digitsOf = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/ /g, '') : '';

/**
 * Validates the studio's test cards, then judges the decline. Card details are never
 * stored and never reach Kill Bill.
 */
export const checkCard = (input: unknown): void => {
  const card = (input ?? {}) as Partial<Record<keyof Card, unknown>>;
  const fields: Record<string, string> = {};

  const number = digitsOf(card.number);
  if (number !== APPROVING && number !== DECLINING) fields['card.number'] = FIELD_COPY.card_number;

  const expiry = typeof card.expiry === 'string' ? card.expiry.trim() : '';
  const expiryMatch = /^(\d{2})\/(\d{2})$/.exec(expiry);
  if (expiryMatch === null) {
    fields['card.expiry'] = FIELD_COPY.card_expiry;
  } else {
    const month = Number.parseInt(expiryMatch[1], 10);
    const year = 2000 + Number.parseInt(expiryMatch[2], 10);
    const now = new Date();
    const currentMonths = now.getUTCFullYear() * 12 + now.getUTCMonth();
    if (month < 1 || month > 12 || year * 12 + (month - 1) < currentMonths)
      fields['card.expiry'] = FIELD_COPY.card_expiry;
  }

  if (!/^\d{3}$/.test(typeof card.cvc === 'string' ? card.cvc : ''))
    fields['card.cvc'] = FIELD_COPY.card_cvc;

  if (typeof card.name !== 'string' || card.name.trim() === '')
    fields['card.name'] = FIELD_COPY.card_name;

  if (Object.keys(fields).length > 0) validation(fields);
  if (number === DECLINING) fail('card_declined');
};
