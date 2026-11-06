import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';

function sign(payload, secret) {
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(payload, 'utf8').digest('base64url');
}

function payloadOf({ organizationId, status, walletId, createdAt, id }) {
  return [organizationId, status || '', walletId || '', new Date(createdAt).toISOString(), id].join('\u0000');
}

/** The cursor carries its filters and organization, so it only works on the list that issued it. */
export function encodeCursor(parts, secret) {
  const payload = payloadOf(parts);
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(payload, secret)}`;
}

export function decodeCursor(value, { organizationId, status, walletId }, secret) {
  const invalid = new ApiError('INVALID_CURSOR', { details: { field: 'cursor' } });
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) throw invalid;
  const payload = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = Buffer.from(sign(payload, secret), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid;
  const [cursorOrganization, cursorStatus, cursorWallet, createdAt, id] = payload.split('\u0000');
  if (cursorOrganization !== organizationId || cursorStatus !== (status || '') || cursorWallet !== (walletId || '')) throw invalid;
  if (!createdAt || !id) throw invalid;
  return { createdAt, id };
}
