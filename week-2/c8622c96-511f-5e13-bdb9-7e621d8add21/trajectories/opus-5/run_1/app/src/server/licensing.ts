import { randomUUID } from 'node:crypto';
import { isLicensableState } from '../domain/lifecycle.js';
import {
  licenceHoldDeadline,
  licenceWindowEnd,
  type LicenceKind,
} from '../domain/licensing.js';
import { minorToBillingAmount } from '../domain/money.js';
import { coopMidnight, isoInstant } from '../domain/time.js';
import type { FieldErrors } from '../domain/validate.js';
import { serverNow } from './clock.js';
import { db, queryOn, withEssayLock, type Queryable } from './db/pool.js';
import {
  essayCreditLine,
  loadCredits,
  loadEssay,
  loadEssayForUpdate,
  loadFrames,
} from './data/essays.js';
import {
  EFFECTIVE_END_SQL,
  effectiveEnd,
  holdingExclusive,
  LICENCE_COLUMNS,
  loadLicence,
  reapEssayLicences,
  standardRunningUntil,
  holderPerspective,
  type LicenceRow,
} from './data/licences.js';
import { licenceReceiptMail, queueMail } from './data/mailqueue.js';
import { licenceRecipients } from './data/people.js';
import { apiError, notFound, takenDown, validationFailed } from './http/errors.js';
import type { SignedInPerson } from './http/router.js';
import { BillingRefused, BillingUnreachable, raiseLicenceCharge } from './services/billing.js';
import { deleteGrantRecord, putGrantRecord } from './services/storage.js';

export async function currentRateBp(client: Queryable, at: Date): Promise<number> {
  const result = await queryOn<{ effective_from: string; rate_bp: number }>(
    client,
    `select to_char(effective_from, 'YYYY-MM-DD') as effective_from, rate_bp
     from commission_rates order by effective_from desc`,
  );
  for (const row of result.rows) {
    if (coopMidnight(row.effective_from).getTime() <= at.getTime()) return row.rate_bp;
  }
  return 0;
}

async function newsroomLicenceOnEssay(
  client: Queryable,
  essayId: string,
  newsroomSlug: string,
  now: Date,
): Promise<LicenceRow | null> {
  const result = await queryOn<LicenceRow>(
    client,
    `select ${LICENCE_COLUMNS} from licences
     where essay_id = $1 and newsroom_slug = $2 and state in ('pending_invoice', 'active')
       and ${EFFECTIVE_END_SQL} > $3
     limit 1`,
    [essayId, newsroomSlug, now],
  );
  return result.rows[0] ?? null;
}

export interface LicenceRequest {
  essayId: string;
  person: SignedInPerson;
  newsroomSlug: string;
  kind: LicenceKind | null;
  validationFields: FieldErrors | null;
}

/** Confirms a licence inside the per-essay serialisation, or throws its conflict. */
async function confirmLicence(request: LicenceRequest): Promise<LicenceRow> {
  return withEssayLock(request.essayId, async (client) => {
    const now = await serverNow();
    const essay = await loadEssayForUpdate(client, request.essayId);
    if (!essay) throw notFound();
    if (essay.state === 'taken_down') throw takenDown();
    await reapEssayLicences(client, essay.id, now);
    if (!isLicensableState(essay.state)) {
      throw apiError(409, 'not_licensable', 'This essay cannot be licensed right now.');
    }
    if (request.kind === 'exclusive') {
      const holder = await holdingExclusive(client, essay.id, now);
      if (holder) {
        throw apiError(409, 'window_held', 'Another claim holds this exclusive window.', {
          held_by: holderPerspective(holder, request.person),
          held_until: isoInstant(effectiveEnd(holder)),
        });
      }
      const running = await standardRunningUntil(client, essay.id, request.newsroomSlug, now);
      if (running) {
        throw apiError(409, 'standard_licences_active', 'Standard licences are still running on this essay.', {
          blocked_until: isoInstant(running),
        });
      }
    }
    if (request.kind === 'standard') {
      const holder = await holdingExclusive(client, essay.id, now);
      if (holder && holder.newsroom_slug !== request.newsroomSlug) {
        throw apiError(409, 'exclusive_held', 'Another newsroom holds the exclusive window.', {
          held_by: holderPerspective(holder, request.person),
          held_until: isoInstant(effectiveEnd(holder)),
        });
      }
    }
    const existing = await newsroomLicenceOnEssay(client, essay.id, request.newsroomSlug, now);
    if (existing) {
      throw apiError(409, 'already_licensed', 'Your newsroom already licenses this essay.');
    }
    if (request.validationFields) throw validationFailed(request.validationFields);
    const kind = request.kind;
    if (!kind) throw validationFailed({ kind: 'Kind must be exclusive or standard' });
    const days = kind === 'exclusive' ? essay.exclusive_days : essay.standard_days;
    const amountMinor =
      kind === 'exclusive' ? essay.exclusive_price_minor : essay.standard_price_minor;
    const windowEnd = licenceWindowEnd(now, essay.lift_at, days);
    const holdUntil = licenceHoldDeadline(now, windowEnd);
    const rateBp = await currentRateBp(client, now);
    const inserted = await queryOn<LicenceRow>(
      client,
      `insert into licences (id, essay_id, newsroom_slug, licensed_by, kind, state, amount_minor,
         rate_bp, confirmed_at, window_start, window_end, hold_until, invoice_state, next_attempt_at)
       values ($1, $2, $3, $4, $5, 'pending_invoice', $6, $7, $8, $8, $9, $10, 'pending', now())
       returning ${LICENCE_COLUMNS}`,
      [
        randomUUID(),
        essay.id,
        request.newsroomSlug,
        request.person.id,
        kind,
        amountMinor,
        rateBp,
        now,
        windowEnd,
        holdUntil,
      ],
    );
    const licence = inserted.rows[0];
    if (!licence) throw notFound();
    return licence;
  });
}

