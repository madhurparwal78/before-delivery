/**
 * The published Airfold sealing scheme. Shared by the browser (which seals and
 * opens) and the exchange (which validates shapes). This is the one place the
 * padding and sealing scheme is decided.
 */

export const PAD_BLOCK = 160;
export const GCM_TAG_BYTES = 16;
export const IV_BYTES = 12;
export const MAX_LETTER_CHARS = 8000;
export const MAX_CIPHERTEXT_BYTES = 64016;

export const HKDF_MESSAGE_INFO = 'airfold/v1/msg';
export const RECOVERY_SALT = 'airfold/v1/recovery';
export const RECOVERY_VERIFIER_INFO = 'airfold/v1/recovery-verifier';
export const RECOVERY_BACKUP_INFO = 'airfold/v1/key-backup';
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_CODE_BYTES = 20;
export const PUBLIC_KEY_BYTES = 65;
export const KEY_ID_BYTES = 12;
export const PROFILE_KEY_BYTES = 32;

/** Padded body length: always grows, so a multiple of the block pads to the next one. */
export function paddedLength(bodyLength: number): number {
  return (Math.floor(bodyLength / PAD_BLOCK) + 1) * PAD_BLOCK;
}

/** Appends one 0x80 byte then 0x00 bytes up to the next multiple of the block. */
export function pad(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(paddedLength(body.length));
  out.set(body, 0);
  out[body.length] = 0x80;
  return out;
}

export function unpad(padded: Uint8Array): Uint8Array {
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0x00) end -= 1;
  if (end === 0 || padded[end - 1] !== 0x80) throw new Error('bad padding');
  return padded.subarray(0, end - 1);
}

/** A sealed body is padded plaintext plus the GCM tag. */
export function isValidCiphertextLength(length: number): boolean {
  return (
    length >= PAD_BLOCK + GCM_TAG_BYTES &&
    length <= MAX_CIPHERTEXT_BYTES &&
    (length - GCM_TAG_BYTES) % PAD_BLOCK === 0
  );
}

export function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

export function isBase64url(value: unknown): value is string {
  // A base64 length of one more than a multiple of four cannot decode.
  return typeof value === 'string' && BASE64URL_RE.test(value) && value.length % 4 !== 1;
}
