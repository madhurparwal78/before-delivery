import { Router } from 'express';
import { query } from './db';
import { subscribe } from './live';
import { personFromCookie } from './auth';
import { env } from './env';

export function eventsRouter(): Router {
  const r = Router();

  r.get('/api/events', async (req, res) => {
    const person = await personFromCookie(req);
    if (!person) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`retry: 2000\n\n`);
    const heartbeat = setInterval(() => {
      try { res.write(`: ping\n\n`); } catch { /* closed */ }
    }, 15000);
    const unsub = subscribe(person.teamIds, ev => {
      try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch { /* closed */ }
    });
    req.on('close', () => {
      clearInterval(heartbeat);
      unsub();
    });
  });

  return r;
}
