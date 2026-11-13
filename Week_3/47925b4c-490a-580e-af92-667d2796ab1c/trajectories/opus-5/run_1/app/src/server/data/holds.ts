import { randomUUID } from 'node:crypto';
import { type Queryable, type Row, query, queryOne, transact } from '../db/pool.js';
import { euros } from '../domain/format.js';
import { type Quote, quoteFor } from '../domain/quotes.js';
import { writeEvent } from '../events/outbox.js';
import { problem } from '../http/problem.js';
import { askConfirm, askHold, askQuote, askRelease } from '../services/hiredesk.js';
import { commitLayoutWrite } from './layouts.js';
import { ensureBodyModel, postMovement, RENTAL_HOUSE, SHELF } from './kit.js';

export type HoldStatus = 'Asked' | 'Held' | 'Hired in' | 'Lapsed' | 'Released';

export interface HoldRecord {
  readonly id: string;
  readonly status: HoldStatus;
  readonly model: string;
  readonly fromDay: string;
  readonly days: number;
  readonly holdRef: string | null;
  readonly serial: string | null;
  readonly loggedHours: string | null;
  readonly expiresAt: Date | null;
  readonly quote: Quote | null;
  readonly confirmPending: boolean;
  readonly handBack: boolean;
}

export interface HoldView {
  readonly id: string;
  readonly status: HoldStatus;
  readonly model: string;
  readonly from: string;
  readonly days: number;
  readonly holdRef: string | null;
  readonly serial: string | null;
  readonly expiresAt: string | null;
  readonly remainingSeconds: number;
  readonly serverNow: string;
  readonly quote: Quote | null;
}

function toHold(row: Row): HoldRecord {
  return {
    id: row['id'] as string,
    status: row['status'] as HoldStatus,
    model: row['model'] as string,
    fromDay: row['from_day'] as string,
    days: Number(row['days']),
    holdRef: (row['hold_ref'] as string | null) ?? null,
    serial: (row['serial'] as string | null) ?? null,
    loggedHours: (row['logged_hours'] as string | null) ?? null,
    expiresAt: (row['expires_at'] as Date | null) ?? null,
    quote: (row['quote'] as Quote | null) ?? null,
    confirmPending: row['confirm_pending'] as boolean,
    handBack: row['hand_back'] as boolean,
  };
}

/** Lapse is decided by the server clock over a half-open hold window. */
export function statusAt(hold: HoldRecord, now: number): HoldStatus {
  if (hold.status !== 'Held') return hold.status;
  if (hold.confirmPending) return 'Held';
  if (hold.expiresAt !== null && now >= hold.expiresAt.getTime()) return 'Lapsed';
  return 'Held';
}

export function holdView(hold: HoldRecord, now: number): HoldView {
  const status = statusAt(hold, now);
  const remaining =
    status === 'Held' && hold.expiresAt !== null
      ? Math.max(0, Math.ceil((hold.expiresAt.getTime() - now) / 1000))
      : 0;
  return {
    id: hold.id,
    status,
    model: hold.model,
    from: hold.fromDay,
    days: hold.days,
    holdRef: hold.holdRef,
    serial: hold.serial,
    expiresAt: hold.expiresAt === null ? null : hold.expiresAt.toISOString(),
    remainingSeconds: remaining,
    serverNow: new Date(now).toISOString(),
    quote: hold.quote,
  };
}

export async function findHold(holdId: string): Promise<HoldRecord | null> {
  if (!/^[0-9a-f-]{36}$/.test(holdId)) return null;
  const row = await queryOne('select * from holds where id = $1', [holdId]);
  return row === null ? null : toHold(row);
}

export async function requireHold(holdId: string): Promise<HoldRecord> {
  const hold = await findHold(holdId);
  if (hold === null) throw problem('not_found');
  return hold;
}

export async function holdRecords(): Promise<HoldRecord[]> {
  const rows = await query('select * from holds order by created_at desc, id');
  return rows.map(toHold);
}

export async function listHolds(): Promise<HoldView[]> {
  const rows = await query('select * from holds order by created_at desc, id');
  const now = Date.now();
  return rows.map((row) => holdView(toHold(row), now));
}

async function setStatus(
  client: Queryable,
  holdId: string,
  status: HoldStatus,
  patch: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  const members = Object.keys(patch);
  const assignments = members.map((member, index) => `${member} = $${index + 3}`);
  await client.query(
    `update holds set status = $2${assignments.length === 0 ? '' : `, ${assignments.join(', ')}`} where id = $1`,
    [holdId, status, ...members.map((member) => patch[member])],
  );
  await writeEvent(client, 'hold.changed', holdId, { id: holdId, status });
}

