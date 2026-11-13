import { randomBytes } from 'node:crypto';
import type { RoomEvent } from '../../shared/protocol.js';
import { query } from '../db/pool.js';
import { liveUnavailable } from '../errors.js';
import { eventsAfter, waitForEvents } from '../live/events.js';
import { registerStream, type StreamHandle } from '../live/streams.js';
import { liveIsUp, removeLiveClient, subscribeRoom } from '../live/valkey.js';
import { syncRoomPresence } from '../rooms/lifecycle.js';
import {
  markPolled,
  markStreamAlive,
  markStreamOpen,
  registerStageClient,
  requireSeatClient,
} from '../rooms/players.js';
import { readOwnedRoom } from '../rooms/store.js';
import { sendJson } from '../http/respond.js';
import { param, requireQuizmaster, type Ctx } from './context.js';

const HEARTBEAT_MS = 15_000;
const POLL_TIMEOUT_MS = 25_000;

async function identify(ctx: Ctx, roomId: string): Promise<string> {
  if (ctx.url.searchParams.get('role') === 'stage') {
    const quizmaster = await requireQuizmaster(ctx);
    await readOwnedRoom(roomId, quizmaster.id);
    const clientId = ctx.url.searchParams.get('clientId') ?? `stage-${randomBytes(24).toString('base64url')}`;
    await registerStageClient(roomId, clientId);
    return clientId;
  }
  const client = await requireSeatClient(roomId, ctx.url.searchParams.get('clientId'));
  return client.clientId;
}

function readLastEventId(ctx: Ctx): number {
  const header = ctx.req.headers['last-event-id'];
  const raw = typeof header === 'string' ? header : ctx.url.searchParams.get('lastEventId');
  const parsed = Number(raw ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export async function getStream(ctx: Ctx): Promise<void> {
  const roomId = param(ctx, 'roomId');
  if (!liveIsUp()) throw liveUnavailable();
  const clientId = await identify(ctx, roomId);
  const lastEventId = readLastEventId(ctx);

  const { res } = ctx;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders();

  let highestSent = lastEventId;
  let replaying = true;
  const queued: RoomEvent[] = [];

  const write = (event: RoomEvent): void => {
    if (event.id <= highestSent) return;
    highestSent = event.id;
    res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    if (event.type === 'ended') res.end();
  };

  const unsubscribe = await subscribeRoom(roomId, (event) => {
    if (replaying) queued.push(event);
    else write(event);
  });

  const handle: StreamHandle = {
    send: write,
    sendSuperseded: () => res.write('event: superseded\ndata: {}\n\n'),
    close: () => res.end(),
  };
  const unregister = registerStream(clientId, handle);

  const heartbeat = setInterval(() => {
    res.write(': keep-alive\n\n');
    void markStreamAlive(clientId).catch(() => undefined);
  }, HEARTBEAT_MS);

  const letGo = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
    unregister();
    void query('UPDATE room_clients SET stream_open = false WHERE client_id = $1', [clientId])
      .then(() => removeLiveClient(roomId, clientId))
      .then(() => syncRoomPresence(roomId))
      .catch(() => undefined);
  };
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    letGo();
  };
  res.on('close', release);

  await markStreamOpen(clientId, roomId);
  if (released) {
    // The line dropped while the client was being marked open; undo that mark.
    letGo();
    return;
  }
  for (const event of await eventsAfter(roomId, lastEventId)) write(event);
  replaying = false;
  for (const event of queued) write(event);
  queued.length = 0;
  // Marks the end of the replay so a client can tell missed events from live ones.
  res.write(': live-edge\n\n');
  await syncRoomPresence(roomId);
}

export async function getPoll(ctx: Ctx): Promise<void> {
  const roomId = param(ctx, 'roomId');
  const clientId = await identify(ctx, roomId);
  const after = Number(ctx.url.searchParams.get('after') ?? 0);
  const afterId = Number.isFinite(after) && after > 0 ? Math.floor(after) : 0;
  await markPolled(clientId);

  const controller = new AbortController();
  ctx.req.on('close', () => controller.abort());
  const until = Date.now() + POLL_TIMEOUT_MS;
  let events = await eventsAfter(roomId, afterId);
  while (events.length === 0 && Date.now() < until && !controller.signal.aborted) {
    await waitForEvents(roomId, Math.min(2_000, until - Date.now()), controller.signal);
    events = await eventsAfter(roomId, afterId);
  }
  if (controller.signal.aborted) {
    ctx.res.end();
    return;
  }
  sendJson(ctx.res, 200, { events });
}
