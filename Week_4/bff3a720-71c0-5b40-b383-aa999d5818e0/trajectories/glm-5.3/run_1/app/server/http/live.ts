import type { IncomingMessage, ServerResponse } from 'http';
import type { Model } from '../domain/model.js';
import { audienceFor } from '../services/live.js';

/**
 * GET /api/live?ride=<id>&thread=<booking id> — the one same-origin event stream.
 * The first event on every connection is `hello`, so a reconnecting page refetches.
 */
export async function handleLive(req: IncomingMessage, res: ServerResponse, model: Model): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://local');
  const query = url.searchParams;
  const rideId = query.get('ride');
  const threadId = query.get('thread');
  const cookie = req.headers.cookie ?? '';
  const token = /(?:^|;\s*)ls_session=([^;]+)/.exec(cookie)?.[1] ?? null;
  let memberId: string | null = null;
  if (token) {
    const member = await model.sessionMember(token);
    memberId = member?.id ?? null;
  }

  if (threadId && memberId) {
    const row = await model.db.query('SELECT * FROM bookings WHERE id = $1', [threadId]);
    if (row.rows.length === 0) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not_found', message: 'We could not find that.' })); return; }
    const b = row.rows[0] as { passenger_id: string; ride_id: string };
    const ride = await model.rideById(b.ride_id);
    if (!ride || (memberId !== b.passenger_id && memberId !== ride.driver_id)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', message: 'We could not find that.' }));
      return;
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event: string, data: string) => {
    res.write(`event: ${event}\ndata: ${data}\n\n`);
  };

  send('hello', JSON.stringify({ server_now: new Date(model.now()).toISOString() }));

  const unregister = model.live.add({
    memberId,
    rideId,
    bookingId: threadId,
    send: (event, data) => send(event, data),
  });

  if (threadId && memberId) {
    const key = model.valkey.presenceKey(threadId);
    await model.valkey.sAdd(key, memberId);
    const other = await threadPartner(model, threadId, memberId);
    if (other) {
      model.live.push({
        type: 'presence',
        data: { booking_id: threadId, member_id: memberId, online: true, last_seen_at: null },
        audience: audienceFor({ memberIds: [other], bookingId: threadId }),
      });
    }
  }

  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 15_000);

  const cleanup = async () => {
    clearInterval(keepAlive);
    unregister();
    if (threadId && memberId) {
      await model.valkey.sRemove(model.valkey.presenceKey(threadId), memberId);
      await model.valkey.hSet(model.valkey.lastSeenHash(), `${threadId}:${memberId}`, new Date(model.now()).toISOString());
      const other = await threadPartner(model, threadId, memberId);
      if (other) {
        model.live.push({
          type: 'presence',
          data: { booking_id: threadId, member_id: memberId, online: false, last_seen_at: new Date(model.now()).toISOString() },
          audience: audienceFor({ memberIds: [other], bookingId: threadId }),
        });
      }
    }
  };

  req.on('close', () => { void cleanup(); });
}

async function threadPartner(model: Model, bookingId: string, memberId: string): Promise<string | null> {
  const row = await model.db.query('SELECT passenger_id, ride_id FROM bookings WHERE id = $1', [bookingId]);
  if (row.rows.length === 0) return null;
  const b = row.rows[0] as { passenger_id: string; ride_id: string };
  const ride = await model.rideById(b.ride_id);
  if (!ride) return null;
  return memberId === b.passenger_id ? ride.driver_id : b.passenger_id;
}
