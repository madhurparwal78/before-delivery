import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/** The callback token: lowercase hex HMAC-SHA256 of the API key, keyed with the API secret. */
export const callbackToken: string = createHmac('sha256', config.killbillApiSecret)
  .update(config.killbillApiKey, 'utf8')
  .digest('hex');

export function isValidCallbackToken(candidate: string | undefined): boolean {
  if (typeof candidate !== 'string') return false;
  const expected = Buffer.from(callbackToken, 'utf8');
  const given = Buffer.from(candidate, 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const callbackUrl = `${config.appPublicUrl}/api/billing/killbill-events?token=${callbackToken}`;
