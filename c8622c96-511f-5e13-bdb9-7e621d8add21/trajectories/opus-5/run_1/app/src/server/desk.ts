import { randomUUID } from 'node:crypto';
import { essayStateAfter, isLegalEssayAction } from '../domain/lifecycle.js';
import { db, queryOn, withEssayLock, type Queryable } from './db/pool.js';
import { serverNow } from './clock.js';
import {
  essayCreditLine,
  loadCredits,
  loadEssayForUpdate,
  loadFrames,
  type EssayRow,
} from './data/essays.js';
import { reapEssayLicences } from './data/licences.js';
import {
  cancelEssayMail,
  embargoLiftMail,
  queueMail,
  takedownNoticeMail,
} from './data/mailqueue.js';
import { takedownRecipients } from './data/people.js';
import { apiError, illegalTransition, notFound } from './http/errors.js';
import { deleteGrantRecord, deleteObject, moveToLegalHold } from './services/storage.js';

const ALL_MAIL_KINDS = ['embargo_lift', 'licence_receipt', 'expiry_warning', 'takedown_notice'] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function publishEssay(essayId: string): Promise<EssayRow> {
  return withEssayLock(essayId, async (client) => {
    const now = await serverNow();
    const essay = await loadEssayForUpdate(client, essayId);
    if (!essay) throw notFound();
    if (!isLegalEssayAction(essay.state, 'publish')) throw illegalTransition(essay.state, 'publish');
    const state = essayStateAfter('publish', essay.lift_at.getTime() > now.getTime());
    const updated = await queryOn<EssayRow>(
      client,
      `update essays set state = $2, version = version + 1 where id = $1
       returning id, title, caption, lift_local, lift_at, lift_resolution, exclusive_days,
         standard_days, exclusive_price_minor, standard_price_minor, state, version,
         withdrawal_requested, submitted_at`,
      [essayId, state],
    );
    const row = updated.rows[0];
    if (!row) throw notFound();
    return row;
  });
}

export async function holdEssay(essayId: string, note: string): Promise<void> {
  await withEssayLock(essayId, async (client) => {
    const now = await serverNow();
    const essay = await loadEssayForUpdate(client, essayId);
    if (!essay) throw notFound();
    if (!isLegalEssayAction(essay.state, 'hold')) throw illegalTransition(essay.state, 'hold');
    await queryOn(client, `update essays set state = 'draft', version = version + 1 where id = $1`, [
      essayId,
    ]);
    await queryOn(client, 'insert into desk_notes (id, essay_id, note, at) values ($1, $2, $3, $4)', [
      randomUUID(),
      essayId,
      note,
      now,
    ]);
  });
}

export async function requestWithdrawal(essayId: string): Promise<void> {
  await withEssayLock(essayId, async (client) => {
    const essay = await loadEssayForUpdate(client, essayId);
    if (!essay) throw notFound();
    if (!isLegalEssayAction(essay.state, 'withdrawal_request')) {
      throw illegalTransition(essay.state, 'withdrawal_request');
    }
    await queryOn(
      client,
      'update essays set withdrawal_requested = true, version = version + 1 where id = $1',
      [essayId],
    );
  });
}

export async function withdrawEssay(essayId: string): Promise<void> {
  await withEssayLock(essayId, async (client) => {
    const essay = await loadEssayForUpdate(client, essayId);
    if (!essay) throw notFound();
    if (!isLegalEssayAction(essay.state, 'withdraw')) throw illegalTransition(essay.state, 'withdraw');
    if (!essay.withdrawal_requested) {
      throw apiError(409, 'no_withdrawal_request', 'No contributor has requested this withdrawal.');
    }
    await queryOn(
      client,
      `update essays set state = 'withdrawn', version = version + 1 where id = $1`,
      [essayId],
    );
    await queryOn(client, 'delete from shortlist_items where essay_id = $1', [essayId]);
    await cancelEssayMail(client, essayId, ['embargo_lift']);
  });
}

export interface TakedownResult {
  essayId: string;
  revokedLicenceIds: string[];
}

