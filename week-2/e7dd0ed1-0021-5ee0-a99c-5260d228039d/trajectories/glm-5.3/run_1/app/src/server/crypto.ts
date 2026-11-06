import {
  createHash, createHmac, createCipheriv, createDecipheriv, hkdfSync,
  randomBytes, scryptSync, timingSafeEqual,
} from 'node:crypto';

const SALT = Buffer.from('farshore-salt');

/** Seals a string under the server's secret key: 12-byte nonce + AES-256-GCM (tag appended). */
export function seal(secretKey: Buffer, plain: string): string {
  const nonce = randomBytes(12);
  const key = derivedKey(secretKey, 'seal');
  const c = createCipheriv('aes-256-gcm', key, nonce);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([nonce, c.getAuthTag(), enc]).toString('base64');
}

/** Unseals a value sealed by seal(); returns null if it fails. */
export function unseal(secretKey: Buffer, sealed: string): string | null {
  try {
    const buf = Buffer.from(sealed, 'base64');
    const nonce = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const key = derivedKey(secretKey, 'seal');
    const d = createDecipheriv('aes-256-gcm', key, nonce);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch { return null; }
}

/** Encrypts bytes under a 32-byte data key: [12B nonce | ciphertext | 16B tag]. */
export function encryptBytes(dataKey: Buffer, plain: Buffer): Buffer {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dataKey, nonce);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([nonce, enc, c.getAuthTag()]);
}

/** Decrypts bytes encrypted by encryptBytes(); returns null if it fails. */
export function decryptBytes(dataKey: Buffer, sealed: Buffer): Buffer | null {
  try {
    const nonce = sealed.subarray(0, 12);
    const data = sealed.subarray(12, sealed.length - 16);
    const tag = sealed.subarray(sealed.length - 16);
    const d = createDecipheriv('aes-256-gcm', dataKey, nonce);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]);
  } catch { return null; }
}

/** The workspace key of generation g: HKDF-SHA256 over the server key. Never stored. */
export function workspaceKey(secretKey: Buffer, slug: string, g: number): Buffer {
  const info = Buffer.from(`farshore-workspace-key:${slug}:${g}`, 'utf8');
  return Buffer.from(hkdfSync('sha256', secretKey, SALT, info, 32));
}

/** Wraps a data key under a workspace key. */
export function wrapDataKey(wk: Buffer, dataKey: Buffer): string {
  return encryptBytes(wk, dataKey).toString('base64');
}

/** Unwraps a data key; returns null if it fails. */
export function unwrapDataKey(wk: Buffer, wrapped: string): Buffer | null {
  return decryptBytes(wk, Buffer.from(wrapped, 'base64'));
}

function derivedKey(secretKey: Buffer, purpose: string): Buffer {
  const info = Buffer.from(`farshore:${purpose}`, 'utf8');
  return Buffer.from(hkdfSync('sha256', secretKey, SALT, info, 32));
}

/** Session-token derivation: only the verifier is stored. */
export function sessionTokenVerifier(token: string): string {
  return createHash('sha256').update('farshore-session:' + token).digest('hex');
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function md5Hex(data: Buffer | string): string {
  return createHash('md5').update(data).digest('hex');
}

export function hmacSha256Hex(key: Buffer | string, data: Buffer | string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

export function hmacSha256(key: Buffer | string, data: Buffer | string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** scrypt password hash, formatted as scrypt$N$salt$hash. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'base64');
    const hash = Buffer.from(parts[2], 'base64');
    const got = scryptSync(password, salt, hash.length, { N: 16384, r: 8, p: 1 });
    return timingSafeEqual(got, hash);
  } catch { return false; }
}

export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

/** The 256-bit share-link token as 43 URL-safe characters. */
export function shareToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 43-char base64url string, used for webhook signing secrets. */
export function signingSecret(): string {
  return 'whsec_' + randomBytes(32).toString('base64url');
}

export function opaqueId(prefix: string, bytes = 12): string {
  return prefix + randomBytes(bytes).toString('base64url');
}

export function versionId(): string { return opaqueId('v', 16); }

/** FSK + 17 uppercase alphanumerics = 20 chars. */
export function accessKeyId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  const buf = randomBytes(17);
  for (let i = 0; i < 17; i++) out += alphabet[buf[i] % alphabet.length];
  return 'FSK' + out;
}

/** 40 random letters and digits. */
export function accessKeySecret(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const buf = randomBytes(40);
  for (let i = 0; i < 40; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

/** Ten recovery codes of the form xxxxx-xxxxx. */
export function recoveryCodes(): string[] {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const out: string[] = [];
  for (let n = 0; n < 10; n++) {
    const buf = randomBytes(10);
    let s = '';
    for (let i = 0; i < 10; i++) {
      if (i === 5) s += '-';
      s += alphabet[buf[i] % alphabet.length];
    }
    out.push(s);
  }
  return out;
}

/** 32-char TOTP secret from the RFC 4238 base32 alphabet (A-Z, 2-7). */
export function totpSecret(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const buf = randomBytes(32);
  let s = '';
  for (let i = 0; i < 32; i++) s += alphabet[buf[i] % 32];
  return s;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(secret: string): Buffer {
  let bits = '';
  for (const ch of secret.toUpperCase()) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP, 6 digits, 30-second step, HMAC-SHA1. */
export function totpAt(secret: string, step: number): string {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', key).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const bin = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/** Current TOTP step on the server clock. */
export function currentStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / 30);
}
