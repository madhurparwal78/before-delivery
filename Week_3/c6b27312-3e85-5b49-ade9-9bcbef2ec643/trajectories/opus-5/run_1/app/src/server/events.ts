import { PartEvent, onDropStreams, onPartEvent } from './bus';
import { query } from './db';
import { Ctx } from './http';
import { canReadPart, canReadRoom, loadPart, loadRoom } from './records';

type Stream = { close: () => void };

const streams = new Set<Stream>();

onDropStreams(() => {
  for (const stream of [...streams]) stream.close();
});

type OutboxRow = {
  id: string;
  part_slug: string;
  room_id: string | null;
  type: string;
  payload: unknown;
};

/** Every live event is stored with its change and streamed with an increasing id. */
export async function serveEventStream(ctx: Ctx): Promise<void> {
  const requested = ctx.url.searchParams.get('parts') ?? '*';
  const everything = requested === '*';
  const slugs = everything
    ? new Set<string>()
    : new Set(
        requested
          .split(',')
          .map((slug) => slug.trim())
          .filter((slug) => slug.length > 0),
      );

  const partAudience = new Map<string, boolean>();
  const roomAudience = new Map<string, boolean>();

  const mayReadPart = async (slug: string): Promise<boolean> => {
    const cached = partAudience.get(slug);
    if (cached !== undefined) return cached;
    const part = await loadPart(slug);
    const allowed = part ? await canReadPart(part, ctx.user) : false;
    partAudience.set(slug, allowed);
    return allowed;
  };

  const mayReadRoom = async (roomId: string): Promise<boolean> => {
    const cached = roomAudience.get(roomId);
    if (cached !== undefined) return cached;
    const room = await loadRoom(roomId);
    const allowed = room ? await canReadRoom(room, ctx.user) : false;
    roomAudience.set(roomId, allowed);
    return allowed;
  };

  const inAudience = async (slug: string, event: { type: string; roomId: string | null }): Promise<boolean> => {
    if (!everything && !slugs.has(slug)) return false;
    if (!(await mayReadPart(slug))) return false;
    if (event.type === 'comment' || event.type === 'approvals') {
      return event.roomId !== null && (await mayReadRoom(event.roomId));
    }
    return true;
  };

  ctx.res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  ctx.res.write('retry: 1000\n\n');

  let lastSent = 0;
  const write = (id: string, type: string, data: unknown): void => {
    const numeric = Number(id);
    if (numeric <= lastSent) return;
    lastSent = numeric;
    ctx.res.write(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const pending: { slug: string; event: PartEvent }[] = [];
  let replaying = true;
  const unsubscribe = onPartEvent((slug, event) => {
    if (replaying) {
      pending.push({ slug, event });
      return;
    }
    void (async () => {
      if (await inAudience(slug, { type: event.type, roomId: event.roomId })) {
        write(event.id, event.type, event.data);
      }
    })();
  });

  const keepAlive = setInterval(() => {
    if (!ctx.res.writableEnded) ctx.res.write(': keep-alive\n\n');
  }, 15000);

  const stream: Stream = {
    close: () => {
      clearInterval(keepAlive);
      unsubscribe();
      streams.delete(stream);
      if (!ctx.res.writableEnded) ctx.res.end();
    },
  };
  streams.add(stream);
  ctx.req.on('close', () => stream.close());

  const lastEventId = Number(ctx.req.headers['last-event-id'] ?? '0');
  if (Number.isFinite(lastEventId) && lastEventId > 0) {
    const missed = await query<OutboxRow>(
      everything
        ? 'select id::text as id, part_slug, room_id, type, payload from outbox where id > $1 order by id'
        : 'select id::text as id, part_slug, room_id, type, payload from outbox where id > $1 and part_slug = any($2) order by id',
      everything ? [lastEventId] : [lastEventId, [...slugs]],
    );
    for (const row of missed.rows) {
      if (await inAudience(row.part_slug, { type: row.type, roomId: row.room_id })) {
        write(row.id, row.type, row.payload);
      }
    }
  }

  replaying = false;
  for (const held of pending) {
    if (await inAudience(held.slug, { type: held.event.type, roomId: held.event.roomId })) {
      write(held.event.id, held.event.type, held.event.data);
    }
  }
}

export function closeEveryStream(): void {
  for (const stream of [...streams]) stream.close();
}
