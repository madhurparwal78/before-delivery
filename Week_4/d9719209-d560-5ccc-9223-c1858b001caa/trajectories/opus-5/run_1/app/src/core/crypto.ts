import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: randomBytes(16),
    parallelism: 1,
    iterations: 2,
    memorySize: 19456,
    hashLength: 32,
    outputType: 'encoded',
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}

/** RFC 4648 base32 without padding. */
export function base32Encode(bytes: Uint8Array): string {
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

export function base32Decode(secret: string): Buffer {
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of secret.toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) continue;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function otpauthUri(username: string, secret: string): string {
  return `otpauth://totp/Moothall:${encodeURIComponent(username)}?secret=${secret}&issuer=Moothall`;
}

function totpAt(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, '0');
}

/** RFC 6238: SHA-1, 6 digits, 30-second step, with the previous and next step accepted. */
export function totpMatches(secret: string, code: string, now = Date.now()): boolean {
  const counter = Math.floor(now / 1000 / 30);
  for (const step of [-1, 0, 1]) {
    const expected = totpAt(secret, counter + step);
    if (expected.length === code.length && timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return true;
  }
  return false;
}

const REFERENCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Report reference: "MH-" plus 8 characters from A-Z and 0-9. */
export function newReportReference(): string {
  const bytes = randomBytes(8);
  let suffix = '';
  for (const byte of bytes) suffix += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return `MH-${suffix}`;
}
