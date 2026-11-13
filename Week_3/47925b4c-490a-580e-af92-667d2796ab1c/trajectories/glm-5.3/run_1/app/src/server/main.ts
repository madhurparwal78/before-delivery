// The main serve process: schema and seed, sweeps, SSE, routes and static files.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readConfig } from './config.js';
import { Database, isConnectionError } from './db.js';
import { applySchemaAndSeed } from './seed.js';
import { S3 } from './s3.js';
import { rentalHouse } from './rental-house.js';
import { SseHub } from './sse.js';
import { HoldSweeper } from './holds.js';
import { MaskWorker } from './mask-worker.js';
import { type Ctx, type Route, RouteError } from './route-context.js';
import { matchPath, writeProblem, problems } from './api-core.js';
import { siteRoutes } from './routes-sites.js';
import { kitRoutes } from './routes-kit.js';
import { layoutRoutes } from './routes-layouts.js';
import { sheetRoutes } from './routes-sheets.js';
import { checkOrigin, checkIdempotencyKey, JSON_BODY_LIMIT, PHOTO_BODY_LIMIT } from './boundary.js';
import { readBody } from './body.js';
import { StaticFiles } from './static-files.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeOutbox } from './events.js';

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const config = readConfig(process.env);
  const db = new Database(config.databaseUrl);
  const s3 = new S3(config.s3);
  const house = rentalHouse(config);
  const sse = new SseHub(db);
  const statics = new StaticFiles(join(here, 'public'));

  // The app starts even when dependencies are down; the seed retries until connected.
  const seedInterval = setInterval(() => {
    void applySchemaAndSeed(db.pool()).then(() => {
      clearInterval(seedInterval);
    }).catch(() => {
      // keep retrying until the database returns
    });
  }, 2000);
  seedInterval.unref();

  const owner = `proc-${process.pid}`;
  const sweeper = new HoldSweeper(db, house, owner, {
    holdChanged: async (client, holdId, status) => {
      await writeOutbox(client, 'hold.changed', 'hold', holdId, { id: holdId, status });
    },
    layoutCleared: async (client, holdId) => {
      const placed = await client.query<{ layout_id: string }>(
        'SELECT layout_id FROM placements WHERE hold_id = $1',
        [holdId],
      );
      for (const placement of placed.rows) {
        await client.query('UPDATE placements SET hold_id = NULL, body_serial = NULL WHERE hold_id = $1', [holdId]);
        await client.query('UPDATE layouts SET version = version + 1 WHERE id = $1', [placement.layout_id]);
        await writeOutbox(client, 'layout.changed', 'layout', placement.layout_id, { id: placement.layout_id, version: 0, hash: '' });
      }
      return placed.rows.length;
    },
  });
  sweeper.start();
  sse.start();
  const maskWorker = new MaskWorker(db, s3, config);
  maskWorker.start();
  void maskWorker;

  const routes: Route[] = [...siteRoutes(), ...kitRoutes(), ...layoutRoutes(), ...sheetRoutes()];

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) {
        writeProblem(res, problems.internalError());
      } else {
        res.end();
      }
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = (req.method ?? 'GET').toUpperCase();
    if (!url.pathname.startsWith('/api')) {
      await statics.serve(url.pathname, res);
      return;
    }
    const originProblem = checkOrigin(req, publicOrigin(config));
    if (originProblem !== null) {
      writeProblem(res, originProblem);
      return;
    }
    const allowed: string[] = [];
    let matched: Route | undefined;
    for (const candidate of routes) {
      if (matchPath(candidate.path, url.pathname) !== null) {
        allowed.push(candidate.method);
        if (candidate.method === method) {
          matched = candidate;
          break;
        }
      }
    }
    if (matched === undefined) {
      if (allowed.length > 0) {
        writeProblem(res, problems.methodNotAllowed([...new Set(allowed)]));
        return;
      }
      writeProblem(res, problems.notFound());
      return;
    }

    let jsonBody: unknown = null;
    let rawBody: Buffer | null = null;
    if (method !== 'GET' && method !== 'HEAD') {
      const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
      const limit = matched.rawBody ? PHOTO_BODY_LIMIT : JSON_BODY_LIMIT;
      const bytes = await readBody(req, limit);
      if (bytes === null) {
        writeProblem(res, problems.bodyTooLarge());
        return;
      }
      if (matched.rawBody) {
        rawBody = bytes;
      } else {
        if (contentType !== '' && contentType !== 'application/json') {
          writeProblem(res, problems.unsupportedMediaType());
          return;
        }
        if (bytes.length > 0) {
          try {
            jsonBody = JSON.parse(bytes.toString('utf8'));
          } catch {
            writeProblem(res, problems.malformedBody());
            return;
          }
          if (typeof jsonBody !== 'object' || jsonBody === null || Array.isArray(jsonBody)) {
            writeProblem(res, problems.malformedBody());
            return;
          }
        } else {
          jsonBody = {};
        }
      }
    }

    let idempotencyKey: string | null = null;
    if (matched.keyed) {
      const checked = checkIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
      if (!checked.ok) {
        writeProblem(res, checked.problem);
        return;
      }
      idempotencyKey = checked.key;
    }

    const params = matchPath(matched.path, url.pathname) ?? {};
    const ctx: Ctx = {
      req,
      res,
      url,
      method,
      params,
      jsonBody,
      rawBody,
      idempotencyKey,
      db,
      config,
      s3,
      house,
      service: { sse },
      scratch: {},
    };
    try {
      await matched.handler(ctx);
    } catch (err) {
      if (process.env.GEVELWERK_DEBUG === '1') {
        console.error('request error', err);
      }
      if (err instanceof RouteError) {
        if (!res.headersSent) writeProblem(res, err.problem);
        else res.end();
        return;
      }
      if (isConnectionError(err)) {
        if (!res.headersSent) writeProblem(res, problems.databaseUnavailable());
        else res.end();
        return;
      }
      if (!res.headersSent) writeProblem(res, problems.internalError());
      else res.end();
    }
  }

  server.listen(config.port, '0.0.0.0');
  console.log(`gevelwerk serving on 0.0.0.0:${config.port}`);
}

function publicOrigin(config: { port: number }): string {
  const host = process.env.APP_PUBLIC_URL ? new URL(process.env.APP_PUBLIC_URL).host : `127.0.0.1:${config.port}`;
  const publicPort = process.env.APP_PUBLIC_PORT ?? String(config.port);
  return `http://${host.split(':')[0]!}:${publicPort}`;
}

void main();