async function clearAttempt(licenceId: string, retryInSeconds: number): Promise<void> {
  await queryOn(
    db,
    `update licences set activating_since = null, next_attempt_at = now() + ($2 || ' seconds')::interval
     where id = $1 and state = 'pending_invoice'`,
    [licenceId, String(retryInSeconds)],
  );
}

async function grantRecord(client: Queryable, licence: LicenceRow): Promise<unknown> {
  const frames = await loadFrames(client, licence.essay_id);
  return {
    licence_id: licence.id,
    newsroom: licence.newsroom_slug,
    essay_id: licence.essay_id,
    frame_ids: frames.map((frame) => frame.id),
    window_end: isoInstant(licence.window_end),
  };
}

/**
 * All or nothing: the invoice charge and the grant record are raised first, then the
 * licence becomes active and its receipt is queued in one commit.
 */
export async function attemptActivation(licenceId: string): Promise<LicenceRow | null> {
  const claimed = await withEssayLockForLicence(licenceId, async (client, licence, now) => {
    if (licence.state !== 'pending_invoice') return null;
    if (now.getTime() >= licence.hold_until.getTime()) {
      await queryOn(client, 'delete from licences where id = $1', [licence.id]);
      return null;
    }
    await queryOn(
      client,
      'update licences set activating_since = now(), charge_attempts = charge_attempts + 1 where id = $1',
      [licence.id],
    );
    return { licence, record: await grantRecord(client, licence) };
  });
  if (!claimed) return loadLicence(db, licenceId, await serverNow());
  const { licence, record } = claimed;
  const newsroom = await queryOn<{ name: string }>(db, 'select name from newsrooms where slug = $1', [
    licence.newsroom_slug,
  ]);
  try {
    await raiseLicenceCharge({
      newsroomSlug: licence.newsroom_slug,
      newsroomName: newsroom.rows[0]?.name ?? licence.newsroom_slug,
      licenceId: licence.id,
      kind: licence.kind,
      amount: minorToBillingAmount(licence.amount_minor),
      retry: licence.charge_attempts > 0,
    });
  } catch (error) {
    if (error instanceof BillingRefused) {
      await queryOn(db, 'delete from licences where id = $1', [licence.id]);
      throw apiError(502, 'billing_rejected', 'The billing provider refused this charge.');
    }
    if (error instanceof BillingUnreachable) {
      await clearAttempt(licence.id, 5);
      return loadLicence(db, licence.id, await serverNow());
    }
    throw error;
  }
  try {
    await putGrantRecord(licence.id, record);
  } catch {
    await clearAttempt(licence.id, 5);
    return loadLicence(db, licence.id, await serverNow());
  }
  return withEssayLockForLicence(licenceId, async (client, current, now) => {
    if (current.state !== 'pending_invoice') {
      if (current.state === 'revoked') await deleteGrantRecord(current.id);
      return current;
    }
    const activated = await queryOn<LicenceRow>(
      client,
      `update licences set state = 'active', invoice_state = 'raised', grant_written = true,
         activating_since = null, next_attempt_at = null
       where id = $1 returning ${LICENCE_COLUMNS}`,
      [current.id],
    );
    const licenceRow = activated.rows[0];
    if (!licenceRow) return current;
    const credits = await loadCredits(client, licenceRow.essay_id);
    const essay = await loadEssay(client, licenceRow.essay_id);
    const recipients = await licenceRecipients(client, licenceRow.licensed_by, licenceRow.newsroom_slug);
    for (const recipient of recipients) {
      await queueMail(
        client,
        licenceReceiptMail(
          {
            id: licenceRow.id,
            essayId: licenceRow.essay_id,
            essayTitle: essay?.title ?? '',
            creditLine: essayCreditLine(credits),
            kind: licenceRow.kind,
            windowStart: licenceRow.window_start,
            windowEnd: licenceRow.window_end,
            amountMinor: licenceRow.amount_minor,
          },
          recipient,
        ),
        now,
      );
    }
    return licenceRow;
  });
}

async function withEssayLockForLicence<T>(
  licenceId: string,
  run: (client: Queryable, licence: LicenceRow, now: Date) => Promise<T>,
): Promise<T | null> {
  const found = await queryOn<{ essay_id: string }>(db, 'select essay_id from licences where id = $1', [
    licenceId,
  ]);
  const essayId = found.rows[0]?.essay_id;
  if (!essayId) return null;
  return withEssayLock(essayId, async (client) => {
    const now = await serverNow();
    const result = await queryOn<LicenceRow>(
      client,
      `select ${LICENCE_COLUMNS} from licences where id = $1 for update`,
      [licenceId],
    );
    const licence = result.rows[0];
    if (!licence) return null;
    return run(client, licence, now);
  });
}

export interface LicenceOutcome {
  licence: LicenceRow;
  status: 201 | 202;
}

export async function createLicence(request: LicenceRequest): Promise<LicenceOutcome> {
  const confirmed = await confirmLicence(request);
  const settled = (await attemptActivation(confirmed.id)) ?? confirmed;
  return { licence: settled, status: settled.state === 'active' ? 201 : 202 };
}