/** Clears placements drawn on a hold back to Needs a body, as a committed layout write. */
async function clearPlacements(client: Queryable, holdId: string): Promise<void> {
  const cleared = await client.query(
    'update placements set hold_id = null where hold_id = $1 returning layout_id',
    [holdId],
  );
  const layouts = new Set(cleared.rows.map((row) => row['layout_id'] as string));
  for (const layoutId of layouts) await commitLayoutWrite(client, layoutId);
}

export function askKey(holdId: string): string {
  return `gevelwerk-ask-${holdId}`;
}

export function confirmKey(holdId: string): string {
  return `gevelwerk-confirm-${holdId}`;
}

export interface AskRequest {
  readonly model: string;
  readonly from: string;
  readonly days: number;
}

export async function createHold(request: AskRequest): Promise<HoldView> {
  const id = randomUUID();
  await transact(async (client) => {
    await client.query(
      `insert into holds (id, status, model, from_day, days) values ($1, 'Asked', $2, $3, $4)`,
      [id, request.model, request.from, request.days],
    );
    await writeEvent(client, 'hold.changed', id, { id, status: 'Asked' });
  });

  const answer = await askHold(request.model, request.from, request.days, askKey(id));
  if (answer.kind === 'answered') {
    const expiresAt = new Date(Date.now() + answer.value.expiresInSeconds * 1000);
    await transact(async (client) => {
      await setStatus(client, id, 'Held', {
        hold_ref: answer.value.holdRef,
        serial: answer.value.serial,
        logged_hours: String(answer.value.loggedHours),
        expires_at: expiresAt.toISOString(),
      });
    });
    return holdView((await requireHold(id)), Date.now());
  }
  if (answer.kind === 'refused') {
    await transact(async (client) => {
      await setStatus(client, id, 'Released');
    });
    throw problem('no_stock');
  }
  if (answer.kind === 'unreachable') {
    await transact(async (client) => {
      await setStatus(client, id, 'Released');
    });
    throw problem('hire_desk_unavailable', { extensions: { holdId: id } });
  }
  await query('update holds set hand_back = true, next_attempt_at = now() + interval \'5 seconds\' where id = $1', [id]);
  throw problem('hire_desk_unavailable', { extensions: { holdId: id } });
}

export async function quoteHold(holdId: string): Promise<Quote> {
  const hold = await requireHold(holdId);
  const status = statusAt(hold, Date.now());
  if (status === 'Lapsed') throw problem('hold_lapsed');
  if (status !== 'Held') throw problem('hold_not_held');
  const answer = await askQuote(hold.holdRef as string, hold.days);
  if (answer.kind !== 'answered') throw problem('hire_release_unavailable');
  const quote = quoteFor(answer.value.dayRateCents, hold.days, answer.value.totalCents);
  await query('update holds set quote = $2::jsonb where id = $1', [holdId, JSON.stringify(quote)]);
  return quote;
}

export async function confirmHold(holdId: string): Promise<HoldView> {
  const hold = await requireHold(holdId);
  const status = statusAt(hold, Date.now());
  if (hold.confirmPending) throw problem('hire_desk_pending');
  if (status === 'Lapsed') throw problem('hold_lapsed');
  if (status !== 'Held') throw problem('hold_not_held');
  const quote = hold.quote;
  if (quote === null) throw problem('quote_required');
  if (!quote.matches) {
    throw problem('quote_total_mismatch', {
      placeholders: {
        'provider total': euros(quote.providerTotalCents),
        'computed total': euros(quote.totalCents),
      },
    });
  }
  const serial = hold.serial as string;
  const existing = await queryOne<{ location: string }>('select location from units where serial = $1', [serial]);
  if (existing !== null && existing.location !== RENTAL_HOUSE) throw problem('serial_already_in_kit');

  const answer = await askConfirm(hold.holdRef as string, quote.totalCents, confirmKey(holdId));
  if (answer.kind === 'answered') {
    await settleHired(holdId);
    return holdView(await requireHold(holdId), Date.now());
  }
  if (answer.kind === 'refused') {
    await transact(async (client) => {
      await setStatus(client, holdId, 'Lapsed');
      await clearPlacements(client, holdId);
    });
    throw problem('hold_lapsed');
  }
  await query(
    `update holds set confirm_pending = true, next_attempt_at = now() + interval '5 seconds' where id = $1`,
    [holdId],
  );
  throw problem('hire_desk_pending');
}

/** The desk's confirmation and the ledger posting are one fact. */
export async function settleHired(holdId: string): Promise<void> {
  await transact(async (client) => {
    const found = await client.query('select * from holds where id = $1 for update', [holdId]);
    const row = found.rows[0];
    if (row === undefined) return;
    const hold = toHold(row);
    if (hold.status === 'Hired in') return;
    const serial = hold.serial as string;
    await ensureBodyModel(client, hold.model);
    await client.query(
      `insert into units (serial, kind, model, location, hired, logged_hours)
       values ($1, 'body', $2, $3, true, $4)
       on conflict (serial) do update set hired = true`,
      [serial, hold.model, RENTAL_HOUSE, hold.loggedHours ?? '0'],
    );
    await postMovement(client, serial, 'hired_in', RENTAL_HOUSE, SHELF, null);
    await setStatus(client, holdId, 'Hired in', { confirm_pending: false });
    const drawn = await client.query(
      'update placements set body_serial = $2, hold_id = null where hold_id = $1 returning layout_id',
      [holdId, serial],
    );
    for (const layoutId of new Set(drawn.rows.map((entry) => entry['layout_id'] as string))) {
      await commitLayoutWrite(client, layoutId);
    }
  });
}

