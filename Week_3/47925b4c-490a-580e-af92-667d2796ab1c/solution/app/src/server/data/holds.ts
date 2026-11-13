import { randomUUID } from 'node:crypto';
import { type Queryable, type Row, query, queryOne, transact } from '../db/pool.js';
import { euros } from '../domain/format.js';
import { type Quote, quoteFor } from '../domain/quotes.js';
import { writeEvent } from '../events/outbox.js';
import { problem } from '../http/problem.js';
import { askConfirm, askHold, askQuote, askRelease } from '../services/hiredesk.js';
import { commitLayoutWrite } from './layouts.js';
import { ensureBodyModel, postMovement, RENTAL_HOUSE, SHELF } from './kit.js';

type HoldStatus = 'Asked' | 'Held' | 'Hired in' | 'Lapsed' | 'Released';

interface HoldRecord {
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

interface HoldView {
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

function askKey(holdId: string): string {
  return `gevelwerk-ask-${holdId}`;
}

function confirmKey(holdId: string): string {
  return `gevelwerk-confirm-${holdId}`;
}

interface AskRequest {
  readonly model: string;
  readonly from: string;
  readonly days: number;
}

const LEASE_SECONDS = 10;
const REPLAY_SECONDS = 4;
const DUE_FOR_LAPSE = `status = 'Held' and confirm_pending = false and expires_at <= now()`;
const DUE_FOR_REPLAY = `next_attempt_at <= now()
  and (hand_back or confirm_pending or (release_needed and not release_answered))`;

export async function createHold(request: AskRequest): Promise<HoldView> {
  const id = randomUUID();
  await transact(async (client) => {
    await client.query(
      `insert into holds (id, status, model, from_day, days, hand_back, next_attempt_at)
       values ($1, 'Asked', $2, $3, $4, true, now() + interval '${REPLAY_SECONDS} seconds')`,
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
        hand_back: false,
      });
    });
    return holdView(await requireHold(id), Date.now());
  }
  if (answer.kind === 'unreachable' || (answer.kind === 'refused' && answer.status === 409)) {
    await transact(async (client) => {
      await setStatus(client, id, 'Released', { hand_back: false });
    });
    if (answer.kind === 'refused') throw problem('no_stock');
  }
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

/** Only a 200 hires the body in and only a 409 hold_expired lapses the hold; every other answer is ambiguous. */
type ConfirmOutcome = 'hired' | 'expired' | 'ambiguous';

function confirmOutcome(answer: Awaited<ReturnType<typeof askConfirm>>): ConfirmOutcome {
  if (answer.kind === 'answered' && answer.value.status === 'hired') return 'hired';
  if (answer.kind === 'refused' && answer.status === 409 && answer.error === 'hold_expired') return 'expired';
  return 'ambiguous';
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

  // The confirmation is unsettled from the moment it may reach the desk, so a stopped process leaves it to be replayed.
  const started = await query(
    `update holds set confirm_pending = true, next_attempt_at = now() + interval '${REPLAY_SECONDS} seconds'
     where id = $1 and status = 'Held' and confirm_pending = false and expires_at > now()
     returning id`,
    [holdId],
  );
  if (started.length === 0) {
    // The guarded update found the window closed or the confirmation taken by another request.
    const current = await requireHold(holdId);
    throw problem(
      current.confirmPending ? 'hire_desk_pending' : current.status === 'Held' || current.status === 'Lapsed' ? 'hold_lapsed' : 'hold_not_held',
    );
  }

  const outcome = confirmOutcome(await askConfirm(hold.holdRef as string, quote.totalCents, confirmKey(holdId)));
  if (outcome === 'hired') {
    await settleHired(holdId);
    return holdView(await requireHold(holdId), Date.now());
  }
  if (outcome === 'expired') {
    await transact((client) => settleLapsed(client, holdId));
    throw problem('hold_lapsed');
  }
  throw problem('hire_desk_pending');
}

/** The desk says the window closed: the hold lapses, with nothing left to release. */
async function settleLapsed(client: Queryable, holdId: string): Promise<void> {
  await setStatus(client, holdId, 'Lapsed', { confirm_pending: false, release_answered: true });
  await clearPlacements(client, holdId);
}

/** The desk's confirmation and the ledger posting are one fact. */
async function settleHired(holdId: string): Promise<void> {
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
    await setStatus(client, holdId, 'Released', { release_answered: hold.holdRef !== null });
    await clearPlacements(client, holdId);
  });
  return holdView(await requireHold(holdId), Date.now());
}

interface Claim {
  readonly id: string;
  readonly fence: string;
}

/**
 * Takes a lease on the holds a condition makes due, through SKIP LOCKED row claims,
 * so one process works each hold at a time. The fencing token it hands out lets the
 * committing transaction refuse a stopped claimant's late write.
 */
