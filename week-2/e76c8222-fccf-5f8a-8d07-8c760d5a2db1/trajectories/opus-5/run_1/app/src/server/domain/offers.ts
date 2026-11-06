import { PoolClient } from 'pg';
import { MyOffer, OfferPagePayload, OfferStatus, RequestStatus } from '../../shared/types';
import { toIsoWithOffset } from '../../shared/time';
import { Db, query, queryOne, withTransaction } from '../db/pool';
import { notFound, offerClosed } from '../http/errors';
import { queueEmail } from '../services/mail';
import { staffedEmail } from '../services/notifications';
import { writeAudit } from './audit';
import { RequestRow, loadRequestRow, refreshRequestStatusIn } from './requests';

interface OfferRow {
  id: string;
  seat_id: string;
  request_id: string;
  interpreter_id: string;
  interpreter_name: string;
  status: OfferStatus;
  sent_at: Date;
  expires_at: Date;
  position: number;
  total: number;
}

const OFFER_BY_TOKEN_SQL = `
  select o.id, o.seat_id, o.request_id, o.interpreter_id, u.name as interpreter_name, o.status,
         o.sent_at, o.expires_at, s.position,
         (select count(*)::int from seats x where x.request_id = o.request_id) as total
  from offers o
  join seats s on s.id = o.seat_id
  join users u on u.id = o.interpreter_id
  where o.token = $1`;

export async function offerPage(db: Db, token: string, now: Date): Promise<OfferPagePayload | null> {
  const offer = await queryOne<OfferRow>(db, OFFER_BY_TOKEN_SQL, [token]);
  if (!offer) return null;
  const request = await loadRequestRow(db, offer.request_id);
  if (!request) return null;
  const status: OfferStatus =
    offer.status === 'active' && offer.expires_at.getTime() <= now.getTime()
      ? 'expired'
      : offer.status;
  return {
    offer: { status, expires_at: toIsoWithOffset(offer.expires_at) },
    request: {
      ref: request.ref,
      title: request.title,
      setting: request.setting,
      location: request.location,
      start: toIsoWithOffset(request.start_at),
      end: toIsoWithOffset(request.end_at),
      org_name: request.org_name,
    },
    seat: { position: offer.position, total: offer.total },
    interpreter: { name: offer.interpreter_name },
  };
}

export interface AnswerResult {
  offerStatus: 'accepted' | 'declined';
  ref: string;
  requestStatus: RequestStatus;
}

/** Marks an offer expired and reopens its seat; used by answers and by the sweep. */
async function expireOffer(client: PoolClient, offerId: string, requestId: string, seatId: string): Promise<void> {
  await client.query(`update offers set status = 'expired', answered_at = now() where id = $1`, [
    offerId,
  ]);
  await client.query(`update seats set status = 'open' where id = $1`, [seatId]);
  await writeAudit(client, {
    actorId: null,
    action: 'offer.expired',
    entity: 'offer',
    entityId: offerId,
    requestId,
    from: 'active',
    to: 'expired',
  });
}

/** Expires any due offer on a seat, so a reopened seat can be offered again. */
export async function expireDueOffersForSeat(
  client: PoolClient,
  seatId: string,
  now: Date,
): Promise<void> {
  const due = await query<{ id: string; request_id: string; seat_id: string }>(
    client,
    `select id, request_id, seat_id from offers
     where seat_id = $1 and status = 'active' and expires_at <= $2
     for update`,
    [seatId, now],
  );
  for (const offer of due) {
    await expireOffer(client, offer.id, offer.request_id, offer.seat_id);
  }
}

async function expireDueOfferByToken(token: string, now: Date): Promise<void> {
  await withTransaction(async (client) => {
    const due = await queryOne<{ id: string; request_id: string; seat_id: string }>(
      client,
      `select id, request_id, seat_id from offers
       where token = $1 and status = 'active' and expires_at <= $2
       for update`,
      [token, now],
    );
    if (due) await expireOffer(client, due.id, due.request_id, due.seat_id);
  });
}

async function queueStaffedNotices(client: PoolClient, request: RequestRow): Promise<void> {
  const seated = await query<{ name: string }>(
    client,
    `select u.name from seats s
     join offers o on o.seat_id = s.id and o.status = 'accepted'
     join users u on u.id = o.interpreter_id
     where s.request_id = $1
     order by s.position`,
    [request.id],
  );
  const requesters = await query<{ id: string; name: string; email: string }>(
    client,
    `select id, name, email from users where role = 'requester' and org_id = $1 order by email`,
    [request.org_id],
  );
  for (const requester of requesters) {
    await queueEmail(client, {
      dedupeKey: `staffed-${request.id}-${requester.id}`,
      ...staffedEmail({
        request,
        requesterName: requester.name,
        requesterEmail: requester.email,
        seatedNames: seated.map((row) => row.name),
      }),
    });
  }
}

