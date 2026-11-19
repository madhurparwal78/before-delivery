// The HTTP server. Node's built-in http server with a light router:
// /api/* and /media/* to the Api, HTML pages for the app routes, and static
// files from dist/public. Source, configuration and dotfiles are never served
// (DP-56).
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { loadConfig } from './config.js';
import { AppClock } from './clock.js';
import { Pool } from './store/pool.js';
import { Database } from './store/db.js';
import { Store } from './store/store.js';
import { SCHEMA_SQL } from './store/schema.js';
import { seed } from './seed.js';
import { Api, contentTypeForKey, decodeImageSize, type ApiRequest } from './api.js';
import { IndexWorker } from './indexWorker.js';
import { MediaTokens, mediaSecret } from './domain/media.js';
import { S3Client } from './services/s3.js';
import { MeiliClient } from './services/meili.js';
import { parseQuery } from './domain/query.js';
import { MSG } from './domain/errors.js';
import { emptyReply, errorReply, jsonReply, type Sender } from './domain/http.js';
import { createHash } from 'node:crypto';

const config = loadConfig();
const clock = new AppClock(config.clockStart);
const pool = new Pool({ databaseUrl: config.databaseUrl, max: 12 });
const db = new Database(pool);
const store = new Store(db, clock);
const s3 = new S3Client(config.s3);
const meili = new MeiliClient(config.meilisearch);
const indexWorker = new IndexWorker(store, meili);
const mediaTokens = new MediaTokens(mediaSecret(`${config.databaseUrl}:${config.s3.secretAccessKey}`));
const photoUploads = new Map<string, Promise<unknown>>();
const api = new Api({ config, clock, store, s3, meili, mediaTokens, indexWorker, photoUploads });

const publicDir = join(process.cwd(), 'dist', 'public');
const seedAssetsDir = join(process.cwd(), 'seed-assets');

let schemaReady = false;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
};

function headerString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function parseCookies(headerValue: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headerValue) return out;
  for (const part of headerValue.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

function clientAddress(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0].trim();
    if (first.length > 0) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (error) {
    console.error('request error', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'internal', message: 'Something went wrong.' } }));
    } else {
      res.end();
    }
  }
});

server.keepAliveTimeout = 5000;

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = decodeURIComponent(url.pathname);
  const rawQuery = url.search;
  const method = (req.method ?? 'GET').toUpperCase();

  const body = await readBody(req, method);
  if (body === null) {
    return send(res, tooLargeError(), clock);
  }

  // Every response carries the server's Date (DP-61).
  if (path.startsWith('/api/') || path.startsWith('/media/')) {
    const apiRequest: ApiRequest = {
      method,
      path,
      query: parseQuery(rawQuery),
      headers: req.headers,
      body,
      cookies: parseCookies(headerString(req.headers.cookie)),
      remoteAddress: clientAddress(req),
      rawQuery,
    };
    const sender = path.startsWith('/media/')
      ? await mediaResponse(apiRequest)
      : await api.handle(apiRequest);
    return send(res, sender, clock);
  }

  // App pages and static files.
  return pageRoute(req, res, path, method);
}

function tooLargeError(): Sender {
  return { status: 413, headers: { 'content-type': 'application/json; charset=utf-8' }, body: Buffer.from(JSON.stringify({ error: { code: 'too_large', message: MSG.tooLarge } }), 'utf8') };
}

function readBody(req: http.IncomingMessage, method: string): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    if (method === 'GET' || method === 'HEAD' || method === 'DELETE') {
      resolve(Buffer.alloc(0));
      return;
    }
    const declared = Number(headerString(req.headers['content-length']) ?? 0);
    const type = (headerString(req.headers['content-type']) ?? '').split(';')[0];
    const isPhoto = type === 'image/png' || type === 'image/jpeg';
    const limit = isPhoto ? 5000000 : 16384;
    if (declared > limit) {
      resolve(null);
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, sender: Sender, clock: AppClock): void {
  const headers: Record<string, string | string[]> = { ...sender.headers };
  headers.date = clock.httpDate();
  res.writeHead(sender.status, headers);
  if (sender.body.length === 0) res.end();
  else res.end(sender.body);
}

// /media/<token> streams the stored object byte for byte (DP-46, DP-82).
async function mediaResponse(req: ApiRequest): Promise<Sender> {
  const token = req.path.slice('/media/'.length);
  const payload = mediaTokens.verify(token, clock.now());
  if (!payload) return errorReply({ status: 404, code: 'not_found', message: MSG.notFound });
  if (payload.unitCode !== null) {
    const unit = await store.unitByCode(payload.unitCode);
    if (!unit || unit.withdrawn) {
      return errorReply({ status: 404, code: 'not_found', message: MSG.notFound });
    }
  }
  const object = await s3.getObject(payload.key).catch(() => null);
  if (!object) return errorReply({ status: 503, code: 'media_unavailable', message: MSG.mediaUnavailable });
  const etag = createHash('md5').update(object.body ?? Buffer.alloc(0)).digest('hex');
  return {
    status: 200,
    headers: {
      'content-type': payload.contentType,
      'content-length': String(object.body?.length ?? 0),
      etag: `"${etag}"`,
      'cache-control': 'private, max-age=60',
    },
    body: object.body ?? Buffer.alloc(0),
  };
}

