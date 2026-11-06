import { EXPIRY_WARNING_MS } from '../domain/licensing.js';
import { serverNow } from './clock.js';
import { db, queryOn, withEssayLock, withTransaction } from './db/pool.js';
import { seedMedia } from './db/seed.js';
import { reapEssayLicences } from './data/licences.js';
import { expiryWarningMail, queueMail } from './data/mailqueue.js';
import { licenceRecipients } from './data/people.js';
import { cleanUpTakenDownStorage, essaysDueToLift, liftEmbargo } from './desk.js';
import { attemptActivation } from './licensing.js';
import { sendMail } from './services/mail.js';
import { settleQueuedPayouts } from './statements.js';

const TICK_MS = 1000;
const MEDIA_TICK_MS = 10_000;

async function liftDueEmbargoes(): Promise<void> {
  const now = await serverNow();
  for (const essayId of await essaysDueToLift(db, now)) await liftEmbargo(essayId);
}

async function retryPendingActivations(): Promise<void> {
  const pending = await queryOn<{ id: string }>(
    db,
    `select id from licences
     where state = 'pending_invoice' and next_attempt_at is not null and next_attempt_at <= now()
       and (activating_since is null or activating_since < now() - interval '6 seconds')
     order by confirmed_at`,
  );
  for (const licence of pending.rows) {
    try {
      await attemptActivation(licence.id);
    } catch {
      /* a refusal or outage is already recorded on the licence */
    }
  }
}

async function removeLicencesPastHoldDeadline(): Promise<void> {
  const now = await serverNow();
  const essays = await queryOn<{ essay_id: string }>(
    db,
    `select distinct essay_id from licences
     where state = 'pending_invoice' and hold_until <= $1`,
    [now],
  );
  for (const row of essays.rows) {
    await withEssayLock(row.essay_id, async (client) => {
      await reapEssayLicences(client, row.essay_id, await serverNow());
    });
  }
}

async function queueExpiryWarnings(): Promise<void> {
  const now = await serverNow();
  const due = await queryOn<{
    id: string;
    essay_id: string;
    essay_title: string;
    kind: 'exclusive' | 'standard';
    window_end: Date;
    licensed_by: string;
    newsroom_slug: string;
  }>(
    db,
    `select l.id, l.essay_id, e.title as essay_title, l.kind, l.window_end, l.licensed_by, l.newsroom_slug
     from licences l join essays e on e.id = l.essay_id
     where l.state = 'active'
       and l.window_end > $1
       and l.window_end - ($2 || ' milliseconds')::interval <= $1
       and l.confirmed_at <= l.window_end - ($2 || ' milliseconds')::interval`,
    [now, String(EXPIRY_WARNING_MS)],
  );
  for (const licence of due.rows) {
    await withTransaction(async (client) => {
      const recipients = await licenceRecipients(client, licence.licensed_by, licence.newsroom_slug);
      for (const recipient of recipients) {
        await queueMail(
          client,
          expiryWarningMail(
            {
              id: licence.id,
              essayId: licence.essay_id,
              essayTitle: licence.essay_title,
              kind: licence.kind,
              windowEnd: licence.window_end,
            },
            recipient,
          ),
          now,
        );
      }
    });
  }
}

/** Each queued message is claimed in the database, so it is delivered exactly once. */
async function deliverQueuedMail(): Promise<void> {
  for (let batch = 0; batch < 20; batch += 1) {
    const sent = await withTransaction(async (client) => {
      const claimed = await queryOn<{ id: string; to_email: string; subject: string; body: string }>(
        client,
        `select id, to_email, subject, body from outbound_mail
         where state = 'queued' and next_attempt_at <= now()
         order by created_at, id for update skip locked limit 1`,
      );
      const message = claimed.rows[0];
      if (!message) return false;
      try {
        await sendMail(message.to_email, message.subject, message.body);
      } catch {
        await queryOn(
          client,
          `update outbound_mail set attempts = attempts + 1,
             next_attempt_at = now() + interval '5 seconds' where id = $1`,
          [message.id],
        );
        return false;
      }
      await queryOn(
        client,
        `update outbound_mail set state = 'sent', sent_at = now(), attempts = attempts + 1 where id = $1`,
        [message.id],
      );
      return true;
    });
    if (!sent) return;
  }
}

async function finishTakedownCleanup(): Promise<void> {
  const essays = await queryOn<{ id: string }>(
    db,
    `select id from essays where state = 'taken_down' and not takedown_cleaned`,
  );
  for (const essay of essays.rows) await cleanUpTakenDownStorage(essay.id);
}

let mediaSeeded = false;

async function ensureSeedMedia(): Promise<void> {
  if (mediaSeeded) return;
  await seedMedia();
  mediaSeeded = true;
}

const TASKS: Array<() => Promise<void>> = [
  liftDueEmbargoes,
  retryPendingActivations,
  removeLicencesPastHoldDeadline,
  queueExpiryWarnings,
  deliverQueuedMail,
  settleQueuedPayouts,
  finishTakedownCleanup,
];

async function tick(): Promise<void> {
  for (const task of TASKS) {
    try {
      await task();
    } catch {
      /* a provider or the database is unreachable; the next tick retries */
    }
  }
}

export function startWorkers(): void {
  const run = (): void => {
    void tick().finally(() => {
      setTimeout(run, TICK_MS);
    });
  };
  setTimeout(run, TICK_MS);
  const runMedia = (): void => {
    void ensureSeedMedia()
      .catch(() => {
        /* storage is unreachable; the next pass retries */
      })
      .finally(() => {
        if (!mediaSeeded) setTimeout(runMedia, MEDIA_TICK_MS);
      });
  };
  runMedia();
}
