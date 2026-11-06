import type { Tier } from '../../shared/benches.js';
import type { PaymentKind, ReservationState } from '../domain/reservationState.js';
import type { Queryable } from './pool.js';

export interface ReservationRow {
  id: string;
  bench: string;
  tier: Tier;
  state: ReservationState;
  group_id: string | null;
  buyer_id: string;
  price_cents: number;
  hold_expires_at: Date | null;
  hold_duration_seconds: number | null;
  payment_in_flight: PaymentKind | null;
  payment_pending: PaymentKind | null;
  assignee_name: string | null;
  assignee_email: string | null;
  assignee_email_lower: string | null;
  assignee_accepted: boolean;
  attendee_account_id: string | null;
  refund_due_cents: number | null;
  upgrade_from_bench: string | null;
  assignment_seq: number;
  cancelled_at: Date | null;
}

export interface ReservationDetail extends ReservationRow {
  buyer_name: string;
  buyer_email: string;
  buyer_role: string;
  buyer_clinic: string | null;
  purchased_cents: number;
  refunded_cents: number;
  documents: string[];
  licence_status: 'submitted' | 'matched' | 'rejected' | null;
  has_passport: boolean;
  day1: boolean;
  day2: boolean;
}

export interface ReservationJson {
  id: string;
  bench: string;
  tier: Tier;
  state: ReservationState;
  group_id: string | null;
  buyer: { name: string; kind: 'practitioner' | 'clinic' };
  attendee: { name: string; email: string; accepted: boolean } | null;
  price_cents: number;
  paid_cents: number;
  balance_cents: number;
  refund_due_cents: number | null;
  hold: { expires_at: string; seconds_remaining: number; duration_seconds: number } | null;
  payment_pending: PaymentKind | null;
  licence_status: 'none' | 'submitted' | 'matched' | 'rejected';
  passport_status: 'none' | 'submitted';
  checked_in: { day1: boolean; day2: boolean };
  documents: string[];
}

const DETAIL_SELECT = `
  select r.*,
    b.name as buyer_name,
    b.email as buyer_email,
    b.role as buyer_role,
    b.clinic_name as buyer_clinic,
    coalesce((select sum(pi.amount_cents) from payment_items pi where pi.reservation_id = r.id), 0)::int
      as purchased_cents,
    coalesce((select sum(rf.amount_cents) from refunds rf where rf.reservation_id = r.id), 0)::int
      as refunded_cents,
    coalesce((select json_agg(d.kind order by d.created_at) from documents d where d.reservation_id = r.id),
      '[]'::json) as documents,
    (select l.status from licences l where l.reservation_id = r.id) as licence_status,
    exists(select 1 from passports p where p.reservation_id = r.id) as has_passport,
    exists(select 1 from checkins c where c.reservation_id = r.id and c.day = 1) as day1,
    exists(select 1 from checkins c where c.reservation_id = r.id and c.day = 2) as day2
  from reservations r
  join accounts b on b.id = r.buyer_id
`;

export async function loadReservation(
  client: Queryable,
  id: string,
): Promise<ReservationDetail | null> {
  const result = await client.query<ReservationDetail>(`${DETAIL_SELECT} where r.id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function loadReservationsByIds(
  client: Queryable,
  ids: readonly string[],
): Promise<ReservationDetail[]> {
  if (ids.length === 0) return [];
  const result = await client.query<ReservationDetail>(
    `${DETAIL_SELECT} where r.id = any($1::text[]) order by r.bench`,
    [ids],
  );
  return result.rows;
}

export async function loadReservationsForAccount(
  client: Queryable,
  accountId: string,
): Promise<ReservationDetail[]> {
  const result = await client.query<ReservationDetail>(
    `${DETAIL_SELECT}
     where (r.buyer_id = $1 or r.attendee_account_id = $1)
       and r.state <> 'released'
     order by r.bench`,
    [accountId],
  );
  return result.rows;
}

export async function loadReservationsForGroup(
  client: Queryable,
  groupId: string,
): Promise<ReservationDetail[]> {
  const result = await client.query<ReservationDetail>(
    `${DETAIL_SELECT} where r.group_id = $1 order by r.bench`,
    [groupId],
  );
  return result.rows;
}

export function secondsRemaining(expiresAt: Date, at: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - at.getTime()) / 1000));
}

export function serializeReservation(row: ReservationDetail, at: Date): ReservationJson {
  const hold =
    row.state === 'held' && row.hold_expires_at !== null && row.hold_duration_seconds !== null
      ? {
          expires_at: row.hold_expires_at.toISOString(),
          seconds_remaining: secondsRemaining(row.hold_expires_at, at),
          duration_seconds: row.hold_duration_seconds,
        }
      : null;
  const attendee =
    row.assignee_name !== null && row.assignee_email !== null
      ? { name: row.assignee_name, email: row.assignee_email, accepted: row.assignee_accepted }
      : null;
  return {
    id: row.id,
    bench: row.bench,
    tier: row.tier,
    state: row.state,
    group_id: row.group_id,
    buyer: {
      name: row.buyer_role === 'clinic' ? (row.buyer_clinic ?? row.buyer_name) : row.buyer_name,
      kind: row.buyer_role === 'clinic' ? 'clinic' : 'practitioner',
    },
    attendee,
    price_cents: row.price_cents,
    paid_cents: row.purchased_cents - row.refunded_cents,
    balance_cents: row.price_cents - row.purchased_cents,
    refund_due_cents: row.refund_due_cents,
    hold,
    payment_pending: row.payment_pending,
    licence_status: row.licence_status ?? 'none',
    passport_status: row.has_passport ? 'submitted' : 'none',
    checked_in: { day1: row.day1, day2: row.day2 },
    documents: row.documents,
  };
}