export async function releaseHold(holdId: string): Promise<HoldView> {
  const hold = await requireHold(holdId);
  const status = statusAt(hold, Date.now());
  if (status === 'Lapsed') throw problem('hold_lapsed');
  if (status !== 'Held' && status !== 'Asked') throw problem('hold_not_held');
  if (hold.holdRef !== null) {
    const answer = await askRelease(hold.holdRef);
    if (answer.kind !== 'answered') throw problem('hire_release_unavailable');
  }
  await transact(async (client) => {
    await setStatus(client, holdId, 'Released', { release_answered: true });
    await clearPlacements(client, holdId);
  });
  return holdView(await requireHold(holdId), Date.now());
}

/**
 * Commits Lapsed for a hold whose window has closed, under a row claim with a
 * lease and a fencing token so a stopped sweep's late writes are refused.
 */
export async function sweepLapses(): Promise<void> {
  const claimed = await query(
    `update holds set claim_until = now() + interval '10 seconds', fence = fence + 1
     where id in (
       select id from holds
       where status = 'Held' and confirm_pending = false and expires_at <= now()
         and (claim_until is null or claim_until < now())
       order by expires_at
       limit 20
       for update skip locked
     )
     returning id, hold_ref, fence`,
  );
  for (const row of claimed) {
    const holdId = row['id'] as string;
    const fence = String(row['fence']);
    await transact(async (client) => {
      const current = await client.query('select fence from holds where id = $1 for update', [holdId]);
      if (String(current.rows[0]?.['fence']) !== fence) return;
      await setStatus(client, holdId, 'Lapsed', { release_needed: true });
      await clearPlacements(client, holdId);
    });
  }
}

/** Converges every ambiguous desk outcome on the desk's own state. */
export async function reconcileHolds(): Promise<void> {
  const rows = await query(
    `select * from holds
     where next_attempt_at <= now()
       and (hand_back = true or confirm_pending = true or (release_needed = true and release_answered = false))
     order by next_attempt_at
     limit 20`,
  );
  for (const row of rows) {
    const hold = toHold(row);
    await query(`update holds set next_attempt_at = now() + interval '5 seconds' where id = $1`, [hold.id]);
    if (hold.confirmPending) {
      await reconcileConfirm(hold);
      continue;
    }
    if (hold.handBack) {
      await reconcileAsk(hold);
      continue;
    }
    await reconcileRelease(hold);
  }
}

async function reconcileConfirm(hold: HoldRecord): Promise<void> {
  const quote = hold.quote;
  if (quote === null) return;
  const answer = await askConfirm(hold.holdRef as string, quote.totalCents, confirmKey(hold.id));
  if (answer.kind === 'answered') {
    await settleHired(hold.id);
    return;
  }
  if (answer.kind === 'refused') {
    await transact(async (client) => {
      await setStatus(client, hold.id, 'Lapsed', { confirm_pending: false, release_answered: true });
      await clearPlacements(client, hold.id);
    });
  }
}

async function reconcileAsk(hold: HoldRecord): Promise<void> {
  const answer = await askHold(hold.model, hold.fromDay, hold.days, askKey(hold.id));
  if (answer.kind === 'answered') {
    const release = await askRelease(answer.value.holdRef);
    if (release.kind !== 'answered') {
      await query('update holds set hold_ref = $2, release_needed = true where id = $1', [
        hold.id,
        answer.value.holdRef,
      ]);
      return;
    }
    await transact(async (client) => {
      await setStatus(client, hold.id, 'Released', {
        hand_back: false,
        hold_ref: answer.value.holdRef,
        release_needed: false,
        release_answered: true,
      });
    });
    return;
  }
  if (answer.kind === 'refused') {
    await transact(async (client) => {
      await setStatus(client, hold.id, 'Released', { hand_back: false, release_answered: true });
    });
  }
}

async function reconcileRelease(hold: HoldRecord): Promise<void> {
  if (hold.holdRef === null) {
    await query('update holds set release_answered = true where id = $1', [hold.id]);
    return;
  }
  const answer = await askRelease(hold.holdRef);
  if (answer.kind === 'answered' || answer.kind === 'refused') {
    await query('update holds set release_answered = true, hand_back = false where id = $1', [hold.id]);
  }
}
