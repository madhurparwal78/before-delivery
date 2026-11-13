import { createHash, createPublicKey } from 'node:crypto';
import {
  base64urlDecode,
  base64urlEncode,
  isBase64url,
  KEY_ID_BYTES,
  PUBLIC_KEY_BYTES,
} from '../../shared/scheme.js';

const SPKI_P256_PREFIX = Buffer.from(
  '3059301306072a8648ce3d020106082a8648ce3d030107034200',
  'hex',
);

/** key_id is the first 12 bytes of SHA-256 of the raw public key, base64url. */
export function keyIdFor(publicKey: Uint8Array): string {
  const digest = createHash('sha256').update(publicKey).digest();
  return base64urlEncode(digest.subarray(0, KEY_ID_BYTES));
}

function isValidPublicKey(publicKey: Uint8Array): boolean {
  if (publicKey.length !== PUBLIC_KEY_BYTES || publicKey[0] !== 0x04) return false;
  try {
    createPublicKey({
      key: Buffer.concat([SPKI_P256_PREFIX, Buffer.from(publicKey)]),
      format: 'der',
      type: 'spki',
    });
    return true;
  } catch {
    return false;
  }
}

/** Decodes a base64url raw P-256 point, or null when it is not one. */
export function decodePublicKey(value: unknown): Uint8Array | null {
  if (!isBase64url(value)) return null;
  const bytes = base64urlDecode(value);
  return isValidPublicKey(bytes) ? bytes : null;
}
