/* Shared small helpers: validation, tokens, TOTP (RFC 6238, SHA-1, 6 digits,
   30-second step), base32. The TOTP check lives here and nowhere else. */
import crypto from 'node:crypto';

export type AccountRow = {
  id: string;
  username: string;
  email: string;
  email_verified: boolean;
  totp_secret: string | null;
  totp_enabled: boolean;
  role: string;
  suspended: boolean;
  created_at: Date;
};

export function isEmail(s: string): boolean {
  const at = s.indexOf('@');
  if (at <= 0) return false;
  const domain = s.slice(at + 1);
  if (domain.includes('@')) return false;
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

export function isUsername(s: string): boolean {
  return /^[A-Za-z0-9_-]{3,20}$/.test(s);
}

export function isCommunityName(s: string): boolean {
  return /^[A-Za-z0-9_]{3,21}$/.test(s);
}

export function newToken(bytes: number): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function reference(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return `MH-${out}`;
}

/* RFC 6238 TOTP with SHA-1, 6 digits and a 30-second step. `skewSeconds`
   shifts the counter, so callers accept the previous and next step. */
export function totpNow(secretBase32: string, skewSeconds: number): string {
  const counter = Math.floor((Date.now() + skewSeconds) / 30000);
  return hotp(secretBase32, counter);
}

export function hotp(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = (hmac[hmac.length - 1] as number) & 0x0f;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}

export function base32Decode(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function base32Encode(buf: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

export function trimTo(s: unknown, max: number): string {
  return typeof s === 'string' ? s.slice(0, max) : '';
}

export function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
