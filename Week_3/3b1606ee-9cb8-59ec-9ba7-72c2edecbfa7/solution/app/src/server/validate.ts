import { createECDH } from 'node:crypto';
import { GCM_TAG, IV_BYTES, MAX_CIPHERTEXT, PAD_BLOCK } from '../shared/sealing.js';
import { invalid } from './http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The JSON object in a request body; an empty body is `{}`. Anything else is a 422. */
export function jsonBody(body: Buffer): Record<string, unknown> {
  if (body.length === 0) return {};
  try {
    return asRecord(JSON.parse(body.toString('utf8')));
  } catch {
    throw invalid({ body: 'invalid' });
  }
}

/** Strict base64url (URL-safe alphabet, no padding, canonical). Null when it is not. */
export function decodeBase64url(value: unknown): Buffer | null {
  if (typeof value !== 'string' || !BASE64URL.test(value) || value.length % 4 === 1) return null;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.toString('base64url') === value ? bytes : null;
}

export function encodeBase64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

export function validIv(value: unknown): Buffer | null {
  const bytes = decodeBase64url(value);
  return bytes && bytes.length === IV_BYTES ? bytes : null;
}

/** A sealed body: a positive multiple of 160 bytes plus the 16-byte tag, at most 64,016 bytes. */
export function validCiphertext(value: unknown): Buffer | null {
  const bytes = decodeBase64url(value);
  if (!bytes || bytes.length < PAD_BLOCK + GCM_TAG || bytes.length > MAX_CIPHERTEXT) return null;
  return bytes.length % PAD_BLOCK === GCM_TAG ? bytes : null;
}

/** A raw uncompressed P-256 point that lies on the curve. */
export function validPublicKey(value: unknown): Buffer | null {
  const bytes = decodeBase64url(value);
  if (!bytes || bytes.length !== 65 || bytes[0] !== 0x04) return null;
  const probe = createECDH('prime256v1');
  probe.generateKeys();
  try {
    probe.computeSecret(bytes);
    return bytes;
  } catch {
    return null;
  }
}
