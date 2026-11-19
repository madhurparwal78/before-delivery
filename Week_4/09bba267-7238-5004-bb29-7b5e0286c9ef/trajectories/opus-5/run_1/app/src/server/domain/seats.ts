import type { Seat } from '../../shared/api';
import { HALL_SEATS, hallSeat } from '../../shared/hall';
import { ORDER_FEE_CENTS, seatFeeCents } from '../../shared/money';
import { config } from '../config';
import { type Db, first, rows } from '../db';
import { recordChange, buyerTopic, offerTopic, performanceTopic } from '../live';
import { enqueueMessage } from '../services/outbox';
import { offerMessage } from '../services/messages';
import { newToken } from './ids';
import { EFFECTIVE_SEAT_STATE_SQL, SALES_OPEN_SQL } from './rules';

export type HoldKind = 'cart' | 'exchange';

export interface SeatRow {
  seat_id: string;
  tier_id: string | null;
  state: string;
  effective_state: string;
  hold_buyer_id: string | null;
  hold_kind: string | null;
  offer_token: string | null;
}

const SEAT_COLUMNS = `s.seat_id, s.tier_id, s.state, ${EFFECTIVE_SEAT_STATE_SQL} as effective_state,
  s.hold_buyer_id, s.hold_kind, s.offer_token`;

export async function lockSeatRows(db: Db, performanceId: string, seatIds: readonly string[]): Promise<SeatRow[]> {
  return rows<SeatRow>(
    db,
    `select ${SEAT_COLUMNS} from seats s
     where s.performance_id = $1 and s.seat_id = any($2::text[])
     order by s.seat_id
     for update`,
    [performanceId, [...seatIds]],
  );
}

export async function holdSeatRow(
  db: Db,
  performanceId: string,
  seatId: string,
  buyerId: string,
  kind: HoldKind,
  expiresAt: Date | null,
): Promise<void> {
  await db.query(
    `update seats set state = 'held', hold_buyer_id = $3, hold_kind = $4, offer_token = null,
       hold_expires_at = coalesce($5::timestamptz, now() + ($6 || ' seconds')::interval)
     where performance_id = $1 and seat_id = $2`,
    [performanceId, seatId, buyerId, kind, expiresAt, String(config.holdSeconds)],
  );
}

export async function markSeatSold(db: Db, performanceId: string, seatId: string): Promise<void> {
  await db.query(
    `update seats set state = 'sold', hold_buyer_id = null, hold_kind = null, hold_expires_at = null,
       offer_token = null, pending_order_id = null
     where performance_id = $1 and seat_id = $2`,
    [performanceId, seatId],
  );
}

/** Keeps a seat out of the expiry sweep while its payment is with Kill Bill. */
export async function markPaymentPending(
  db: Db,
  performanceId: string,
  seatIds: readonly string[],
  orderId: string | null,
): Promise<void> {
  await db.query(`update seats set pending_order_id = $3 where performance_id = $1 and seat_id = any($2::text[])`, [
    performanceId,
    [...seatIds],
    orderId,
  ]);
}

interface NextEntryRow {
  id: string;
  buyer_id: string;
  name: string;
  email: string;
}

interface FreedSeatContext {
  title: string;
  starts_at: Date;
  sales_open: boolean;
  tier_id: string | null;
  tier_name: string | null;
  face_cents: number | null;
}

/**
 * Returns a seat to sale, or offers it to the earliest waiting entry of its tier while sales are
 * open. This is the only place that decides between `on_sale` and `offered`.
 */
export async function freeSeat(db: Db, performanceId: string, seatId: string): Promise<void> {
  const context = await first<FreedSeatContext>(
    db,
    `select p.title, p.starts_at, (${SALES_OPEN_SQL}) as sales_open, s.tier_id, t.name as tier_name,
            t.face_cents
     from seats s
     join performances p on p.id = s.performance_id
     left join tiers t on t.performance_id = s.performance_id and t.tier_id = s.tier_id
     where s.performance_id = $1 and s.seat_id = $2
     for update of s`,
    [performanceId, seatId],
  );
  const topics = [performanceTopic(performanceId)];
  if (context && context.sales_open && context.tier_id !== null) {
    await db.query(`select pg_advisory_xact_lock(hashtext($1)::bigint)`, [`${performanceId}:${context.tier_id}`]);
    const entry = await first<NextEntryRow>(
      db,
      `select id, buyer_id, name, email from waitlist_entries
       where performance_id = $1 and tier_id = $2 and status = 'waiting'
       order by joined_at, seq
       limit 1`,
      [performanceId, context.tier_id],
    );
    if (entry) {
      const token = newToken();
      const offer = await first<{ expires_at: Date }>(
        db,
        `insert into offers (token, entry_id, performance_id, tier_id, seat_id, status, expires_at)
         values ($1, $2, $3, $4, $5, 'open', now() + ($6 || ' seconds')::interval)
         returning expires_at`,
        [token, entry.id, performanceId, context.tier_id, seatId, String(config.offerSeconds)],
      );
      await db.query(`update waitlist_entries set status = 'offered' where id = $1`, [entry.id]);
      await db.query(
        `update seats set state = 'offered', offer_token = $3, hold_buyer_id = null, hold_kind = null,
           hold_expires_at = null
         where performance_id = $1 and seat_id = $2`,
        [performanceId, seatId, token],
      );
      const faceCents = context.face_cents ?? 0;
      await enqueueMessage(
        db,
        offerMessage({
          email: entry.email,
          seatLabel: hallSeat(seatId)?.label ?? seatId,
          performanceTitle: context.title,
          startsAt: context.starts_at,
          totalCents: faceCents + seatFeeCents(faceCents) + ORDER_FEE_CENTS,
          expiresAt: offer?.expires_at ?? new Date(),
          token,
        }),
      );
      await recordChange(db, [...topics, buyerTopic(entry.buyer_id), offerTopic(token)]);
      return;
    }
  }
  await db.query(
    `update seats set state = case when tier_id is null then 'not_on_sale' else 'on_sale' end,
       hold_buyer_id = null, hold_kind = null, hold_expires_at = null, offer_token = null,
       pending_order_id = null
     where performance_id = $1 and seat_id = $2`,
    [performanceId, seatId],
  );
  await recordChange(db, topics);
}

