import { randomUUID } from 'node:crypto';
import {
  STEPUP_MAX_ATTEMPTS,
  STEPUP_MAX_SENDS,
  STEPUP_RESEND_SPACING_SECONDS,
  STEPUP_PURPOSES,
  type StepupPurpose,
} from '../../shared/domain.ts';
import { one, query, transaction } from '../db/pool.ts';
import { env } from '../env.ts';
import { ApiError } from '../http/errors.ts';
import { Validator } from '../http/validate.ts';
import { sixDigitCode } from '../domain/ids.ts';
import { toIso } from '../domain/time.ts';
import { attemptNow, enqueueMail, nextMailSequence } from '../mail/outbox.ts';
import { stepupCodeEmail } from '../mail/templates.ts';
import type { SessionAccount } from '../http/context.ts';

export type ChallengePayload = {
  id: string;
  expires_at: string;
  delivery: 'sent' | 'queued';
  masked_email: string;
};

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain ?? ''}`;
}

async function assertNotLocked(accountId: number, now: Date): Promise<void> {
  const lock = await one<{ locked_until: Date }>('select locked_until from stepup_lockouts where account_id = $1', [
    accountId,
  ]);
  if (lock !== null && lock.locked_until.getTime() > now.getTime()) {
    const remaining = Math.ceil((lock.locked_until.getTime() - now.getTime()) / 1000);
    throw new ApiError('stepup_locked', {
      args: { minutes: Math.ceil(remaining / 60) },
      retryAfterSeconds: remaining,
    });
  }
}

async function assertSendAllowed(accountId: number, now: Date): Promise<void> {
  const last = await one<{ sent_at: Date }>(
    'select sent_at from stepup_sends where account_id = $1 order by sent_at desc limit 1',
    [accountId],
  );
  if (last !== null) {
    const elapsed = (now.getTime() - last.sent_at.getTime()) / 1000;
    if (elapsed < STEPUP_RESEND_SPACING_SECONDS) {
      const remaining = Math.ceil(STEPUP_RESEND_SPACING_SECONDS - elapsed);
      throw new ApiError('resend_too_soon', {
        args: { seconds: remaining },
        retryAfterSeconds: remaining,
      });
    }
  }
  const window = await query<{ sent_at: Date }>(
    `select sent_at from stepup_sends
       where account_id = $1 and sent_at > now() - make_interval(secs => $2::int)
       order by sent_at asc`,
    [accountId, env.stepupLockoutSeconds],
  );
  if (window.length >= STEPUP_MAX_SENDS) {
    const oldest = window[0].sent_at.getTime();
    const remaining = Math.max(
      1,
      Math.ceil((oldest + env.stepupLockoutSeconds * 1000 - now.getTime()) / 1000),
    );
    throw new ApiError('code_send_limit', {
      args: { minutes: Math.ceil(remaining / 60) },
      retryAfterSeconds: remaining,
    });
  }
}

async function sendChallenge(
  account: SessionAccount,
  purpose: StepupPurpose,
  challengeId: string,
): Promise<ChallengePayload> {
  const code = sixDigitCode();
  const accountNumber = account.number ?? `account-${account.id}`;
  const { expiresAt, messageKey } = await transaction(async (tx) => {
    const sequence = await nextMailSequence(tx, `stepup-code:${accountNumber}:`);
    const message = stepupCodeEmail({
      account_number: accountNumber,
      email: account.email,
      locale: account.locale,
      code,
      minutes: Math.ceil(env.stepupCodeTtlSeconds / 60),
      sequence,
    });
    const row = await tx.one<{ expires_at: Date }>(
      `insert into stepup_challenges(id, account_id, purpose, code, expires_at, email_seq)
         values($1,$2,$3,$4, now() + make_interval(secs => $5::int), $6)
       on conflict (id) do update set code = excluded.code,
         expires_at = excluded.expires_at, attempts = 0, email_seq = excluded.email_seq
       returning expires_at`,
      [challengeId, account.id, purpose, code, env.stepupCodeTtlSeconds, sequence],
    );
    await tx.query('insert into stepup_sends(account_id) values($1)', [account.id]);
    await enqueueMail(tx, message);
    return { expiresAt: row!.expires_at, messageKey: message.key };
  });
  const delivery = await attemptNow(messageKey);
  return {
    id: challengeId,
    expires_at: toIso(expiresAt),
    delivery,
    masked_email: maskEmail(account.email),
  };
}

export async function startStepup(input: {
  account: SessionAccount;
  body: Record<string, unknown>;
  now: Date;
}): Promise<ChallengePayload> {
  const validator = new Validator();
  const purpose = validator.enumValue('purpose', input.body.purpose, STEPUP_PURPOSES);
  await assertNotLocked(input.account.id, input.now);
  await assertSendAllowed(input.account.id, input.now);
  validator.check();
  return sendChallenge(input.account, purpose, randomUUID());
}

export async function resendStepup(input: {
  account: SessionAccount;
  body: Record<string, unknown>;
  now: Date;
}): Promise<ChallengePayload> {
  const challengeId = typeof input.body.challenge_id === 'string' ? input.body.challenge_id : '';
  const challenge = await loadChallenge(challengeId, input.account.id);
  await assertNotLocked(input.account.id, input.now);
  await assertSendAllowed(input.account.id, input.now);
  return sendChallenge(input.account, challenge.purpose, challenge.id);
}

async function loadChallenge(
  id: string,
  accountId: number,
): Promise<{ id: string; purpose: StepupPurpose; code: string; expires_at: Date; attempts: number }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ApiError('not_found');
  const row = await one<{
    id: string;
    purpose: StepupPurpose;
    code: string;
    expires_at: Date;
    attempts: number;
  }>(
    `select id::text as id, purpose, code, expires_at, attempts from stepup_challenges
       where id = $1 and account_id = $2`,
    [id, accountId],
  );
  if (row === null) throw new ApiError('not_found');
  return row;
}

export async function verifyStepup(input: {
  account: SessionAccount;
  sessionToken: string | null;
  body: Record<string, unknown>;
  now: Date;
}): Promise<{ verified: true; valid_until: string }> {
  const challengeId = typeof input.body.challenge_id === 'string' ? input.body.challenge_id : '';
  const challenge = await loadChallenge(challengeId, input.account.id);
  await assertNotLocked(input.account.id, input.now);
  if (input.now.getTime() >= challenge.expires_at.getTime()) throw new ApiError('code_expired');
  const code = typeof input.body.code === 'string' ? input.body.code.trim() : '';
  if (code !== challenge.code) {
    const attempts = challenge.attempts + 1;
    await query('update stepup_challenges set attempts = $2 where id = $1', [challenge.id, attempts]);
    if (attempts >= STEPUP_MAX_ATTEMPTS) {
      await query(
        `insert into stepup_lockouts(account_id, locked_until)
           values($1, now() + make_interval(secs => $2::int))
         on conflict (account_id) do update set locked_until = excluded.locked_until`,
        [input.account.id, env.stepupLockoutSeconds],
      );
      throw new ApiError('stepup_locked', {
        args: { minutes: Math.ceil(env.stepupLockoutSeconds / 60) },
        retryAfterSeconds: env.stepupLockoutSeconds,
      });
    }
    throw new ApiError('code_incorrect', {
      args: { n: STEPUP_MAX_ATTEMPTS - attempts },
      attemptsLeft: STEPUP_MAX_ATTEMPTS - attempts,
    });
  }
  const validUntil = new Date(input.now.getTime() + env.stepupValidSeconds * 1000);
  if (input.sessionToken !== null) {
    await query(
      `insert into stepup_verifications(session_token, account_id, valid_until) values($1,$2,$3)
         on conflict (session_token) do update set valid_until = excluded.valid_until`,
      [input.sessionToken, input.account.id, validUntil.toISOString()],
    );
  }
  await query('delete from stepup_challenges where id = $1', [challenge.id]);
  return { verified: true, valid_until: toIso(validUntil) };
}
