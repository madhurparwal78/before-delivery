import { pool } from '../db/pool.js';
import type { Actor } from '../auth/sessions.js';
import type { RequestContext } from '../http/context.js';
import { boardChanges, presenceUpdates, sessionEndings } from '../board/events.js';
import type { WorkshopRow } from '../board/repository.js';

const KEEPALIVE_MS = 15_000;

interface OpenStream {
  readonly workshopId: string;
}

const openStreams = new Set<OpenStream>();

export function openStreamWorkshopIds(): string[] {
  return [...openStreams].map((stream) => stream.workshopId);
}

/**
 * Serves the live board stream. On every stream, `board` event ids strictly increase and
 * never repeat, and a stream opened with `Last-Event-ID` below the current version first
 * receives one `board` event for the current version.
 */
export async function serveStream(
  context: RequestContext,
  actor: Actor,
  workshop: WorkshopRow,
): Promise<void> {
  const response = context.res;
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let lastSent = 0;
  const send = (event: string, data: string | null, id?: number): void => {
    const lines: string[] = [];
    if (id !== undefined) lines.push(`id: ${id}`);
    lines.push(`event: ${event}`);
    lines.push(`data: ${data ?? ''}`);
    response.write(`${lines.join('\n')}\n\n`);
  };

  const sendBoard = (version: number): void => {
    if (version <= lastSent) return;
    lastSent = version;
    send('board', JSON.stringify({ version }), version);
  };

  const header = context.header('last-event-id');
  const lastEventId = header === undefined ? null : Number.parseInt(header, 10);
  if (lastEventId !== null && Number.isFinite(lastEventId)) {
    lastSent = lastEventId;
    const current = await pool.query<{ version: number }>('SELECT version FROM workshops WHERE id = $1', [
      workshop.id,
    ]);
    const version = current.rows[0]?.version;
    // Catch the stream up to the current version before any later event.
    if (version !== undefined && version > lastEventId) sendBoard(version);
  }

  const registration: OpenStream = { workshopId: workshop.id };
  openStreams.add(registration);

  const unsubscribeBoard = boardChanges.subscribe((change) => {
    if (change.workshopId === workshop.id) sendBoard(change.version);
  });

  const unsubscribePresence = presenceUpdates.subscribe((update) => {
    if (update.workshopId !== workshop.id) return;
    // Nobody receives their own cursor.
    if (actor.kind === 'participant' && update.sourceParticipantId === actor.participantId) return;
    // While the workshop is in a silent round, participants receive no presence events.
    if (actor.kind === 'participant' && currentStatus === 'silent_round') return;
    const payload: Record<string, unknown> = {
      cursorId: update.cursorId,
      hue: update.hue,
      x: update.x,
      y: update.y,
    };
    if (actor.kind === 'facilitator') payload.name = update.name;
    send('presence', JSON.stringify(payload));
  });

  let currentStatus = workshop.status;
  const statusPoll = setInterval(() => {
    void pool
      .query<{ status: string }>('SELECT status FROM workshops WHERE id = $1', [workshop.id])
      .then((result) => {
        const status = result.rows[0]?.status;
        if (status !== undefined) currentStatus = status as typeof currentStatus;
      })
      .catch(() => undefined);
  }, 1_000);

  const unsubscribeEnded = sessionEndings.subscribe((ended) => {
    if (ended.workshopId !== workshop.id) return;
    if (actor.kind !== 'participant') return;
    if (!ended.participantIds.includes(actor.participantId)) return;
    send('ended', null);
    close();
  });

  const keepalive = setInterval(() => {
    response.write(': keepalive\n\n');
  }, KEEPALIVE_MS);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    clearInterval(keepalive);
    clearInterval(statusPoll);
    unsubscribeBoard();
    unsubscribePresence();
    unsubscribeEnded();
    openStreams.delete(registration);
    response.end();
  }

  context.req.on('close', close);
  await new Promise<void>((resolve) => {
    response.on('close', () => {
      close();
      resolve();
    });
  });
}
