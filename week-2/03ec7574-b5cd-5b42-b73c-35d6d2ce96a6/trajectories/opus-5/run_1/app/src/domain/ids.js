import { randomBytes, randomUUID } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomSuffix(length) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function newId(prefix) {
  return `${prefix}${randomSuffix(20)}`;
}

export function newWebhookSecret() {
  return `whsec_${randomBytes(16).toString('hex')}`;
}

export function newApiKeySecret() {
  return `cvo_${randomBytes(20).toString('hex')}`;
}

export function newToken() {
  return randomBytes(32).toString('hex');
}

export function requestId() {
  return randomUUID();
}