const PAGES: Record<string, string> = {
  '/': 'index.html',
  '/finder': 'finder.html',
  '/console': 'console.html',
};

async function pageRoute(req: http.IncomingMessage, res: http.ServerResponse, path: string, method: string): Promise<void> {
  if (method !== 'GET' && method !== 'HEAD') {
    const sender = jsonReply(404, { error: { code: 'not_found', message: MSG.notFound } });
    return send(res, sender, clock);
  }

  // The shared hold page carries no private data and is sent uncacheable,
  // without referrer and marked not for indexing (DP-79).
  if (path.startsWith('/shared/')) {
    const token = path.slice('/shared/'.length);
    let code: string | null = null;
    if (token.length >= 32 && !token.includes('/')) {
      const apiRequest: ApiRequest = {
        method: 'GET',
        path: `/api/shared/${token}`,
        query: {},
        headers: {},
        body: Buffer.alloc(0),
        cookies: {},
        remoteAddress: '',
        rawQuery: '',
      };
      const reply = await api.handle(apiRequest);
      if (reply.status === 200) {
        const body = JSON.parse(reply.body.toString('utf8')) as { unit: { code: string } };
        code = body.unit.code;
      }
    }
    const html = renderSharedPage(code);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      date: clock.httpDate(),
    });
    res.end(method === 'HEAD' ? undefined : html);
    return;
  }

  if (path.startsWith('/holds/')) {
    const html = readStatic('hold.html');
    if (html !== null) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', date: clock.httpDate() });
      res.end(method === 'HEAD' ? undefined : html);
      return;
    }
  }

  const page = PAGES[path];
  if (page !== undefined) {
    const html = readStatic(page);
    if (html !== null) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', date: clock.httpDate() });
      res.end(method === 'HEAD' ? undefined : html);
      return;
    }
  }

  // Static assets under /assets/; the strip keeps the subpath, and the bytes
  // live in dist/public/assets.
  const assetName = path.replace(/^\/+/, '').replace(/^assets\/+/, '');
  const denied = assetName === '' || assetName.startsWith('.') || assetName.includes('..');
  if (!denied) {
    const target = join(publicDir, 'assets', assetName);
    if (existsSync(target) && statSync(target).isFile()) {
      const bytes = readFileSync(target);
      res.writeHead(200, {
        'content-type': MIME[extname(target)] ?? 'application/octet-stream',
        'content-length': String(bytes.length),
        date: clock.httpDate(),
      });
      res.end(method === 'HEAD' ? undefined : bytes);
      return;
    }
  }

  // Seed assets (models, textures) are served only through signed media links,
  // never directly, so fall through to 404 for any other path.
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', date: clock.httpDate() });
  res.end(method === 'HEAD' ? undefined : notFoundPage());
}

function readStatic(name: string): string | null {
  const target = join(publicDir, name);
  if (!existsSync(target)) return null;
  return readFileSync(target, 'utf8');
}

function renderSharedPage(code: string | null): string {
  const title = code ? `Home ${code} · Highwater` : 'Shared link · Highwater';
  const html = readStatic('shared.html');
  if (html === null) return notFoundPage();
  return html
    .replace(/<title>.*<\/title>/, `<title>${title}</title>`)
    .replace('<meta name="robots" content="noindex">', '<meta name="robots" content="noindex">');
}

function notFoundPage(): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found · Highwater</title></head><body><h1>Not found</h1></body></html>';
}

// ---------- boot ----------