interface SeatStateRow {
  seat_id: string;
  tier_id: string | null;
  state: string;
  mine: boolean | null;
}

export async function loadSeats(db: Db, performanceId: string, buyerId: string): Promise<Seat[]> {
  const stateRows = await rows<SeatStateRow>(
    db,
    `select s.seat_id, s.tier_id, ${EFFECTIVE_SEAT_STATE_SQL} as state,
       case
         when ${EFFECTIVE_SEAT_STATE_SQL} = 'held' then (s.hold_buyer_id = $2)
         when s.state = 'sold' then exists (
           select 1 from tickets tk join orders o on o.id = tk.order_id
           where tk.performance_id = s.performance_id and tk.seat_id = s.seat_id
             and tk.status in ('issued', 'exchange_pending', 'refund_pending') and o.buyer_id = $2)
         when s.state = 'offered' then exists (
           select 1 from offers f join waitlist_entries w on w.id = f.entry_id
           where f.token = s.offer_token and w.buyer_id = $2)
         else false
       end as mine
     from seats s
     where s.performance_id = $1`,
    [performanceId, buyerId],
  );
  const byId = new Map(stateRows.map((row) => [row.seat_id, row]));
  return HALL_SEATS.map((seat) => {
    const row = byId.get(seat.id);
    return {
      id: seat.id,
      section: seat.section,
      row: seat.row,
      number: seat.number,
      label: seat.label,
      tierId: row?.tier_id ?? null,
      state: (row?.state ?? 'not_on_sale') as Seat['state'],
      mine: row?.mine === true,
      offCentreDeg: seat.offCentreDeg,
      stageDistanceM: seat.stageDistanceM,
    };
  });
}

interface ExpiredHoldRow {
  performance_id: string;
  seat_id: string;
  hold_buyer_id: string | null;
}

export async function releaseExpiredHolds(db: Db, performanceId: string | null): Promise<void> {
  const expired = await rows<ExpiredHoldRow>(
    db,
    `select s.performance_id, s.seat_id, s.hold_buyer_id from seats s
     where s.state = 'held' and s.hold_expires_at <= now() and s.pending_order_id is null
       and ($1::text is null or s.performance_id = $1)
     order by s.performance_id, s.seat_id
     for update skip locked`,
    [performanceId],
  );
  for (const seat of expired) {
    await freeSeat(db, seat.performance_id, seat.seat_id);
    if (seat.hold_buyer_id !== null) await recordChange(db, [buyerTopic(seat.hold_buyer_id)]);
  }
}

interface EndingOfferRow {
  token: string;
  performance_id: string;
  seat_id: string;
  entry_id: string;
  buyer_id: string;
}

async function endOffers(db: Db, condition: string): Promise<void> {
  const ending = await rows<EndingOfferRow>(
    db,
    `select f.token, f.performance_id, f.seat_id, f.entry_id, w.buyer_id
     from offers f
     join waitlist_entries w on w.id = f.entry_id
     join performances p on p.id = f.performance_id
     where f.status = 'open' and f.pending_order_id is null and ${condition}
     order by f.token
     for update of f skip locked`,
  );
  for (const offer of ending) {
    await db.query(`update offers set status = 'expired' where token = $1`, [offer.token]);
    await db.query(`update waitlist_entries set status = 'expired' where id = $1`, [offer.entry_id]);
    await freeSeat(db, offer.performance_id, offer.seat_id);
    await recordChange(db, [offerTopic(offer.token), buyerTopic(offer.buyer_id)]);
  }
}

export async function endExpiredOffers(db: Db): Promise<void> {
  await endOffers(db, 'f.expires_at <= now()');
}

export async function endOffersForClosedSales(db: Db): Promise<void> {
  await endOffers(db, `not (${SALES_OPEN_SQL})`);
}
