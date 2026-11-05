import { randomBytes, randomInt } from 'node:crypto';

const LOWER_ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const UPPER_ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function pick(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** `up_` plus 12 letters and digits. */
export function newUploadRef(): string {
  return `up_${pick(LOWER_ALNUM, 12)}`;
}

/** `TS-` plus 8 capital letters and digits. */
export function newOrderRef(): string {
  return `TS-${pick(UPPER_ALNUM, 8)}`;
}

/** `k_` plus 8 letters and digits. */
export function newKeyRef(): string {
  return `k_${pick(LOWER_ALNUM, 8)}`;
}

/** `ts_` plus 12 letters and digits. */
export function newTextureSetRef(): string {
  return `ts_${pick(LOWER_ALNUM, 12)}`;
}

/** Receipt, share and embed tokens: at least 32 URL-safe random characters. */
export function newToken(prefix: string): string {
  return `${prefix}${randomBytes(27).toString('base64url')}`;
}

/** The read API key the author copies once. */
export function newReadKey(): string {
  return `tsr_${randomBytes(18).toString('hex')}`;
}

export const ORDER_REF_RE = /^TS-[A-Z0-9]{8}$/;
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
