import type { Entry, Offer } from '../../shared/api';
import { seatLabel } from '../../shared/hall';
import { ORDER_FEE_CENTS, seatFeeCents } from '../../shared/money';
import { toIsoSeconds } from '../../shared/venueTime';
import { type Db, first, rows, withTransaction } from '../db';
import { buyerTopic, offerTopic, performanceTopic, recordChange } from '../live';
import { newUuid } from './ids';
import { EFFECTIVE_SEAT_STATE_SQL, SALES_OPEN_SQL } from './rules';
import { freeSeat, lockSeatRows } from './seats';

interface OfferRow {
  token: string;
  performance_id: string;
  seat_id: string;
  tier_name: string;
  face_cents: number;
  status: Offer['status'];
  expires_at: Date;
  seconds_left: number;
}

const OFFER_SQL = `select f.token, f.performance_id, f.seat_id, t.name as tier_name, t.face_cents,
    case when f.status = 'open' and f.expires_at <= now() and f.pending_order_id is null then 'expired'
         else f.status end as status,
    f.expires_at,
    greatest(0, ceil(extract(epoch from (f.expires_at - now()))))::int as seconds_left
  from offers f
  join tiers t on t.performance_id = f.performance_id and t.tier_id = f.tier_id`;

function toOffer(row: OfferRow): Offer {
  const faceCents = row.face_cents;
  const feeCents = seatFeeCents(faceCents);
  return {
    token: row.token,
    performanceId: row.performance_id,
    seatId: row.seat_id,
    label: seatLabel(row.seat_id),
    tierName: row.tier_name,
    faceCents,
    seatFeeCents: feeCents,
    orderFeeCents: ORDER_FEE_CENTS,
    totalCents: faceCents + feeCents + ORDER_FEE_CENTS,
    status: row.status,
    expiresAt: toIsoSeconds(row.expires_at),
    secondsLeft: row.seconds_left,
  };
}

export async function loadOffer(db: Db, token: string): Promise<Offer | undefined> {
  const row = await first<OfferRow>(db, `${OFFER_SQL} where f.token = $1`, [token]);
  return row ? toOffer(row) : undefined;
}

interface EntryRow {
  id: string;
  performance_id: string;
  tier_id: string;
  tier_name: string;
  status: Entry['status'];
  position: string | null;
  offer_token: string | null;
}

const ENTRY_SQL = `select e.id, e.performance_id, e.tier_id, t.name as tier_name, e.status,
    case when e.status = 'waiting' then (
      select count(*) + 1 from waitlist_entries w
      where w.performance_id = e.performance_id and w.tier_id = e.tier_id and w.status = 'waiting'
        and (w.joined_at, w.seq) < (e.joined_at, e.seq)) end as position,
    (select f.token from offers f where f.entry_id = e.id order by f.created_at desc, f.token limit 1) as offer_token
  from waitlist_entries e
  join tiers t on t.performance_id = e.performance_id and t.tier_id = e.tier_id`;

async function toEntry(db: Db, row: EntryRow): Promise<Entry> {
  return {
    id: row.id,
    performanceId: row.performance_id,
    tierId: row.tier_id,
    tierName: row.tier_name,
    position: row.position === null ? null : Number(row.position),
    status: row.status,
    offer: row.offer_token === null ? null : ((await loadOffer(db, row.offer_token)) ?? null),
  };
}

export async function loadEntries(db: Db, buyerId: string): Promise<Entry[]> {
  const entryRows = await rows<EntryRow>(
    db,
    `${ENTRY_SQL} where e.buyer_id = $1 order by e.joined_at desc, e.seq desc`,
    [buyerId],
  );
  return Promise.all(entryRows.map((row) => toEntry(db, row)));
}

export type JoinResult =
  | { readonly kind: 'joined'; readonly entry: Entry }
  | { readonly kind: 'sales_closed' }
  | { readonly kind: 'tier_not_sold_out' }
  | { readonly kind: 'already_waiting' }
  | { readonly kind: 'invalid' };

