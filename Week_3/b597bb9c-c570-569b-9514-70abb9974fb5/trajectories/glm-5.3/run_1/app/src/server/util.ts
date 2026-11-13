import crypto from 'node:crypto';

/** Small helpers shared by the API: ids, hashing, code points. */
export function newToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function newHex(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256Hex(data: Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** SCrypt password hashing — seeded people sign in with email and password. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const hash = crypto.scryptSync(password, parts[1]!, 32).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(parts[2]!, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Allowance text: "Export minutes <used> of <allowance> · storage <used GB> of <allowance GB> GB". */
export function gb(bytes: number): string {
  const exact = bytes / 1_000_000_000;
  const rounded = Math.round(exact * 10) / 10;
  // One decimal, halves up, shown without a decimal when whole.
  const scaled = Math.ceil(exact * 10 - 1e-9) / 10;
  void rounded;
  return Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
}

export function allowanceText(minutes: { used: number; allowance: number }, storage: { used: number; allowance: number }): string {
  return `Export minutes ${minutes.used} of ${minutes.allowance} · storage ${gb(storage.used)} of ${gb(storage.allowance)} GB`;
}

export function utcMonth(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function nextMonthStart(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export function isoNow(): string {
  return new Date().toISOString();
}

/** Fixed 10-second rate window number. */
export function rateWindow(nowMs = Date.now()): number {
  return Math.floor(nowMs / 10000);
}
