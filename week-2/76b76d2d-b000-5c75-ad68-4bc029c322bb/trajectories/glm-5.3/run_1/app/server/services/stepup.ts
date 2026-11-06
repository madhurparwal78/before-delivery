import { DateTime } from 'luxon';
import { query, withTransaction } from './database';
import type { Config } from '../config';
import type { OutboxService } from './outbox';
import { ApiError } from '../http/errors';
import type { Locale, StepupPurpose } from '../domain/model';
import { sixDigitCode } from '../domain/ids';
import { stepupCodeEmail, emailText, emailHtml } from '../mail/templates';
import { maskedEmail } from '../domain/i18n';
import { nextSequence } from './membership';
import { iso } from '../time';

interface ChallengeRow {
  id: string;
  account_id: number;
  purpose: string;
  code: string;
  expires_at: Date;
  attempts: number;
  created_at: Date;
}

const resendSpacingSeconds = 30;
const maxCodesPerWindow = 4;
const maxWrongAttempts = 5;

export interface StartOutcome {
  challenge: {
    id: string;
    expires_at: string;
    delivery: 'sent' | 'queued';
    masked_email: string;
  };
}

/**
 * The one step-up limit resolver: lockout first, then spacing, then the send
 * limit, each with the published Retry-After.
 */
export async function startStepup(
  deps: { cfg: Config; outbox: OutboxService },
  accountId: number,
  accountNumber: string,
  accountEmail: string,
  accountLocale: Locale,
  purpose: StepupPurpose,
): Promise<StartOutcome> {
  const { cfg } = deps;
  const lockout = await lockoutRemainingSeconds(cfg, accountId);
  if (lockout > 0) {
    throw new ApiError('stepup_locked', {
      params: { minutes: String(Math.ceil(lockout / 60)) },
      headers: { 'Retry-After': String(lockout) },
    });
  }
  const spacing = await resendSpacingRemaining(accountId);
  if (spacing > 0) {
    throw new ApiError('resend_too_soon', {
      params: { seconds: String(spacing) },
      headers: { 'Retry-After': String(spacing) },
    });
  }
  const sendLimit = await sendLimitRemaining(cfg, accountId);
  if (sendLimit > 0) {
    throw new ApiError('code_send_limit', {
      params: { minutes: String(Math.ceil(sendLimit / 60)) },
      headers: { 'Retry-After': String(sendLimit) },
    });
  }

  const code = sixDigitCode();
  const expiresAt = DateTime.now().plus({ seconds: cfg.stepupCodeTtlSeconds });
  const id = crypto.randomUUID();

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO stepup_challenges (id, account_id, purpose, code, expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, accountId, purpose, code, expiresAt.toJSDate()],
    );
    const email = stepupCodeEmail(accountLocale, code, Math.ceil(cfg.stepupCodeTtlSeconds / 60));
    const seq = await nextSequence(client, `stepup-code:${accountNumber}`);
    deps.outbox.enqueueInTx(client, {
      messageKey: `stepup-code:${accountNumber}:${seq}`,
      kind: 'stepup-code',
      to: accountEmail,
      subject: email.subject,
      bodyText: emailText(email.lines),
      html: emailHtml(email.lines),
      locale: accountLocale,
    });
  });

  // Delivery status: sent once SMTP accepted it within the response window.
  const delivery = await waitDelivery(deps.outbox, `stepup-code:${accountNumber}`, 4000);

  return {
    challenge: {
      id,
      expires_at: iso(expiresAt),
      delivery,
      masked_email: maskedEmail(accountEmail),
    },
  };
}

async function waitDelivery(
  outbox: OutboxService,
  keyPrefix: string,
  timeoutMs: number,
): Promise<'sent' | 'queued'> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await outbox.messageState(keyPrefix);
    if (state === 'sent') return 'sent';
    if (Date.now() >= deadline) return 'queued';
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

async function lockoutRemainingSeconds(cfg: Config, accountId: number): Promise<number> {
  const res = await query<{ until: Date }>(
    'SELECT until FROM stepup_lockouts WHERE account_id = $1',
    [accountId],
  );
  const row = res.rows[0];
  if (!row) return 0;
  const remaining = DateTime.fromJSDate(row.until).diff(DateTime.now(), 'seconds').seconds;
  return remaining <= 0 ? 0 : Math.ceil(remaining);
}

async function resendSpacingRemaining(accountId: number): Promise<number> {
  const res = await query<{ last: Date | null }>(
    'SELECT max(created_at) AS last FROM stepup_challenges WHERE account_id = $1',
    [accountId],
  );
  const last = res.rows[0]?.last;
  if (!last) return 0;
  const elapsed = DateTime.now().diff(DateTime.fromJSDate(last), 'seconds').seconds;
  const remaining = resendSpacingSeconds - elapsed;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}