async function start(): Promise<void> {
  // The server starts and serves even while Postgres, Meilisearch or MinIO are
  // unreachable, and keeps retrying them in the background (DP-56).
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`highwater listening on 0.0.0.0:${config.port}`);
  });

  let storageResolve: () => void = () => undefined;
  let databaseResolve: () => void = () => undefined;

  // Postgres: retry every 2 seconds until the schema is applied. The storage
  // boot waits for this so the photo confirmation sees the seeded rows.
  const databaseGate = new Promise<void>((resolve) => {
    databaseResolve = resolve;
  });
  const bootDatabase = async (): Promise<void> => {
    for (;;) {
      try {
        await store.applySchema(SCHEMA_SQL);
        await seed(store, clock);
        schemaReady = true;
        databaseResolve();
        return;
      } catch (error) {
        console.error('postgres not ready, retrying', (error as Error).message);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  };
  void bootDatabase();

  // Wait until storage has confirmed the seeded photographs before indexing,
  // so the first reads answer with the seeded photo state. Postgres is the
  // source of truth, so the API serves correctly even while this completes.
  const storageGate = new Promise<void>((resolve) => {
    storageResolve = resolve;
  });
  const bootStorage = async (): Promise<void> => {
    await databaseGate;
    for (;;) {
      try {
        await s3.ensureBucket();
        await uploadSeedObjects();
        storageResolve();
        return;
      } catch (error) {
        console.error('storage not ready, retrying', (error as Error).message);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  };
  void bootStorage();

  const bootSearch = async (): Promise<void> => {
    await storageGate;
    for (;;) {
      try {
        if (await meili.isUp()) {
          await meili.applySettings({
            searchableAttributes: ['code', 'facing', 'viewTag', 'band'],
            filterableAttributes: ['bedrooms', 'band', 'facing', 'viewTag', 'status', 'price', 'floor', 'stack'],
            sortableAttributes: ['price', 'floor', 'stack'],
            typoTolerance: { enabled: false },
          });
          await queueAllUnitsForIndex();
          indexWorker.start();
          return;
        }
      } catch (error) {
        console.error('search not ready, retrying', (error as Error).message);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  };
  void bootSearch();
}

async function queueAllUnitsForIndex(): Promise<void> {
  const units = await store.allUnits();
  const documents = units.filter((unit) => unit.released && !unit.withdrawn).map((unit) => indexWorker.documentFor(unit));
  if (documents.length > 0) {
    const task = await meili.upsertDocuments(documents);
    if (task >= 0) await meili.waitForTask(task, 20000);
  }
}

async function uploadSeedObjects(): Promise<void> {
  const uploads: Array<{ key: string; file: string; type: string }> = [
    { key: 'models/tower-shell.glb', file: 'tower-shell.glb', type: 'model/gltf-binary' },
    { key: 'textures/facade.png', file: 'facade.png', type: 'image/png' },
    { key: 'textures/duotone-ramp.png', file: 'duotone-ramp.png', type: 'image/png' },
  ];
  for (const band of ['03-09', '10-19', '20-29', '30-35', '36-38']) {
    uploads.push({ key: `models/plates/${band}.glb`, file: `plate-${band}.glb`, type: 'model/gltf-binary' });
  }
  const bands: Array<{ band: string; floors: [number, number] }> = [
    { band: '03-09', floors: [3, 9] },
    { band: '10-19', floors: [10, 19] },
    { band: '20-29', floors: [20, 29] },
    { band: '30-35', floors: [30, 35] },
  ];
  const stacks = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  for (const { band } of bands) {
    for (const stack of stacks) {
      if (band === '30-35' && stack === 'H') continue;
      uploads.push({ key: `views/bands/${band}/${stack}.png`, file: `view-${band}-${stack}.png`, type: 'image/png' });
    }
  }

  for (const upload of uploads) {
    const exists = await s3.objectExists(upload.key).catch(() => false);
    if (exists) continue;
    const bytes = readFileSync(join(seedAssetsDir, upload.file));
    await s3.putObject(upload.key, bytes, upload.type);
  }

  // Seeded view photographs are confirmed with the size and checksum check, and
  // that check keeps retrying while storage is unreachable.
  await confirmSeededPhotos(bands, stacks);
}

async function confirmSeededPhotos(bands: Array<{ band: string; floors: [number, number] }>, stacks: string[]): Promise<void> {
  for (const { band } of bands) {
    for (const stack of stacks) {
      if (band === '30-35' && stack === 'H') continue;
      const key = `views/bands/${band}/${stack}.png`;
      const head = await s3.headObject(key).catch(() => null);
      if (!head) continue;
      const bytes = await s3.getObject(key).catch(() => null);
      if (!bytes || !bytes.body) continue;
      const checksum = createHash('md5').update(bytes.body).digest('hex');
      if (head.size !== bytes.body.length || head.etag !== checksum) continue;
        await markBandPhotographed(band, stack, key, bytes.body.length, checksum);
      }
  }
}

async function markBandPhotographed(band: string, stack: string, key: string, size: number, checksum: string): Promise<void> {
  const [low, high] = band.split('-').map((part) => Number(part.replace(/^0/, '')));
  await store.transaction(async (tx) => {
    const rows = await tx.query(
      `SELECT code FROM units WHERE stack = $1 AND floor BETWEEN $2 AND $3 AND view_photographed = false`,
      [stack, String(low), String(high)],
    );
    for (const row of rows.rows) {
      await tx.query(
        `UPDATE units SET view_photographed = true, view_photo_key = $1, view_photo_size = $2, view_photo_checksum = $3 WHERE code = $4`,
        [key, String(size), checksum, String(row.code)],
      );
    }
  });
}

void start();

export { schemaReady };
