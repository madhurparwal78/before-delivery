import { Router, type Request, type Response } from 'express';
import { serverNow } from '../clock';
import { currentHost } from '../domain/hostSession';
import { errors } from '../errors';
import { asyncHandler } from '../http';
import {
  lastEventId,
  readEventsAfter,
  subscribeToDate,
  valkeyReachable,
  type StreamEvent,
} from '../services/valkey';
import { lisbonDate } from '../time';
import { Validator } from '../validate';

export const eventsRouter = Router();

const HEARTBEAT_MS = 15000;

async function streamEvents(
  req: Request,
  res: Response,
  date: string,
  pick: (event: StreamEvent) => unknown,
): Promise<void> {
  if (!valkeyReachable()) throw errors.holdsPaused();
  const headerId = req.headers['last-event-id'];
  const queryId = req.query.last_event_id;
  const since =
    typeof headerId === 'string' && headerId.length > 0
      ? headerId
      : typeof queryId === 'string' && queryId.length > 0
        ? queryId
        : null;
  const startId = since ?? (await lastEventId(date));

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 1000\n\n');

  const written = new Set<string>();
  const write = (event: StreamEvent): void => {
    if (written.has(event.id)) return;
    written.add(event.id);
    res.write(`id: ${event.id}\ndata: ${JSON.stringify(pick(event))}\n\n`);
  };

  const buffered: StreamEvent[] = [];
  let replaying = true;
  const unsubscribe = subscribeToDate(
    date,
    (event) => {
      if (replaying) buffered.push(event);
      else write(event);
    },
    startId,
  );

  const heartbeat = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, HEARTBEAT_MS);

  res.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });

  const replayed = await readEventsAfter(date, startId).catch(() => []);
  for (const event of replayed) write(event);
  replaying = false;
  for (const event of buffered) write(event);
}

eventsRouter.get(
  '/floor/events',
  asyncHandler(async (req, res) => {
    const now = serverNow();
    const validator = new Validator();
    const { date } = validator.finish({
      date: validator.date('date', req.query.date, now),
    });
    await streamEvents(req, res, date, (event) => event.publicEvent);
  }),
);

eventsRouter.get(
  '/host/events',
  asyncHandler(async (req, res) => {
    await currentHost(req);
    await streamEvents(req, res, lisbonDate(serverNow()), (event) => event.hostEvent);
  }),
);
