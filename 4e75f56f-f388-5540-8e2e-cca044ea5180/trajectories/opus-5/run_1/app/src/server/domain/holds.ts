import type { PoolClient } from 'pg';
import { ATELIER_CAP, tierOfBench, type Tier } from '../../shared/benches.js';
import { config } from '../config.js';
import type { Account } from '../db/accounts.js';
import { newId } from '../db/ids.js';
import { pool, withLedgerLock, type Queryable } from '../db/pool.js';
import type { ReservationRow } from '../db/reservations.js';
import { computeLedger, tierHasHoldableBench, type Ledger } from './ledger.js';
import { queueWaitlistOffer } from './notifications.js';
import { PRICES } from '../../shared/prices.js';
import { SOLD_STATES } from './reservationState.js';

export interface FreedBench {
  readonly bench: string;
  readonly tier: Tier;
}

interface OfferRow {
  id: string;
  entry_id: string;
  account_id: string;
  bench: string;
  tier: Tier;
}

async function firstWaitlistEntry(
  client: Queryable,
  tier: Tier,
): Promise<{ id: string; account_id: string; email: string } | null> {
  const result = await client.query<{ id: string; account_id: string; email: string }>(
    `select w.id, w.account_id, a.email
     from waitlist_entries w join accounts a on a.id = w.account_id
     where w.tier = $1 and w.state = 'waitlisted'
     order by w.seq
     limit 1`,
    [tier],
  );
  return result.rows[0] ?? null;
}

/** Offers one freed bench to the first waitlisted buyer for its tier, if any. */
async function offerFreedBench(client: PoolClient, freed: FreedBench): Promise<boolean> {
  const ledger = await computeLedger(client, null);
  const bench = ledger.benches.find((candidate) => candidate.label === freed.bench);
  if (bench === undefined || bench.state !== 'open') return false;
  if (freed.tier === 'atelier' && ledger.tiers.atelier.active >= ATELIER_CAP) return false;

  const entry = await firstWaitlistEntry(client, freed.tier);
  if (entry === null) return false;

  const offerId = newId('off');
  await client.query(
    `insert into offers (id, entry_id, account_id, bench, tier, state, duration_seconds, expires_at)
     values ($1, $2, $3, $4, $5, 'offered', $6, now() + make_interval(secs => $6::int))`,
    [offerId, entry.id, entry.account_id, freed.bench, freed.tier, config.offerSeconds],
  );
  await client.query(`update waitlist_entries set state = 'offered' where id = $1`, [entry.id]);
  await queueWaitlistOffer(client, offerId, entry.email, freed.bench);
  return true;
}

export async function offerFreedBenches(
  client: PoolClient,
  freed: readonly FreedBench[],
): Promise<void> {
  for (const bench of freed) {
    await offerFreedBench(client, bench);
  }
}

/**
 * Releases every hold and offer whose window has passed and hands the freed
 * benches to the waitlist. Runs inside the ledger lock.
 */
export async function sweepLedger(client: PoolClient): Promise<void> {
  const freed: FreedBench[] = [];

  const lapsed = await client.query<OfferRow>(
    `update offers set state = 'lapsed'
     where state = 'offered' and expires_at <= now()
     returning id, entry_id, account_id, bench, tier`,
  );
  for (const offer of lapsed.rows) {
    await client.query(`update waitlist_entries set state = 'offer_lapsed' where id = $1`, [
      offer.entry_id,
    ]);
    freed.push({ bench: offer.bench, tier: offer.tier });
  }

  const expired = await client.query<{ id: string; bench: string; tier: Tier; group_id: string | null }>(
    `update reservations
     set state = 'released', hold_expires_at = null, hold_duration_seconds = null
     where state = 'held'
       and hold_expires_at <= now()
       and payment_in_flight is null
       and payment_pending is null
     returning id, bench, tier, group_id`,
  );
  const groupIds = new Set<string>();
  for (const reservation of expired.rows) {
    freed.push({ bench: reservation.bench, tier: reservation.tier });
    if (reservation.group_id !== null) groupIds.add(reservation.group_id);
  }
  for (const groupId of groupIds) {
    await client.query(`update groups set state = 'released' where id = $1 and state = 'held'`, [
      groupId,
    ]);
  }

  await offerFreedBenches(client, freed);
}

/** Cheap check so reads only take the ledger lock when something has lapsed. */
export async function sweepIfDue(): Promise<void> {
  const result = await pool.query<{ due: boolean }>(
    `select (
       exists(select 1 from reservations
              where state = 'held' and hold_expires_at <= now()
                and payment_in_flight is null and payment_pending is null)
       or exists(select 1 from offers where state = 'offered' and expires_at <= now())
     ) as due`,
  );
  if (result.rows[0]?.due !== true) return;
  await withLedgerLock(sweepLedger);
}

export type ClaimConflictCode = 'bench_taken' | 'atelier_sold_out';

export interface ClaimConflict {
  readonly code: ClaimConflictCode;
  readonly tier: Tier;
  readonly open: boolean;
  readonly ledger: Ledger;
}

export interface ClaimResult {
  readonly reservations: readonly ReservationRow[];
  readonly groupId: string | null;
  readonly ledger: Ledger;
}

function conflictFor(ledger: Ledger, code: ClaimConflictCode, tier: Tier): ClaimConflict {
  return { code, tier, open: !tierHasHoldableBench(ledger, tier), ledger };
}

