import { randomBytes } from 'node:crypto';
import {
  CredentialType,
  GateResult,
  RequestObject,
  RequestStatus,
  SeatStatus,
} from '../../shared/types';
import { toIsoWithOffset } from '../../shared/time';
import { Db, pool, query, queryOne, withTransaction } from '../db/pool';
import { fail, notFound, seatTaken, invalidTransition, gateFailed } from '../http/errors';
import { queueEmail } from '../services/mail';
import { offerEmail } from '../services/notifications';
import { writeAudit } from './audit';
import {
  DISPATCHABLE_STATUSES,
  GateCommitment,
  GateInput,
  deriveRequestStatus,
  evaluateGates,
  offerExpiresAt,
} from './rules';
import { RequestRow, loadRequestRow, serializeRequest } from './requests';
import { expireDueOffersForSeat } from './offers';

interface SeatContext {
  seatId: string;
  position: number;
  seatStatus: SeatStatus;
  total: number;
  request: RequestRow;
  liveOffer: { id: string; status: string; holderId: string; holderName: string } | null;
  derivedStatus: RequestStatus;
}

interface SeatContextRow {
  seat_id: string;
  position: number;
  seat_status: SeatStatus;
  total: number;
  request_id: string;
  offer_id: string | null;
  offer_status: string | null;
  expires_at: Date | null;
  held_by: string | null;
  holder_name: string | null;
  seats_accepted: number;
  approved: number;
}

const SEAT_CONTEXT_SQL = `
  select s.id as seat_id, s.position, s.status as seat_status, s.request_id,
         (select count(*)::int from seats x where x.request_id = s.request_id) as total,
         (select count(*)::int from seats x where x.request_id = s.request_id and x.status = 'accepted')
           as seats_accepted,
         (select count(*)::int from seats x
            join timesheets t on t.seat_id = x.id
            where x.request_id = s.request_id and t.status = 'approved') as approved,
         o.id as offer_id, o.status as offer_status, o.expires_at, o.held_by, h.name as holder_name
  from seats s
  left join offers o on o.seat_id = s.id and o.status in ('active', 'accepted')
  left join users h on h.id = o.held_by
  where s.id = $1`;

async function loadSeatContext(
  db: Db,
  seatId: string,
  now: Date,
): Promise<SeatContext | null> {
  if (!/^[0-9a-f-]{36}$/i.test(seatId)) return null;
  const row = await queryOne<SeatContextRow>(db, SEAT_CONTEXT_SQL, [seatId]);
  if (!row) return null;
  const request = await loadRequestRow(db, row.request_id);
  if (!request) return null;
  const expired =
    row.offer_status === 'active' && row.expires_at !== null && row.expires_at.getTime() <= now.getTime();
  const live = row.offer_id !== null && !expired;
  return {
    seatId: row.seat_id,
    position: row.position,
    seatStatus: live ? (row.offer_status === 'accepted' ? 'accepted' : 'offered') : 'open',
    total: row.total,
    request,
    liveOffer:
      live && row.offer_id && row.offer_status && row.held_by && row.holder_name
        ? {
            id: row.offer_id,
            status: row.offer_status,
            holderId: row.held_by,
            holderName: row.holder_name,
          }
        : null,
    derivedStatus: deriveRequestStatus({
      stored: request.status,
      seatsTotal: row.total,
      seatsAccepted: row.seats_accepted,
      approvedTimesheets: row.approved,
      endAt: request.end_at,
      now,
    }),
  };
}

interface InterpreterRow {
  id: string;
  name: string;
  email: string;
}

async function loadInterpreter(db: Db, interpreterId: string): Promise<InterpreterRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(interpreterId)) return null;
  return queryOne<InterpreterRow>(
    db,
    `select id, name, email from users where id = $1 and role = 'interpreter'`,
    [interpreterId],
  );
}

/** Loads everything the four gates read, for one interpreter against one seat. */
async function loadGateInput(
  db: Db,
  seat: SeatContext,
  interpreterId: string,
  now: Date,
): Promise<GateInput> {
  const credentials = await query<{ type: CredentialType; expires_on: string }>(
    db,
    'select type, expires_on from credentials where interpreter_id = $1',
    [interpreterId],
  );
  const consumer = await queryOne<{ name: string; blocked: boolean }>(
    db,
    `select u.name,
            exists (select 1 from consumer_preferences p
                    where p.consumer_id = u.id and p.interpreter_id = $2 and p.kind = 'blocked') as blocked
     from users u where u.id = $1`,
    [seat.request.consumer_id, interpreterId],
  );
  if (!consumer) throw new Error(`request ${seat.request.id} has no consumer`);
  const commitments = await query<{ ref: string; start_at: Date; end_at: Date }>(
    db,
    `select r.ref, r.start_at, r.end_at
     from offers o
     join requests r on r.id = o.request_id
     where o.interpreter_id = $1
       and o.seat_id <> $2
       and r.status not in ('cancelled_on_time', 'cancelled_late')
       and (o.status = 'accepted' or (o.status = 'active' and o.expires_at > $3))
     order by r.start_at`,
    [interpreterId, seat.seatId, now],
  );
  return {
    setting: seat.request.setting,
    startAt: seat.request.start_at,
    endAt: seat.request.end_at,
    consumerName: consumer.name,
    blockedByConsumer: consumer.blocked,
    credentials: credentials.map((credential) => ({
      type: credential.type,
      expires_on: credential.expires_on,
    })),
    commitments: commitments.map(
      (commitment): GateCommitment => ({
        ref: commitment.ref,
        start: commitment.start_at,
        end: commitment.end_at,
      }),
    ),
  };
}

