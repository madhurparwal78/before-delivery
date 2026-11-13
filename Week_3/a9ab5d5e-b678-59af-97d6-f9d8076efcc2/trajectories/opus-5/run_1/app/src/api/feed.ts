import { ServerResponse } from 'node:http';
import { LogEntry, logEvents, one, rows } from '../db';
import { ApiResponse, Ctx } from '../http/context';
import { makeCursor, readLogPageRequest, readPageRequest } from '../http/protocol';
import { Json } from '../lib/json';
import { formatInstant } from '../domain/time';
import { sessionFromHeader } from './auth';

export async function listNotices(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const page = readPageRequest(ctx, household.id);
  const zone = await ctx.zone();
  const found = await rows(
    `SELECT id::text AS id, kind, to_email, subject, status, attempts, queued_at, sent_at
     FROM notices WHERE household_id = $1 AND ($2::bigint IS NULL OR id < $2)
     ORDER BY notices.id DESC LIMIT $3`,
    [household.id, page.afterId, page.limit + 1],
  );
  const health = await one('SELECT last_attempt_failed FROM mail_health WHERE household_id = $1', [household.id]);
  const last = found[page.limit - 1];
  return {
    status: 200,
    json: {
      items: found.slice(0, page.limit).map((row) => ({
        id: row.id as string,
        kind: row.kind as string,
        to: row.to_email as string,
        subject: row.subject as string,
        status: row.status as string,
        attempts: row.attempts as number,
        queuedAt: formatInstant(zone, (row.queued_at as Date).getTime()),
        sentAt: row.sent_at ? formatInstant(zone, (row.sent_at as Date).getTime()) : null,
      })) as unknown as Json,
      next: found.length > page.limit && last ? makeCursor(household.id, last.id as string) : null,
      mail: health && (health.last_attempt_failed as boolean) ? 'degraded' : 'ok',
    },
  };
}

export async function listLog(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const page = readLogPageRequest(ctx);
  const found = await rows(
    `SELECT seq::text AS seq, at, actor, type, subject_id::text AS subject_id
     FROM record_log WHERE household_id = $1 AND seq > $2 ORDER BY record_log.seq ASC LIMIT $3`,
    [household.id, page.afterSeq, page.limit + 1],
  );
  const items = found.slice(0, page.limit);
  const lastItem = items[items.length - 1];
  return {
    status: 200,
    json: {
      items: items.map((row) => ({
        seq: row.seq as string,
        at: (row.at as Date).toISOString().replace(/\.\d{3}Z$/, '+00:00'),
        actor: row.actor as string,
        type: row.type as string,
        subjectId: row.subject_id as string | null,
      })) as unknown as Json,
      next: found.length > page.limit && lastItem ? (lastItem.seq as string) : null,
    },
  };
}

/** The household stream: every log entry above Last-Event-ID, then each new one. */
export async function streamEvents(ctx: Ctx, response: ServerResponse): Promise<void> {
  const household = ctx.home;
  const lastEventIdHeader = ctx.header('last-event-id') ?? ctx.url.searchParams.get('lastEventId') ?? '0';
  let sentUpTo = /^\d+$/.test(lastEventIdHeader) ? Number.parseInt(lastEventIdHeader, 10) : 0;
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  const write = (entry: LogEntry): void => {
    const seq = Number.parseInt(entry.seq, 10);
    if (seq <= sentUpTo) return;
    sentUpTo = seq;
    response.write(`id: ${entry.seq}\nevent: ${entry.type}\ndata: ${JSON.stringify(entry)}\n\n`);
  };
  const queue: LogEntry[] = [];
  const onEntry = (entry: LogEntry): void => {
    queue.push(entry);
    drain();
  };
  let draining = false;
  const drain = (): void => {
    if (draining) return;
    draining = true;
    queue.sort((a, b) => Number.parseInt(a.seq, 10) - Number.parseInt(b.seq, 10));
    while (queue.length > 0) write(queue.shift() as LogEntry);
    draining = false;
  };
  logEvents.on(household.id, onEntry);

  const backlog = await rows(
    `SELECT seq::text AS seq, at, actor, type, subject_id::text AS subject_id
     FROM record_log WHERE household_id = $1 AND seq > $2 ORDER BY record_log.seq ASC`,
    [household.id, sentUpTo],
  );
  for (const row of backlog) {
    write({
      seq: row.seq as string,
      at: (row.at as Date).toISOString().replace(/\.\d{3}Z$/, '+00:00'),
      actor: row.actor as LogEntry['actor'],
      type: row.type as string,
      subjectId: row.subject_id as string | null,
    });
  }
  drain();

  const heartbeat = setInterval(() => {
    response.write(': keep-alive\n\n');
  }, 10000);

  /** Catches entries committed on another process and closes with the session. */
  const poll = setInterval(() => {
    void (async () => {
      const live = await sessionFromHeader(ctx.header('authorization')).catch(() => null);
      if (!live) {
        close();
        return;
      }
      const missed = await rows(
        `SELECT seq::text AS seq, at, actor, type, subject_id::text AS subject_id
         FROM record_log WHERE household_id = $1 AND seq > $2 ORDER BY record_log.seq ASC`,
        [household.id, sentUpTo],
      ).catch(() => []);
      for (const row of missed) {
        write({
          seq: row.seq as string,
          at: (row.at as Date).toISOString().replace(/\.\d{3}Z$/, '+00:00'),
          actor: row.actor as LogEntry['actor'],
          type: row.type as string,
          subjectId: row.subject_id as string | null,
        });
      }
    })();
  }, 1500);

  const close = (): void => {
    clearInterval(heartbeat);
    clearInterval(poll);
    logEvents.removeListener(household.id, onEntry);
    response.end();
  };
  response.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(poll);
    logEvents.removeListener(household.id, onEntry);
  });
}
