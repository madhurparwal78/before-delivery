// Step-up codes: the same answer for every email, a rolling request window, lock-out after five misses.
import { randomInt } from 'node:crypto';
import { email, object, oneOf, read, text } from './body.js';
import { config } from './config.js';
import { nextNumber, pool, tx } from './db.js';
import { stepupCodeNotice } from './emails.js';
import { ApiError, invalid } from './errors.js';
import { endSession, route, startSession } from './http.js';
import { drain, enqueue } from './outbox.js';

const CODE_LOCK = 7340100;
const MISSES_BEFORE_LOCK = 4;

const codeBody = object({
  email: email(),
  purpose: oneOf(['checkout', 'sign_in'] as const, (m) => m.fields.purpose),
});

route('POST', '/api/auth/code', async (ctx) => {
  const { email: address } = read(codeBody, ctx.body, ctx.m);
  const windowStart = new Date(ctx.now.getTime() - config.stepup.rateWindowSeconds * 1000);
  const limited = await tx(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [CODE_LOCK, address]);
    const recent = await db.query<{ created_at: Date }>(
      'SELECT created_at FROM stepup_codes WHERE email = $1 AND created_at > $2 ORDER BY created_at',
      [address, windowStart],
    );
    if (recent.rows.length >= config.stepup.rateLimit) {
      const oldest = recent.rows[0]?.created_at as Date;
      const leaves = oldest.getTime() + config.stepup.rateWindowSeconds * 1000 - ctx.now.getTime();
      return Math.max(1, Math.ceil(leaves / 1000));
    }
    const number = await nextNumber(db, 'SC');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expires = new Date(ctx.now.getTime() + config.stepup.codeTtlSeconds * 1000);
    await db.query('INSERT INTO stepup_codes (number, email, code, created_at, expires_at) VALUES ($1,$2,$3,$4,$5)', [
      number,
      address,
      code,
      ctx.now,
      expires,
    ]);
    const lock = (await db.query<{ locked_until: Date | null }>('SELECT locked_until FROM stepup_failures WHERE email = $1', [address])).rows[0];
    if (!(lock?.locked_until && lock.locked_until > ctx.now)) {
      await enqueue(db, stepupCodeNotice(number, address, ctx.locale, code, expires), ctx.now);
    }
    return 0;
  });
  if (limited) throw new ApiError(429, 'rate_limited', ctx.m.rateCopy, undefined, { 'Retry-After': String(limited) });
  void drain();
  return { status: 202, body: { status: 'sent' } };
});

const verifyBody = object({ email: email(), code: text((m) => m.fields.code, 1, 20) });

route('POST', '/api/auth/verify', async (ctx) => {
  const raw = ctx.body as { email?: unknown } | null | undefined;
  const lockedOut = new ApiError(429, 'stepup_locked', ctx.m.lockedCopy);
  const candidate = typeof raw?.email === 'string' ? raw.email.trim().toLowerCase() : null;
  const customerId = await tx(async (db) => {
    if (candidate) {
      await db.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [CODE_LOCK, candidate]);
      const state = (await db.query<{ failures: number; locked_until: Date | null }>('SELECT failures, locked_until FROM stepup_failures WHERE email = $1',
        [candidate],
      )).rows[0];
      if (state?.locked_until && state.locked_until > ctx.now) throw lockedOut;
      if (state?.locked_until) await db.query('DELETE FROM stepup_failures WHERE email = $1', [candidate]);
    }
    const body = read(verifyBody, ctx.body, ctx.m);
    const match = (await db.query<{ number: string }>('SELECT number FROM stepup_codes WHERE email = $1 AND code = $2 AND used_at IS NULL AND expires_at > $3',
      [body.email, body.code, ctx.now],
    )).rows[0];
    if (!match) {
      const misses = (await db.query<{ failures: number }>(`INSERT INTO stepup_failures (email, failures) VALUES ($1, 1)
         ON CONFLICT (email) DO UPDATE SET failures = stepup_failures.failures + 1 RETURNING failures`,
        [body.email],
      )).rows[0];
      if ((misses?.failures ?? 0) > MISSES_BEFORE_LOCK) {
        await db.query('UPDATE stepup_failures SET locked_until = $2 WHERE email = $1', [
          body.email,
          new Date(ctx.now.getTime() + config.stepup.lockSeconds * 1000),
        ]);
        return 'locked' as const;
      }
      return 'wrong' as const;
    }
    await db.query('UPDATE stepup_codes SET used_at = $2 WHERE email = $1 AND used_at IS NULL', [body.email, ctx.now]);
    await db.query('DELETE FROM stepup_failures WHERE email = $1', [body.email]);
    const customer = (await db.query<{ id: number }>(`INSERT INTO customers (email, locale) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET locale = EXCLUDED.locale RETURNING id`,
      [body.email, ctx.locale],
    )).rows[0];
    return customer?.id as number;
  });
  if (customerId === 'locked') throw lockedOut;
  if (customerId === 'wrong') throw invalid(ctx.m, { code: ctx.m.fields.code });
  startSession(ctx, 'customer', customerId);
  const email = ((await pool.query<{ email: string }>('SELECT email FROM customers WHERE id = $1', [customerId])).rows[0])?.email;
  return { status: 200, body: { customer: { email, locale: ctx.locale } } };
});

route('POST', '/api/auth/sign-out', async (ctx) => {
  read(object({}), ctx.body, ctx.m);
  endSession(ctx, 'customer');
  return { status: 204 };
});