export async function answerOffer(
  token: string,
  answer: 'accept' | 'decline',
  now: Date,
): Promise<AnswerResult> {
  await expireDueOfferByToken(token, now);
  return withTransaction(async (client) => {
    const offer = await queryOne<OfferRow>(client, `${OFFER_BY_TOKEN_SQL} for update of o`, [token]);
    if (!offer) throw notFound();
    const request = await loadRequestRow(client, offer.request_id);
    if (!request) throw notFound();
    if (offer.status !== 'active') throw offerClosed(offer.status);

    if (answer === 'decline') {
      await client.query(
        `update offers set status = 'declined', answered_at = $2 where id = $1`,
        [offer.id, now],
      );
      await client.query(`update seats set status = 'open' where id = $1`, [offer.seat_id]);
      await writeAudit(client, {
        actorId: null,
        action: 'offer.declined',
        entity: 'offer',
        entityId: offer.id,
        requestId: offer.request_id,
        from: 'active',
        to: 'declined',
        detail: { interpreter: { id: offer.interpreter_id, name: offer.interpreter_name } },
      });
      const status = await refreshRequestStatusIn(client, offer.request_id, null, now);
      return { offerStatus: 'declined' as const, ref: request.ref, requestStatus: status };
    }

    await client.query(`update offers set status = 'accepted', answered_at = $2 where id = $1`, [
      offer.id,
      now,
    ]);
    await client.query(`update seats set status = 'accepted' where id = $1`, [offer.seat_id]);
    await writeAudit(client, {
      actorId: null,
      action: 'offer.accepted',
      entity: 'offer',
      entityId: offer.id,
      requestId: offer.request_id,
      from: 'active',
      to: 'accepted',
      detail: { interpreter: { id: offer.interpreter_id, name: offer.interpreter_name } },
    });
    const status = await refreshRequestStatusIn(client, offer.request_id, null, now);
    if (status === 'staffed') {
      await queueStaffedNotices(client, request);
    }
    return { offerStatus: 'accepted' as const, ref: request.ref, requestStatus: status };
  });
}

export async function listMyOffers(db: Db, interpreterId: string, now: Date): Promise<MyOffer[]> {
  const rows = await query<{
    id: string;
    token: string;
    sent_at: Date;
    expires_at: Date;
    position: number;
    total: number;
    request_id: string;
    ref: string;
    title: string;
    setting: MyOffer['request']['setting'];
    location: string;
    start_at: Date;
    end_at: Date;
    org_name: string;
  }>(
    db,
    `select o.id, o.token, o.sent_at, o.expires_at, s.position,
            (select count(*)::int from seats x where x.request_id = o.request_id) as total,
            r.id as request_id, r.ref, r.title, r.setting, r.location, r.start_at, r.end_at,
            g.name as org_name
     from offers o
     join seats s on s.id = o.seat_id
     join requests r on r.id = o.request_id
     join orgs g on g.id = r.org_id
     where o.interpreter_id = $1 and o.status = 'active' and o.expires_at > $2
     order by o.expires_at asc`,
    [interpreterId, now],
  );
  return rows.map((row) => ({
    id: row.id,
    token: row.token,
    status: 'active' as const,
    sent_at: toIsoWithOffset(row.sent_at),
    expires_at: toIsoWithOffset(row.expires_at),
    request: {
      id: row.request_id,
      ref: row.ref,
      title: row.title,
      setting: row.setting,
      location: row.location,
      start: toIsoWithOffset(row.start_at),
      end: toIsoWithOffset(row.end_at),
      org_name: row.org_name,
    },
    seat: { position: row.position, total: row.total },
  }));
}

/** Background sweep: expires offers past their expiry and reopens their seats. */
export async function sweepExpiredOffers(now: Date): Promise<number> {
  return withTransaction(async (client) => {
    const due = await query<{ id: string; request_id: string; seat_id: string }>(
      client,
      `select id, request_id, seat_id from offers
       where status = 'active' and expires_at <= $1
       order by id
       for update skip locked`,
      [now],
    );
    for (const offer of due) {
      await expireOffer(client, offer.id, offer.request_id, offer.seat_id);
    }
    return due.length;
  });
}