/** A takedown waits for any activation already in progress on the essay's licences. */
export async function takedownEssay(essayId: string, reference: string): Promise<TakedownResult> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const outcome = await withEssayLock(essayId, async (client) => {
      const now = await serverNow();
      const essay = await loadEssayForUpdate(client, essayId);
      if (!essay) throw notFound();
      if (!isLegalEssayAction(essay.state, 'takedown')) throw illegalTransition(essay.state, 'takedown');
      const inFlight = await queryOn<{ count: string }>(
        client,
        `select count(*) as count from licences
         where essay_id = $1 and activating_since is not null
           and activating_since > now() - interval '6 seconds'`,
        [essayId],
      );
      if (Number(inFlight.rows[0]?.count ?? '0') > 0) return 'wait' as const;
      await reapEssayLicences(client, essayId, now);
      const recipients = await takedownRecipients(client, essayId);
      const revoked = await queryOn<{ id: string }>(
        client,
        `update licences set state = 'revoked', revoked_at = $2, activating_since = null,
           next_attempt_at = null
         where essay_id = $1 and state <> 'revoked' returning id`,
        [essayId, now],
      );
      const revokedLicenceIds = revoked.rows.map((row) => row.id);
      await queryOn(client, 'delete from shortlist_items where essay_id = $1', [essayId]);
      await cancelEssayMail(client, essayId, [...ALL_MAIL_KINDS]);
      for (const recipient of recipients) {
        await queueMail(
          client,
          takedownNoticeMail({ id: essayId, title: essay.title }, revokedLicenceIds, recipient),
          now,
        );
      }
      await queryOn(
        client,
        `update essays set state = 'taken_down', takedown_reference = $2, version = version + 1
         where id = $1`,
        [essayId, reference],
      );
      return { essayId, revokedLicenceIds } satisfies TakedownResult;
    });
    if (outcome !== 'wait') {
      await cleanUpTakenDownStorage(essayId);
      return outcome;
    }
    await sleep(200);
  }
  throw apiError(409, 'illegal_transition', 'An activation on this essay is still settling.', {
    from: 'live',
    action: 'takedown',
  });
}

/** Derivatives and grant records are deleted; originals move under the legal-hold prefix. */
export async function cleanUpTakenDownStorage(essayId: string): Promise<void> {
  const frames = await loadFrames(db, essayId);
  const licences = await queryOn<{ id: string }>(
    db,
    `select id from licences where essay_id = $1 and grant_written`,
    [essayId],
  );
  try {
    for (const licence of licences.rows) await deleteGrantRecord(licence.id);
    for (const frame of frames) {
      for (const variant of ['grid', 'story', 'preview']) {
        await deleteObject(`derivatives/${essayId}/${frame.id}/${variant}.jpg`);
      }
      await moveToLegalHold(essayId, frame.id);
    }
    await queryOn(db, 'update essays set takedown_cleaned = true where id = $1', [essayId]);
  } catch {
    /* storage is unreachable; the cleanup worker finishes this once it returns */
  }
}

/** The embargo lifts once, queueing one alert for each person following at that instant. */
export async function liftEmbargo(essayId: string): Promise<void> {
  await withEssayLock(essayId, async (client) => {
    const now = await serverNow();
    const lifted = await queryOn<{ id: string; title: string; lift_at: Date }>(
      client,
      `update essays set state = 'live', version = version + 1
       where id = $1 and state = 'embargoed' and lift_at <= $2
       returning id, title, lift_at`,
      [essayId, now],
    );
    const essay = lifted.rows[0];
    if (!essay) return;
    const credits = await loadCredits(client, essayId);
    const followers = await queryOn<{ id: string; email: string; name: string }>(
      client,
      `select distinct p.id, p.email, p.name from follows f join people p on p.id = f.person_id
       where f.essay_id = $1 or f.contributor_handle = any($2::text[])
       order by p.id`,
      [essayId, credits.map((credit) => credit.contributor_handle)],
    );
    for (const follower of followers.rows) {
      await queueMail(
        client,
        embargoLiftMail(
          {
            id: essay.id,
            title: essay.title,
            creditLine: essayCreditLine(credits),
            liftAt: essay.lift_at,
          },
          follower,
        ),
        now,
      );
    }
  });
}

export async function essaysDueToLift(client: Queryable, now: Date): Promise<string[]> {
  const result = await queryOn<{ id: string }>(
    client,
    `select id from essays where state = 'embargoed' and lift_at <= $1`,
    [now],
  );
  return result.rows.map((row) => row.id);
}