async function claimDue(due: string): Promise<Claim[]> {
  const rows = await query(
    `update holds set claim_until = now() + interval '${LEASE_SECONDS} seconds', fence = fence + 1,
       next_attempt_at = now() + interval '${REPLAY_SECONDS} seconds'
     where id in (
       select id from holds
       where ${due} and (claim_until is null or claim_until < now())
       order by created_at
       limit 20
       for update skip locked
     )
     returning id, fence`,
  );
  return rows.map((row) => ({ id: row['id'] as string, fence: String(row['fence']) }));
}

/** Runs a claimed hold's committing transaction only while its fencing token is still current. */
async function commitFenced(claim: Claim, write: (client: Queryable) => Promise<void>): Promise<void> {
  await transact(async (client) => {
    const current = await client.query('select 1 from holds where id = $1 and fence = $2 for update', [
      claim.id,
      claim.fence,
    ]);
    if (current.rows.length === 0) return;
    await write(client);
  });
}

async function endClaim(claim: Claim): Promise<void> {
  await query('update holds set claim_until = null where id = $1 and fence = $2', [claim.id, claim.fence]);
}

/** Commits Lapsed for every hold whose window has closed, once, on whichever process claims it first. */
export async function sweepLapses(): Promise<void> {
  for (const claim of await claimDue(DUE_FOR_LAPSE)) {
    await commitFenced(claim, async (client) => {
      await setStatus(client, claim.id, 'Lapsed', { release_needed: true, next_attempt_at: new Date().toISOString() });
      await clearPlacements(client, claim.id);
    });
    await endClaim(claim);
  }
}

const DESK_RETRY_MILLISECONDS = REPLAY_SECONDS * 1_000;
/** A process whose own route to the desk is refused waits before trying again; the holds stay free for any process that can reach it. */
let deskRetryAfter = 0;

/** Converges every ambiguous desk outcome on the desk's own state. */
export async function reconcileHolds(): Promise<void> {
  if (Date.now() < deskRetryAfter) return;
  for (const claim of await claimDue(DUE_FOR_REPLAY)) {
    const hold = await requireHold(claim.id);
    let reached: boolean;
    if (hold.confirmPending) reached = await reconcileConfirm(claim, hold);
    else if (hold.handBack) reached = await reconcileAsk(claim, hold);
    else reached = await reconcileRelease(claim, hold);
    if (!reached) {
      deskRetryAfter = Date.now() + DESK_RETRY_MILLISECONDS;
      await query('update holds set next_attempt_at = now() where id = $1 and fence = $2', [claim.id, claim.fence]);
    }
    await endClaim(claim);
  }
}

/** The desk was reached unless the connection was refused before anything was sent. */
function reachedDesk(answer: { readonly kind: string }): boolean {
  return answer.kind !== 'unreachable';
}

async function reconcileConfirm(claim: Claim, hold: HoldRecord): Promise<boolean> {
  const quote = hold.quote as Quote;
  const answer = await askConfirm(hold.holdRef as string, quote.totalCents, confirmKey(hold.id));
  const outcome = confirmOutcome(answer);
  if (outcome === 'hired') await settleHired(hold.id);
  else if (outcome === 'expired') await commitFenced(claim, (client) => settleLapsed(client, hold.id));
  return reachedDesk(answer);
}

async function reconcileAsk(claim: Claim, hold: HoldRecord): Promise<boolean> {
  const answer = await askHold(hold.model, hold.fromDay, hold.days, askKey(hold.id));
  if (answer.kind === 'refused' && answer.status === 409) {
    await commitFenced(claim, (client) => settleAsk(client, hold, { hand_back: false }));
  } else if (answer.kind === 'answered') {
    const release = await askRelease(answer.value.holdRef);
    const handedBack = release.kind === 'answered' || (release.kind === 'refused' && release.status < 500);
    await commitFenced(claim, (client) =>
      settleAsk(
        client,
        hold,
        handedBack
          ? { hand_back: false, hold_ref: answer.value.holdRef, release_answered: true }
          : { hand_back: false, hold_ref: answer.value.holdRef, release_needed: true },
      ),
    );
  }
  return reachedDesk(answer);
}

/** An ask settles as Released unless a granted hold still waits for its release to be answered. */
async function settleAsk(client: Queryable, hold: HoldRecord, patch: Readonly<Record<string, unknown>>): Promise<void> {
  const waitsForRelease = patch['release_needed'] === true;
  if (hold.status === 'Asked' && !waitsForRelease) await setStatus(client, hold.id, 'Released', patch);
  else {
    const members = Object.keys(patch);
    await client.query(
      `update holds set ${members.map((member, index) => `${member} = $${index + 2}`).join(', ')} where id = $1`,
      [hold.id, ...members.map((member) => patch[member])],
    );
  }
}

async function reconcileRelease(claim: Claim, hold: HoldRecord): Promise<boolean> {
  const answer = await askRelease(hold.holdRef as string);
  if (answer.kind === 'answered' || (answer.kind === 'refused' && answer.status < 500)) {
    await commitFenced(claim, (client) => settleAsk(client, hold, { release_answered: true, release_needed: false }));
  }
  return reachedDesk(answer);
}
