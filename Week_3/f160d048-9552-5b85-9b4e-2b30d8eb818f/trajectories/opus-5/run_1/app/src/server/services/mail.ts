import { config } from '../config';
import type { Db } from '../db/pool';
import { db } from '../db/pool';
import { uuid } from '../ids';
import { isAvailable, sendMail } from './smtp';

export interface Letter {
  to: string;
  subject: string;
  body: string;
}

/** Every email is written as an outbox row inside the action's transaction. */
export async function queueLetter(tx: Db, now: Date, letter: Letter): Promise<void> {
  await tx.query(
    `INSERT INTO outbox (id, to_email, subject, body, created_at, next_attempt_at) VALUES ($1, $2, $3, $4, $5, $5)`,
    [uuid(), letter.to, letter.subject, letter.body, now],
  );
}

export async function pendingCount(): Promise<number> {
  const row = await db.one<{ count: string }>('SELECT count(*) AS count FROM outbox WHERE sent_at IS NULL');
  return Number(row?.count ?? 0);
}

/**
 * An instance claims rows only while its own SMTP server answers, so an
 * instance that cannot reach SMTP leaves every row for the others.
 */
export async function drainOutbox(now: Date): Promise<void> {
  if (!(await isAvailable())) return;
  for (;;) {
    const claimed = await db.one<{ id: string; to_email: string; subject: string; body: string }>(
      `UPDATE outbox SET claimed_at = $1, attempts = attempts + 1
         WHERE id = (
           SELECT id FROM outbox
             WHERE sent_at IS NULL AND next_attempt_at <= $1
             ORDER BY created_at
             FOR UPDATE SKIP LOCKED
             LIMIT 1
         )
       RETURNING id, to_email, subject, body`,
      [now],
    );
    if (!claimed) return;
    try {
      await sendMail(claimed.to_email, claimed.subject, claimed.body);
      await db.query('UPDATE outbox SET sent_at = $2 WHERE id = $1', [claimed.id, now]);
    } catch {
      await db.query('UPDATE outbox SET next_attempt_at = $2, claimed_at = NULL WHERE id = $1', [
        claimed.id,
        new Date(now.getTime() + config.outboxRetrySeconds * 1000),
      ]);
      return;
    }
  }
}

const link = (path: string): string => `${config.appPublicUrl}${path}`;

export const letters = {
  verificationCode(to: string, code: string): Letter {
    const minutes = Math.ceil(config.emailCodeTtlSeconds / 60);
    return {
      to,
      subject: 'Your Candour Bench verification code',
      body: `Your code is ${code}. It expires in ${minutes} minutes.`,
    };
  },
  join(to: string, token: string): Letter {
    return {
      to,
      subject: 'Finish joining Candour Bench',
      body: `Finish joining Candour Bench by opening this link:\n\n${link(`/join/confirm?token=${token}`)}\n`,
    };
  },
  joinExisting(to: string): Letter {
    return {
      to,
      subject: 'You already have a Candour Bench account',
      body: `You already have an account. Sign in here:\n\n${link('/sign-in')}\n\nForgotten your password?\n\n${link('/forgot-password')}\n`,
    };
  },
  reset(to: string, token: string): Letter {
    return {
      to,
      subject: 'Reset your Candour Bench password',
      body: `Reset your password by opening this link:\n\n${link(`/reset-password?token=${token}`)}\n`,
    };
  },
  setPassword(to: string, token: string): Letter {
    return {
      to,
      subject: 'Set your Candour Bench password',
      body: `Set your password by opening this link:\n\n${link(`/reset-password?token=${token}`)}\n`,
    };
  },
  moderationOutcome(
    to: string,
    kindLabel: string,
    companyName: string,
    decision: 'approved' | 'rejected',
    reason: string | null,
  ): Letter {
    const lines = [`Your ${kindLabel} for ${companyName} was ${decision}.`];
    if (decision === 'rejected' && reason) lines.push(`Reason: ${reason}.`);
    return {
      to,
      subject: `Your post on Candour Bench was ${decision}`,
      body: `${lines.join('\n')}\n`,
    };
  },
  stageChange(to: string, jobTitle: string, companyName: string, stageLabel: string): Letter {
    return {
      to,
      subject: `Your application for ${jobTitle} at ${companyName}`,
      body: `Your application is now at the ${stageLabel} stage.\n`,
    };
  },
  jobAlert(
    to: string,
    alertLabel: string,
    jobs: ReadonlyArray<{ id: string; title: string; companyName: string; cityName: string; payRange: string }>,
  ): Letter {
    const heading =
      jobs.length === 1 ? `1 new lab job for ${alertLabel}` : `${jobs.length} new lab jobs for ${alertLabel}`;
    const body = jobs
      .map((job) => `${job.title} at ${job.companyName}, ${job.cityName}, ${job.payRange}\n${link(`/jobs/${job.id}`)}`)
      .join('\n\n');
    return { to, subject: heading, body: `${body}\n` };
  },
};