async function sendLimitRemaining(cfg: Config, accountId: number): Promise<number> {
  const windowStart = DateTime.now().minus({ seconds: cfg.stepupLockoutSeconds });
  const res = await query<{ count: string; oldest: Date | null }>(
    `SELECT count(*)::text AS count, min(created_at) AS oldest
     FROM stepup_challenges
     WHERE account_id = $1 AND created_at > $2`,
    [accountId, windowStart.toJSDate()],
  );
  const count = Number(res.rows[0].count);
  if (count < maxCodesPerWindow) return 0;
  const oldest = res.rows[0].oldest;
  if (!oldest) return cfg.stepupLockoutSeconds;
  const until = DateTime.fromJSDate(oldest).plus({ seconds: cfg.stepupLockoutSeconds });
  const remaining = until.diff(DateTime.now(), 'seconds').seconds;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}

export async function resendStepup(
  deps: { cfg: Config; outbox: OutboxService },
  accountId: number,
  challengeId: string,
  accountNumber: string,
  accountEmail: string,
  accountLocale: Locale,
): Promise<StartOutcome> {
  const res = await query<ChallengeRow>(
    'SELECT id, account_id, purpose, code, expires_at, attempts, created_at FROM stepup_challenges WHERE id = $1',
    [challengeId],
  );
  const challenge = res.rows[0];
  if (!challenge || challenge.account_id !== accountId) throw new ApiError('not_found');
  return startStepup(deps, accountId, accountNumber, accountEmail, accountLocale, challenge.purpose as StepupPurpose);
}

export interface VerifyOutcome {
  stepup: { verified: true; valid_until: string };
}

export async function verifyStepup(
  cfg: Config,
  accountId: number,
  challengeId: string,
  code: string,
): Promise<VerifyOutcome> {
  const lockout = await lockoutRemainingSeconds(cfg, accountId);
  if (lockout > 0) {
    throw new ApiError('stepup_locked', {
      params: { minutes: String(Math.ceil(lockout / 60)) },
      headers: { 'Retry-After': String(lockout) },
    });
  }
  const res = await query<ChallengeRow>(
    'SELECT id, account_id, purpose, code, expires_at, attempts, created_at FROM stepup_challenges WHERE id = $1',
    [challengeId],
  );
  const challenge = res.rows[0];
  if (!challenge || challenge.account_id !== accountId) throw new ApiError('not_found');

  if (DateTime.now() >= DateTime.fromJSDate(challenge.expires_at)) {
    throw new ApiError('code_expired');
  }

  if (challenge.code !== code) {
    const attempts = challenge.attempts + 1;
    if (attempts >= maxWrongAttempts) {
      const until = DateTime.now().plus({ seconds: cfg.stepupLockoutSeconds });
      await withTransaction(async (client) => {
        await client.query(
          'UPDATE stepup_challenges SET attempts=$2 WHERE id=$1',
          [challengeId, attempts],
        );
        await client.query(
          `INSERT INTO stepup_lockouts (account_id, until) VALUES ($1,$2)
           ON CONFLICT (account_id) DO UPDATE SET until=$2`,
          [accountId, until.toJSDate()],
        );
      });
      throw new ApiError('stepup_locked', {
        params: { minutes: String(Math.ceil(cfg.stepupLockoutSeconds / 60)) },
        headers: { 'Retry-After': String(cfg.stepupLockoutSeconds) },
      });
    }
    await query('UPDATE stepup_challenges SET attempts=$2 WHERE id=$1', [challengeId, attempts]);
    throw new ApiError('code_incorrect', {
      params: { n: String(maxWrongAttempts - attempts) },
      extra: { attempts_left: maxWrongAttempts - attempts },
    });
  }

  const validUntil = DateTime.now().plus({ seconds: cfg.stepupValidSeconds });
  await withTransaction(async (client) => {
    await client.query('DELETE FROM stepup_challenges WHERE account_id=$1', [accountId]);
    await client.query(
      'INSERT INTO stepup_verifies (account_id, valid_until) VALUES ($1,$2)',
      [accountId, validUntil.toJSDate()],
    );
  });
  return { stepup: { verified: true, valid_until: iso(validUntil) } };
}

/** The one live-verification rule: server time strictly before valid_until. */
export async function stepupVerified(accountId: number): Promise<boolean> {
  const res = await query<{ valid_until: Date }>(
    'SELECT valid_until FROM stepup_verifies WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1',
    [accountId],
  );
  const row = res.rows[0];
  if (!row) return false;
  return DateTime.now() < DateTime.fromJSDate(row.valid_until);
}

/** The one step-up requirement: any credit spend, or any tier change. */
export function stepupNeeded(input: {
  creditAppliedCents: number;
  tierChange: boolean;
  verified: boolean;
}): boolean {
  if (!input.verified && (input.creditAppliedCents > 0 || input.tierChange)) return true;
  return false;
}