/** True when this practitioner may not take another seat. */
export async function practitionerAlreadyEngaged(
  client: Queryable,
  accountId: string,
): Promise<boolean> {
  const result = await client.query<{ engaged: boolean }>(
    `select (
       exists(select 1 from reservations
              where (buyer_id = $1 or attendee_account_id = $1)
                and (state = any($2::text[])
                     or (state = 'held'
                         and (hold_expires_at > now()
                              or payment_in_flight is not null
                              or payment_pending is not null))))
       or exists(select 1 from offers where account_id = $1 and state = 'offered' and expires_at > now())
       or exists(select 1 from waitlist_entries where account_id = $1 and state = 'waitlisted')
     ) as engaged`,
    [accountId, SOLD_STATES],
  );
  return result.rows[0]?.engaged === true;
}

export async function clinicHasLiveGroupHold(client: Queryable, accountId: string): Promise<boolean> {
  const result = await client.query<{ live: boolean }>(
    `select exists(
       select 1 from reservations
       where buyer_id = $1 and group_id is not null and state = 'held'
         and (hold_expires_at > now() or payment_in_flight is not null or payment_pending is not null)
     ) as live`,
    [accountId],
  );
  return result.rows[0]?.live === true;
}

export interface ClaimOptions {
  readonly asGroup: boolean;
}

/**
 * Claims benches and, for rows A and B, Atelier places in one atomic step.
 * Of several simultaneous claims on the same bench exactly one succeeds.
 */
export async function claimBenches(
  client: PoolClient,
  buyer: Account,
  benches: readonly string[],
  options: ClaimOptions,
): Promise<ClaimResult | ClaimConflict> {
  const ledger = await computeLedger(client, buyer.id);

  const unavailable = benches.find((label) => {
    const bench = ledger.benches.find((candidate) => candidate.label === label);
    return bench === undefined || bench.state !== 'open';
  });
  if (unavailable !== undefined) {
    return conflictFor(ledger, 'bench_taken', tierOfBench(unavailable));
  }

  const atelierWanted = benches.filter((label) => tierOfBench(label) === 'atelier').length;
  if (atelierWanted > 0 && ledger.tiers.atelier.active + atelierWanted > ATELIER_CAP) {
    return conflictFor(ledger, 'atelier_sold_out', 'atelier');
  }

  const groupId = options.asGroup ? newId('grp') : null;
  if (groupId !== null) {
    await client.query(`insert into groups (id, buyer_id, state) values ($1, $2, 'held')`, [
      groupId,
      buyer.id,
    ]);
  }

  const isPractitioner = buyer.role === 'practitioner';
  const created: ReservationRow[] = [];
  for (const label of benches) {
    const tier = tierOfBench(label);
    const insert = await client.query<ReservationRow>(
      `insert into reservations (
         id, bench, tier, state, group_id, buyer_id, price_cents,
         hold_expires_at, hold_duration_seconds,
         assignee_name, assignee_email, assignee_email_lower, assignee_accepted, attendee_account_id)
       values ($1, $2, $3, 'held', $4, $5, $6,
         now() + make_interval(secs => $7::int), $7,
         $8, $9, $10, $11, $12)
       returning *`,
      [
        newId('res'),
        label,
        tier,
        groupId,
        buyer.id,
        PRICES[tier].fullCents,
        config.holdSeconds,
        isPractitioner ? buyer.name : null,
        isPractitioner ? buyer.email : null,
        isPractitioner ? buyer.email.toLowerCase() : null,
        isPractitioner,
        isPractitioner ? buyer.id : null,
      ],
    );
    created.push(insert.rows[0] as ReservationRow);
  }

  const after = await computeLedger(client, buyer.id);
  return { reservations: created, groupId, ledger: after };
}

export async function releaseReservations(
  client: PoolClient,
  reservations: readonly { id: string; bench: string; tier: Tier }[],
): Promise<void> {
  if (reservations.length === 0) return;
  await client.query(
    `update reservations
     set state = 'released', hold_expires_at = null, hold_duration_seconds = null
     where id = any($1::text[])`,
    [reservations.map((reservation) => reservation.id)],
  );
  await offerFreedBenches(
    client,
    reservations.map((reservation) => ({ bench: reservation.bench, tier: reservation.tier })),
  );
}

export async function waitlistPosition(
  client: Queryable,
  entryId: string,
): Promise<{ tier: Tier; position: number } | null> {
  const result = await client.query<{ tier: Tier; position: string }>(
    `select w.tier,
       (select count(*) + 1 from waitlist_entries e
        where e.tier = w.tier and e.state = 'waitlisted' and e.seq < w.seq) as position
     from waitlist_entries w
     where w.id = $1 and w.state = 'waitlisted'`,
    [entryId],
  );
  const row = result.rows[0];
  return row === undefined ? null : { tier: row.tier, position: Number.parseInt(row.position, 10) };
}

export async function activeWaitlistEntry(
  client: Queryable,
  accountId: string,
): Promise<{ id: string; tier: Tier } | null> {
  const result = await client.query<{ id: string; tier: Tier }>(
    `select id, tier from waitlist_entries
     where account_id = $1 and state = 'waitlisted'
     order by seq desc limit 1`,
    [accountId],
  );
  return result.rows[0] ?? null;
}
