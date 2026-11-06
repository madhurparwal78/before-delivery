import * as crypto from 'node:crypto';

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function randomTwoStepSecret(): string {
  const bytes = crypto.randomBytes(32);
  return Array.from(bytes, (byte) => base32Alphabet[byte % 32]).join('');
}

function base32Decode(secret: string): Buffer {
  const cleaned = secret.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of cleaned) {
    const index = base32Alphabet.indexOf(character);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function currentStep(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / 30);
}

export function codeForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1000000).padStart(6, '0');
}

/** Returns the step a code belongs to within the T-1..T+1 window, or null. */
export function matchStep(secret: string, code: string, atMs: number = Date.now()): number | null {
  const trimmed = code.trim();
  if (!/^[0-9]{6}$/.test(trimmed)) return null;
  const now = currentStep(atMs);
  for (const step of [now, now - 1, now + 1]) {
    if (crypto.timingSafeEqual(Buffer.from(codeForStep(secret, step)), Buffer.from(trimmed))) return step;
  }
  return null;
}

export function otpauthUri(email: string, secret: string): string {
  return `otpauth://totp/Farshore:${encodeURIComponent(email)}?secret=${secret}&issuer=Farshore&algorithm=SHA1&digits=6&period=30`;
}

const recoveryAlphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const bytes = crypto.randomBytes(10);
    const text = Array.from(bytes, (byte) => recoveryAlphabet[byte % 36]).join('');
    return `${text.slice(0, 5)}-${text.slice(5)}`;
  });
}

export function normaliseRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/-/g, '');
}
