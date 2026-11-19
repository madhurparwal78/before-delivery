import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { loadConfig } from './config';
import { AppClock } from './app-clock';
import { Db } from './db';
import { Storage } from './storage';
import { Mail } from './mail';
import { Outbox } from './outbox';
import { ApiError } from './errors';
import { migrateAndSeed } from './seed';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppServices } from './context';
import { registerSessionRoutes } from './routes-session';
import { registerPeopleRoutes } from './routes-people';
import { registerChannelRoutes } from './routes-channels';
import { registerMessageRoutes } from './routes-messages';
import { registerMessageReadRoutes, announceBadgeChanges } from './routes-read';
import { registerPinRoutes } from './routes-pins';
import { registerGalleryRoutes } from './routes-gallery';
import { registerScheduledRoutes, fireScheduledPosts } from './routes-scheduled';
import { EventHub } from './event-hub';
import { runDigests } from './digest';
import { sweepMailLedger, sweepRemovalQueue } from './sweepers';
import { pruneEventLog } from './events';
import { registerMultipart } from './multipart';
import { serveStatic } from './static';

const MAX_JSON_BODY = 64000;
const MAX_MULTIPART_BODY = 41000000;

interface ParsedPart {
  fieldname: string;
  filename: string;
  data: Buffer;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const clock = new AppClock(config.appClockOffsetSeconds);
  const db = new Db(config.databaseUrl);
  const storage = new Storage(config);
  const mail = new Mail(config);
  const outbox = new Outbox(db, clock, mail, config);
  const services: AppServices = { db, clock, config, storage, mail, outbox };

  const schemaSql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await migrateAndSeed(db, clock, schemaSql);

  const app: FastifyInstance = Fastify({
    logger: false,
    trustProxy: false,
    genReqId: () => crypto.randomUUID(),
  });
  app.services = services;
  registerMultipart(app);

  // Cookie parsing without an extra dependency.
  app.addHook('onRequest', async (request, reply) => {
    const cookieHeader = request.headers.cookie;
    request.cookies = {};
    if (cookieHeader) {
      for (const part of cookieHeader.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        request.cookies[key] = decodeURIComponent(value);
      }
    }
    // Every response carries the server's current time (app clock).
    reply.header('Date', new Date(clock.nowMs()).toUTCString());
    reply.header('X-Content-Type-Options', 'nosniff');
    // Same-origin boundary: compare only host and port, never the scheme.
    const origin = request.headers.origin;
    if (origin && ['POST', 'PATCH', 'DELETE'].includes(request.method)) {
      const host = request.headers.host;
      if (host && originHost(origin) !== host) {
        reply.status(403);
        return reply.send({ error: 'cross_origin', message: 'Requests must come from Rimewire itself.' });
      }
    }
  });

  // Body size limits enforced before parsing.
  app.addHook('onRequest', async (request, reply) => {
    const len = Number(request.headers['content-length'] ?? '0');
    const isMultipart = (request.headers['content-type'] ?? '').startsWith('multipart/form-data');
    const limit = isMultipart ? MAX_MULTIPART_BODY : MAX_JSON_BODY;
    if (Number.isFinite(len) && len > limit) {
      reply.status(413);
      return reply.send({ error: 'payload_too_large', message: 'That request is larger than Rimewire accepts.' });
    }
  });

  app.addHook('preHandler', async (request, reply) => {
    if (request.body === undefined) return;
    void reply;
  });

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0];
    if (request.method === 'GET') {
      if (path.startsWith('/assets/')) {
        const asset = serveStatic(path.slice(1));
        if (asset) {
          reply.header('Content-Type', asset.contentType);
          reply.status(200);
          reply.send(asset.body);
          return;
        }
      }
      const shellRoute = path === '/' || path.startsWith('/c/') || path === '/join' || path.startsWith('/join/');
      if (shellRoute) {
        const html = serveStatic('index.html');
        if (html) {
          reply.header('Content-Type', html.contentType);
          reply.status(200);
          reply.send(html.body);
          return;
        }
      }
    }
    reply.status(404);
    reply.send({ error: 'not_found', message: 'That was not found.' });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.status);
      for (const [k, v] of Object.entries(error.headers)) reply.header(k, v);
      return reply.send(error.body());
    }
    console.error('route error:', error);
    reply.status(500);
    return reply.send({ error: 'internal_error', message: 'Something went wrong on our side. Try again.' });
  });

  registerSessionRoutes(app, services);
  registerPeopleRoutes(app, services);
  registerChannelRoutes(app, services);
  registerMessageRoutes(app, services);
  registerMessageReadRoutes(app, services);
  registerPinRoutes(app, services);
  registerGalleryRoutes(app, services);
  registerScheduledRoutes(app, services);

  const hub = new EventHub(services);
  app.get('/api/events', async (request, reply) => {
    await hub.handleStream(request, reply);
    return reply;
  });

  app.get('/api/health', async () => {
    let database = 'down';
    try {
      await db.pool.query('SELECT 1');
      database = 'up';
    } catch {
      database = 'down';
    }
    let storageUp = 'down';
    try {
      storageUp = (await storage.check()) ? 'up' : 'down';
    } catch {
      storageUp = 'down';
    }
    let mailUp = 'down';
    try {
      mailUp = (await mail.check()) ? 'up' : 'down';
    } catch {
      mailUp = 'down';
    }
    return { status: 'ok', services: { database, storage: storageUp, mail: mailUp } };
  });

  // Background work: every 10s the scheduler and event log pruning; every 30s
  // the removal queue, mail retries and service probes.
  let stopped = false;
  const tenSecond = setInterval(async () => {
    if (stopped) return;
    try {
      await fireScheduledPosts(services);
      await runDigests(services);
      await pruneEventLog(db, config.eventRetentionSeconds, clock.now());
    } catch {
      // next tick retries
    }
  }, 10000);
  const thirtySecond = setInterval(async () => {
    if (stopped) return;
    try {
      await sweepRemovalQueue(services);
      await sweepMailLedger(services);
      await storage.check();
      await mail.check();
    } catch {
      // next tick retries
    }
  }, 30000);
  app.addHook('onClose', async () => {
    stopped = true;
    clearInterval(tenSecond);
    clearInterval(thirtySecond);
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`Rimewire serving on 0.0.0.0:${config.port}`);
}

function originHost(origin: string): string {
  try {
    const url = new URL(origin);
    return url.host;
  } catch {
    return origin;
  }
}

main().catch((err) => {
  console.error('Failed to start Rimewire', err);
  process.exit(1);
});