/** The ordered checks shared by the dry-run and the pin. */
async function guardSeat(
  db: Db,
  seatId: string,
  interpreterId: string,
  now: Date,
): Promise<{ seat: SeatContext; interpreter: InterpreterRow }> {
  const seat = await loadSeatContext(db, seatId, now);
  if (!seat) throw notFound();
  const interpreter = await loadInterpreter(db, interpreterId);
  if (!interpreter) throw notFound();
  if (seat.liveOffer) {
    throw seatTaken({ id: seat.liveOffer.holderId, name: seat.liveOffer.holderName });
  }
  if (!DISPATCHABLE_STATUSES.includes(seat.derivedStatus)) {
    throw invalidTransition(seat.derivedStatus);
  }
  return { seat, interpreter };
}

export interface DryRunResult {
  seat_id: string;
  interpreter_id: string;
  gates: GateResult[];
  all_pass: boolean;
}

export async function dryRunSeat(
  seatId: string,
  interpreterId: string,
  now: Date,
): Promise<DryRunResult> {
  const { seat } = await guardSeat(pool, seatId, interpreterId, now);
  const gates = evaluateGates(await loadGateInput(pool, seat, interpreterId, now));
  return {
    seat_id: seatId,
    interpreter_id: interpreterId,
    gates,
    all_pass: gates.every((gate) => gate.pass),
  };
}

export interface PinResult {
  offer: {
    id: string;
    status: 'active';
    token: string;
    sent_at: string;
    expires_at: string;
    interpreter: { id: string; name: string };
  };
  seat: { id: string; position: number; status: SeatStatus };
  request: RequestObject;
}

/** Pins a seat: re-runs the gates inside the transaction, then creates the one offer. */
export async function pinSeat(
  seatId: string,
  interpreterId: string,
  coordinatorId: string,
  now: Date,
): Promise<PinResult> {
  const created = await withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`interpreter:${interpreterId}`]);
    await client.query('select id from seats where id = $1 for update', [seatId]);
    await expireDueOffersForSeat(client, seatId, now);

    const { seat, interpreter } = await guardSeat(client, seatId, interpreterId, now);

    const expiresAt = offerExpiresAt({
      now,
      startAt: seat.request.start_at,
      loggedAfter: seat.request.logged_after,
    });
    if (expiresAt.getTime() <= now.getTime()) throw fail('offer_window_closed');

    const gates = evaluateGates(await loadGateInput(client, seat, interpreterId, now));
    if (gates.some((gate) => !gate.pass)) throw gateFailed(gates);

    const token = randomBytes(32).toString('base64url');
    const offer = await queryOne<{ id: string; sent_at: Date; expires_at: Date }>(
      client,
      `insert into offers (seat_id, request_id, interpreter_id, held_by, token, status, sent_at, expires_at)
       values ($1, $2, $3, $4, $5, 'active', $6, $7)
       returning id, sent_at, expires_at`,
      [seatId, seat.request.id, interpreterId, coordinatorId, token, now, expiresAt],
    );
    if (!offer) throw new Error('offer insert produced no row');
    await client.query(`update seats set status = 'offered' where id = $1`, [seatId]);

    const email = offerEmail({
      request: seat.request,
      seatPosition: seat.position,
      seatTotal: seat.total,
      interpreterName: interpreter.name,
      interpreterEmail: interpreter.email,
      expiresAt,
      token,
    });
    const outboxId = await queueEmail(client, { ...email, dedupeKey: `offer-${offer.id}` });
    await client.query('update offers set outbox_id = $2 where id = $1', [offer.id, outboxId]);

    await writeAudit(client, {
      actorId: coordinatorId,
      action: 'seat.offered',
      entity: 'seat',
      entityId: seatId,
      requestId: seat.request.id,
      from: 'open',
      to: 'offered',
      detail: { offer_id: offer.id, interpreter: { id: interpreter.id, name: interpreter.name } },
    });

    return { offerId: offer.id, token, seat, interpreter, expiresAt, sentAt: offer.sent_at };
  });

  const row = await loadRequestRow(pool, created.seat.request.id);
  if (!row) throw notFound();
  return {
    offer: {
      id: created.offerId,
      status: 'active',
      token: created.token,
      sent_at: toIsoWithOffset(created.sentAt),
      expires_at: toIsoWithOffset(created.expiresAt),
      interpreter: { id: created.interpreter.id, name: created.interpreter.name },
    },
    seat: { id: created.seat.seatId, position: created.seat.position, status: 'offered' },
    request: await serializeRequest(pool, row, now),
  };
}