export async function joinWaitlist(input: {
  readonly performanceId: string;
  readonly tierId: string;
  readonly buyerId: string;
  readonly name: string;
  readonly email: string;
  readonly fieldErrors: Readonly<Record<string, string>>;
}): Promise<JoinResult> {
  return withTransaction(async (db) => {
    const performance = await first<{ sales_open: boolean }>(
      db,
      `select (${SALES_OPEN_SQL}) as sales_open from performances p where p.id = $1`,
      [input.performanceId],
    );
    if (!performance?.sales_open) return { kind: 'sales_closed' };
    await db.query(`select pg_advisory_xact_lock(hashtext($1)::bigint)`, [`${input.performanceId}:${input.tierId}`]);
    const remaining = await first<{ count: string }>(
      db,
      `select count(*) as count from seats s
       where s.performance_id = $1 and s.tier_id = $2 and ${EFFECTIVE_SEAT_STATE_SQL} = 'on_sale'`,
      [input.performanceId, input.tierId],
    );
    if (Number(remaining?.count ?? 0) > 0) return { kind: 'tier_not_sold_out' };
    const waiting = await first<{ id: string }>(
      db,
      `select id from waitlist_entries
       where performance_id = $1 and tier_id = $2 and email_lower = $3 and status in ('waiting', 'offered')`,
      [input.performanceId, input.tierId, input.email.trim().toLowerCase()],
    );
    if (waiting) return { kind: 'already_waiting' };
    if (Object.keys(input.fieldErrors).length > 0) return { kind: 'invalid' };
    const entryId = newUuid();
    await db.query(
      `insert into waitlist_entries (id, performance_id, tier_id, buyer_id, name, email, email_lower, status)
       values ($1, $2, $3, $4, $5, $6, $7, 'waiting')`,
      [
        entryId,
        input.performanceId,
        input.tierId,
        input.buyerId,
        input.name.trim(),
        input.email.trim(),
        input.email.trim().toLowerCase(),
      ],
    );
    await recordChange(db, [performanceTopic(input.performanceId), buyerTopic(input.buyerId)]);
    const row = await first<EntryRow>(db, `${ENTRY_SQL} where e.id = $1`, [entryId]);
    if (!row) return { kind: 'invalid' };
    return { kind: 'joined', entry: await toEntry(db, row) };
  });
}

export type DeclineResult =
  | { readonly kind: 'declined'; readonly offer: Offer }
  | { readonly kind: 'offer_closed' }
  | { readonly kind: 'offer_expired' }
  | { readonly kind: 'not_found' };

export async function declineOffer(token: string): Promise<DeclineResult> {
  return withTransaction(async (db) => {
    const offer = await first<{
      token: string;
      performance_id: string;
      seat_id: string;
      status: string;
      expired: boolean;
      entry_id: string;
      buyer_id: string;
    }>(
      db,
      `select f.token, f.performance_id, f.seat_id, f.status, (f.expires_at <= now()) as expired, f.entry_id,
              w.buyer_id
       from offers f join waitlist_entries w on w.id = f.entry_id
       where f.token = $1
       for update of f`,
      [token],
    );
    if (!offer) return { kind: 'not_found' };
    const topics = [performanceTopic(offer.performance_id), buyerTopic(offer.buyer_id), offerTopic(token)];
    if (offer.status !== 'open') {
      return { kind: offer.status === 'expired' ? 'offer_expired' : 'offer_closed' };
    }
    if (offer.expired) {
      await db.query(`update offers set status = 'expired' where token = $1`, [token]);
      await db.query(`update waitlist_entries set status = 'expired' where id = $1`, [offer.entry_id]);
      await lockSeatRows(db, offer.performance_id, [offer.seat_id]);
      await freeSeat(db, offer.performance_id, offer.seat_id);
      await recordChange(db, topics);
      return { kind: 'offer_expired' };
    }
    await db.query(`update offers set status = 'declined' where token = $1`, [token]);
    await db.query(`update waitlist_entries set status = 'declined' where id = $1`, [offer.entry_id]);
    await lockSeatRows(db, offer.performance_id, [offer.seat_id]);
    await freeSeat(db, offer.performance_id, offer.seat_id);
    await recordChange(db, topics);
    const declined = await loadOffer(db, token);
    return declined ? { kind: 'declined', offer: declined } : { kind: 'not_found' };
  });
}
