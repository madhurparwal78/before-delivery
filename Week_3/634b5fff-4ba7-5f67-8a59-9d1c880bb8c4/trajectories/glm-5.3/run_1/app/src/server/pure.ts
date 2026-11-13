import { createHmac, timingSafeEqual } from 'node:crypto';

/** The banking-day deadline: 23:59:59 Copenhagen on the third banking day
 * after the order. Banking days skip weekends and the published holidays. */
const HOLIDAYS = new Set(['12-24', '12-25', '12-26', '12-31', '01-01']);

export function bankingDeadline(from: Date): Date {
  const fmt = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  let remaining = 3;
  const day = new Date(from);
  day.setUTCDate(day.getUTCDate() + 1);
  while (remaining > 0) {
    const dow = day.getUTCDay();
    if (dow !== 0 && dow !== 6 && !HOLIDAYS.has(fmt(day))) remaining -= 1;
    if (remaining > 0) day.setUTCDate(day.getUTCDate() + 1);
  }
  // 23:59:59 Europe/Copenhagen on that day. Copenhagen is UTC+1 on these
  // winter dates (no DST applies), so the instant is 22:59:59Z.
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 22, 59, 59, 999));
}

/** Gateway callback signatures: HMAC-SHA256 over `<t>.<raw body>`. Timestamps
 * more than 300 seconds from the server's real time, either direction, are
 * stale. */
export function verifySignature(raw: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(header);
  if (!m) return false;
  const t = Number(m[1]);
  const now = Date.now() / 1000;
  if (Math.abs(now - t) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(m[2], 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
