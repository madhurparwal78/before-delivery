import { db } from '../db.js';
import {
  closeConnection,
  markAway,
  markPresent,
  openConnection,
  publishToMembers,
  publishToThread,
  threadConnectionCount,
} from '../live.js';
import { loadBooking, loadRide } from '../model.js';
import type { Ctx, Reply, Router } from '../http.js';

/** One same-origin event stream. A page refetches its state after every `hello`. */
async function stream(ctx: Ctx): Promise<Reply> {
  const memberId = ctx.member?.id ?? null;
  const rideId = ctx.query('ride');
  const requestedThread = ctx.query('thread');

  let threadId: string | null = null;
  let otherId: string | null = null;
  if (requestedThread && memberId) {
    const booking = await loadBooking(db, requestedThread);
    const ride = booking ? await loadRide(db, booking.ride_id) : null;
    if (booking && ride && (booking.passenger_id === memberId || ride.driver_id === memberId)) {
      threadId = booking.id;
      otherId = booking.passenger_id === memberId ? ride.driver_id : booking.passenger_id;
    }
  }

  ctx.res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const connection = openConnection(ctx.res, memberId, rideId, threadId);

  if (threadId && memberId && otherId) {
    await markPresent(threadId, memberId);
    const event = {
      booking_id: threadId,
      member_id: memberId,
      online: true,
      last_seen_at: null,
    };
    publishToThread(threadId, [memberId, otherId], 'presence', event);
    publishToMembers([otherId], 'presence', event);
  }

  const keepAlive = setInterval(() => ctx.res.write(': keep-alive\n\n'), 15_000);
  const finish = () => {
    clearInterval(keepAlive);
    closeConnection(connection);
    if (threadId && memberId && otherId) {
      if (threadConnectionCount(threadId, memberId) === 0) {
        void markAway(threadId, memberId).then((lastSeen) => {
          const event = {
            booking_id: threadId,
            member_id: memberId,
            online: false,
            last_seen_at: lastSeen,
          };
          publishToThread(threadId as string, [memberId, otherId as string], 'presence', event);
          publishToMembers([otherId as string], 'presence', event);
        });
      }
    }
  };
  ctx.req.on('close', finish);
  ctx.res.on('close', finish);

  return { status: 200, handled: true };
}

export function registerLiveRoute(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/live',
    kind: 'plain',
    auth: 'none',
    handler: stream,
  });
}
