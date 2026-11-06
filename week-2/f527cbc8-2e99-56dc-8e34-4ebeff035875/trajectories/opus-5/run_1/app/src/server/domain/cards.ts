import { ValidationError, fieldMessages } from '../errors.js';

/**
 * The in-app card gateway. It needs no network and decides by token alone. A
 * real-looking card number is refused and never stored or logged.
 */
export type WorkCode = 'trim' | 'front_reset' | 'full_reset' | 'front_new' | 'full_new';

export interface CardOutcome {
  approved: boolean;
  declineCode: string | null;
  last4: string;
}

const TEST_CARDS: Record<string, CardOutcome> = {
  tok_approve_4242: { approved: true, declineCode: null, last4: '4242' },
  tok_decline_0002: { approved: false, declineCode: 'do_not_honor', last4: '0002' },
  tok_funds_9995: { approved: false, declineCode: 'insufficient_funds', last4: '9995' },
};

export function isHardDecline(declineCode: string | null): boolean {
  return declineCode === 'do_not_honor';
}

/** Validates a submitted card token without ever letting a card number reach a row or a log. */
export function readCardToken(value: unknown, field = 'card_token'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError({ [field]: fieldMessages.required });
  }
  const token = value.trim();
  if (/\d{12,}/.test(token)) {
    throw new ValidationError({ [field]: fieldMessages.cardNumber });
  }
  if (TEST_CARDS[token] === undefined) {
    throw new ValidationError({ [field]: fieldMessages.unknownCard });
  }
  return token;
}

export function chargeCard(token: string): CardOutcome {
  const outcome = TEST_CARDS[token];
  if (outcome === undefined) throw new Error('card token was not validated');
  return outcome;
}

export function cardLast4(token: string): string {
  return chargeCard(token).last4;
}
