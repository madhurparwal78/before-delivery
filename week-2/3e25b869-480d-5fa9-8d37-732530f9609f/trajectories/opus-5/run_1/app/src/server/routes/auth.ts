import { randomInt } from 'node:crypto';
import { FIELD_MESSAGES, LOCKOUT_MESSAGE, RATE_LIMIT_MESSAGE } from '../../shared/copy.js';
import { config } from '../config.js';
import { LIMITS } from '../config.js';
import { takeNumber } from '../db/numbers.js';
import { db, withTransaction } from '../db/pool.js';
import { stepUpCodeMail } from '../email/templates.js';
import { isValidEmail, parseBody, readEmail, readLiteral, type Reader } from '../http/body.js';
import { COOKIE, type ApiResponse, type RequestContext } from '../http/context.js';
import { sealSession } from '../http/cookies.js';
import { errors } from '../http/errors.js';
import { enqueueNotice, wakeOutbox } from '../services/outbox.js';

const CODE_SHAPE = {
  email: readEmail,
  purpose: readLiteral(['checkout', 'sign_in'] as const, FIELD_MESSAGES.purpose),
} as const;

const readSixDigitCode: Reader<string> = (raw, path, report) => {
  if (typeof raw !== 'string' || !/^\d{6}$/.test(raw)) {
    report(path, FIELD_MESSAGES.code);
    return '';
  }
  return raw;
};

const VERIFY_SHAPE = { email: readEmail, code: readSixDigitCode } as const;

function sixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function peekEmail(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const raw = (body as Record<string, unknown>)['email'];
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return isValidEmail(email) ? email : null;
}

async function lockedUntil(email: string): Promise<Date | null> {
  const result = await db.query<{ locked_until: Date | null }>(
    'SELECT locked_until FROM stepup_lockouts WHERE email = $1',
    [email],
  );
  const until = result.rows[0]?.locked_until ?? null;
  if (until && until.getTime() > Date.now()) return until;
  return null;
}

export async function requestCode(ctx: RequestContext): Promise<ApiResponse> {
  const parsed = parseBody(ctx.body, CODE_SHAPE);
  if (!parsed.ok) throw errors.invalid(parsed.fields);
  const email = parsed.value.email;
  const now = new Date();
  const windowStart = new Date(now.getTime() - config.stepupRateWindowSeconds * 1_000);

  const decision = await withTransaction(async (client) => {
    const counted = await client.query<{ at: Date }>(
      `SELECT at FROM stepup_requests WHERE email = $1 AND at > $2 ORDER BY at ASC FOR UPDATE`,
      [email, windowStart],
    );
    if (counted.rows.length >= config.stepupRateLimit) {
      const oldest = counted.rows[0];
      const leavesAt = (oldest?.at.getTime() ?? now.getTime()) + config.stepupRateWindowSeconds * 1_000;
      const seconds = Math.max(1, Math.ceil((leavesAt - now.getTime()) / 1_000));
      return { kind: 'rate_limited', seconds } as const;
    }
    await client.query('INSERT INTO stepup_requests (email, at) VALUES ($1, $2)', [email, now]);
    const number = await takeNumber(client, 'stepup');
    const code = sixDigitCode();
    const expiresAt = new Date(now.getTime() + config.stepupCodeTtlSeconds * 1_000);
    await client.query(
      `INSERT INTO stepup_codes (number, email, code, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [number, email, code, now, expiresAt],
    );
    const locked = await client.query<{ locked_until: Date | null }>(
      'SELECT locked_until FROM stepup_lockouts WHERE email = $1',
      [email],
    );
    const until = locked.rows[0]?.locked_until ?? null;
    if (until && until.getTime() > now.getTime()) return { kind: 'issued_locked' } as const;
    const mail = stepUpCodeMail(code, expiresAt, ctx.locale);
    await enqueueNotice(client, {
      key: `code.${number}`,
      kind: 'stepup_code',
      recipient: email,
      locale: ctx.locale,
      subject: mail.subject,
      body: mail.body,
    });
    return { kind: 'issued' } as const;
  });

  if (decision.kind === 'rate_limited') {
    throw errors.rateLimited(decision.seconds, RATE_LIMIT_MESSAGE);
  }
  if (decision.kind === 'issued') wakeOutbox();
  return { status: 202, body: { status: 'sent' } };
}

export async function verifyCode(ctx: RequestContext): Promise<ApiResponse> {
  const peeked = peekEmail(ctx.body);
  if (peeked && (await lockedUntil(peeked))) throw errors.stepupLocked(LOCKOUT_MESSAGE);

  const parsed = parseBody(ctx.body, VERIFY_SHAPE);
  if (!parsed.ok) throw errors.invalid(parsed.fields);
  const { email, code } = parsed.value;
  const now = new Date();
  const outcome = await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO stepup_lockouts (email, failures) VALUES ($1, 0) ON CONFLICT (email) DO NOTHING`,
      [email],
    );
    const lock = await client.query<{ failures: number; locked_until: Date | null }>(
      'SELECT failures, locked_until FROM stepup_lockouts WHERE email = $1 FOR UPDATE',
      [email],
    );
    const state = lock.rows[0];
    if (state?.locked_until && state.locked_until.getTime() > now.getTime()) {
      return { kind: 'locked' } as const;
    }
    const match = await client.query<{ number: string }>(
      `SELECT number FROM stepup_codes
        WHERE email = $1 AND code = $2 AND ended_at IS NULL AND expires_at > $3
        ORDER BY issued_at DESC LIMIT 1`,
      [email, code, now],
    );
    if (match.rowCount === 0) {
      const failures = (state?.failures ?? 0) + 1;
      if (failures >= LIMITS.stepupMaxFailures) {
        await client.query(
          'UPDATE stepup_lockouts SET failures = $2, locked_until = $3 WHERE email = $1',
          [email, failures, new Date(now.getTime() + config.stepupLockSeconds * 1_000)],
        );
        return { kind: 'locked' } as const;
      }
      await client.query('UPDATE stepup_lockouts SET failures = $2 WHERE email = $1', [
        email,
        failures,
      ]);
      return { kind: 'wrong' } as const;
    }
    await client.query('UPDATE stepup_codes SET ended_at = $2 WHERE email = $1 AND ended_at IS NULL', [
      email,
      now,
    ]);
    await client.query(
      'UPDATE stepup_lockouts SET failures = 0, locked_until = NULL WHERE email = $1',
      [email],
    );
    const customer = await client.query<{ id: string; locale: string }>(
      `INSERT INTO customers (email, locale) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET locale = EXCLUDED.locale
       RETURNING id, locale`,
      [email, ctx.locale],
    );
    const row = customer.rows[0];
    if (!row) throw new Error('customer not recorded');
    return { kind: 'verified', locale: row.locale } as const;
  });

  if (outcome.kind === 'locked') throw errors.stepupLocked(LOCKOUT_MESSAGE);
  if (outcome.kind === 'wrong') throw errors.invalid({ code: FIELD_MESSAGES.code });
  ctx.setSessionCookie(COOKIE.session, sealSession({ email }));
  return { status: 200, body: { customer: { email, locale: outcome.locale } } };
}

export async function signOut(ctx: RequestContext): Promise<ApiResponse> {
  ctx.clearCookie(COOKIE.session);
  return { status: 204 };
}
