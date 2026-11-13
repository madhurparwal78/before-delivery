import { ServerResponse } from 'node:http';
import { LOG_COLUMNS, LogEntry, logEntryOf, logEvents, one, rows } from '../db';
import { ApiResponse, Ctx } from '../http/context';
import { makeCursor, readLogPageRequest, readPageRequest } from '../http/protocol';
import { Json } from '../lib/json';
import { formatInstant } from '../domain/time';
import { logFault } from '../log';
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

function logEntryJson(entry: LogEntry, zone: string): Json {
  return {
    seq: entry.seq,
    at: formatInstant(zone, entry.atSeconds * 1000),
    actor: entry.actor,
    type: entry.type,
    subjectId: entry.subjectId,
  };
}

async function logAfter(householdId: string, afterSeq: number, limit: number | null): Promise<LogEntry[]> {
  const found = await rows(
    `SELECT ${LOG_COLUMNS} FROM record_log WHERE household_id = $1 AND seq > $2
     ORDER BY record_log.seq ASC ${limit === null ? '' : 'LIMIT $3'}`,
    limit === null ? [householdId, afterSeq] : [householdId, afterSeq, limit],
  );
  return found.map(logEntryOf);
}

export async function listLog(ctx: Ctx): Promise<ApiResponse> {
  const household = ctx.home;
  const page = readLogPageRequest(ctx);
  const zone = await ctx.zone();
  const found = await logAfter(household.id, page.afterSeq, page.limit + 1);
  const items = found.slice(0, page.limit);
  const lastItem = items[items.length - 1];
  return {
    status: 200,
    json: {
      items: items.map((entry) => logEntryJson(entry, zone)),
      next: found.length > page.limit && lastItem ? String(lastItem.seq) : null,
    },
  };
}

const KEEP_ALIVE_MS = 10_000;
const SESSION_CHECK_MS = 1_500;

/** The household stream: every log entry above Last-Event-ID, then each new one. */
export async function streamEvents(ctx: Ctx, response: ServerResponse): Promise<void> {
  const household = ctx.home;
  const zone = await ctx.zone();
  const lastEventIdHeader = ctx.header('last-event-id') ?? '0';
  let sentUpTo = /^\d+$/.test(lastEventIdHeader) ? Number.parseInt(lastEventIdHeader, 10) : 0;
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  response.flushHeaders();
  const send = (entries: LogEntry[]): void => {
    for (const entry of entries.sort((a, b) => a.seq - b.seq)) {
      if (entry.seq <= sentUpTo) continue;
      sentUpTo = entry.seq;
      response.write(`id: ${entry.seq}\nevent: ${entry.type}\ndata: ${JSON.stringify(logEntryJson(entry, zone))}\n\n`);
    }
  };
  const onEntry = (entry: LogEntry): void => send([entry]);
  logEvents.on(household.id, onEntry);
  send(await logAfter(household.id, sentUpTo, null));

  const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), KEEP_ALIVE_MS);
  const stop = (): void => {
    clearInterval(keepAlive);
    clearInterval(sessionCheck);
    logEvents.removeListener(household.id, onEntry);
  };

  /** Catches entries committed on another process and closes with the session. */
  const sessionCheck = setInterval(() => {
    void (async () => {
      const live = await sessionFromHeader(ctx.header('authorization'));
      if (!live) {
        stop();
        response.end();
        return;
      }
      send(await logAfter(household.id, sentUpTo, null));
    })().catch((error: unknown) => logFault('stream', error));
  }, SESSION_CHECK_MS);
  response.on('close', stop);
}
