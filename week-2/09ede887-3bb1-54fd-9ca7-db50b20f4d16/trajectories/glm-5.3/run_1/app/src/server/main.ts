/**
 * The HTTP server. One origin serves the JSON API, the pages and the assets.
 * Every API refusal is JSON in its version's error shape; any other request
 * that is neither a published page nor an asset answers 404 with the
 * application page, which shows the unknown-address copy.
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, type Pool } from './db/pool.js';
import { installSchemaAndSeed } from './db/seed.js';
import { readConfig, type Config } from './config.js';
import { handleApi, type ApiRequest, type Version } from './api/router.js';

const MAX_BODY = 10240;

interface ServerState {
  pool: Pool | null;
  ready: boolean;
  config: Config;
  indexHtml: Buffer | null;
}

/** The published page routes. */
const PAGES = ['/', '/agenda', '/my-agenda', '/speakers', '/record', '/organiser', '/signin', '/signup'];

function isPagePath(pathname: string): boolean {
  if (PAGES.includes(pathname)) return true;
  return pathname.startsWith('/sessions/') && pathname.slice('/sessions/'.length) !== '';
}

/** A path is an API request when it is exactly `/api` or starts with `/api/`. */
function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/** Malformed percent-encoding: a decode that throws, or a lone surrogate. */
function hasMalformedEncoding(pathname: string): boolean {
  try {
    for (const ch of decodeURIComponent(pathname)) {
      const c = ch.codePointAt(0) ?? 0;
      if (c >= 0xd800 && c <= 0xdfff) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function classifyApi(pathname: string): {
  version: Version | null;
  relative: string | null;
  unversioned: 'health' | 'contract' | null;
} {
  if (pathname === '/api/health') return { version: null, relative: null, unversioned: 'health' };
  if (pathname === '/api/_contract') return { version: null, relative: null, unversioned: 'contract' };
  if (pathname === '/api/v2' || pathname.startsWith('/api/v2/')) {
    return { version: 'v2', relative: rest(pathname, '/api/v2'), unversioned: null };
  }
  if (pathname === '/api/v1' || pathname.startsWith('/api/v1/')) {
    return { version: 'v1', relative: rest(pathname, '/api/v1'), unversioned: null };
  }
  return { version: 'v1', relative: rest(pathname, '/api'), unversioned: null };
}

function rest(pathname: string, prefix: string): string | null {
  const tail = pathname.slice(prefix.length);
  return tail === '' ? null : tail;
}

const STARTING_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Keel Outpost 2026</title></head>
<body><main><p>Keel Outpost is starting. Try again in a moment.</p></main></body></html>`;

async function main(): Promise<void> {
  const config = readConfig(process.env);
  const state: ServerState = { pool: null, ready: false, config, indexHtml: null };
  const root = path.dirname(fileURLToPath(import.meta.url));

  // The database may not be ready at boot: stay up and retry every 2 seconds.
  const connect = async (): Promise<void> => {
    for (;;) {
      const pool = createPool(config.databaseUrl);
      try {
        await installSchemaAndSeed(pool);
        state.pool = pool;
        state.ready = true;
        return;
      } catch (err) {
        await pool.end().catch(() => undefined);
        const code = (err as { code?: string }).code;
        if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === '28P01') {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        throw err;
      }
    }
  };
  void connect();

  const server = http.createServer((req, res) => {
    void handle(req, res, state, root).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end('{"error":"unavailable","message":"Keel Outpost is not reachable right now. Try again in a moment."}');
      } else {
        res.end();
      }
    });
  });
  server.listen(config.port, '0.0.0.0');
}

interface BodyFacts {
  raw: Buffer;
  oversize: boolean;
  contentType: string;
  malformed: boolean;
  parsed: unknown;
}

function readBody(req: http.IncomingMessage): Promise<BodyFacts> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let oversize = false;
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        // Drain the rest without buffering it, so the response can be sent.
        oversize = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      let malformed = false;
      let parsed: unknown = null;
      if (!oversize && raw.length > 0) {
        try {
          parsed = JSON.parse(raw.toString('utf8'));
        } catch {
          malformed = true;
        }
      }
      resolve({ raw, oversize, contentType, malformed, parsed });
    });
    req.on('error', () => {
      resolve({ raw: Buffer.concat(chunks), oversize, contentType, malformed: false, parsed: null });
    });
    req.on('close', () => {
      // A closed request without an end event still has to resolve.
      if (!req.readableEnded) {
        resolve({ raw: Buffer.concat(chunks), oversize, contentType, malformed: false, parsed: null });
      }
    });
  });
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  state: ServerState,
  root: string,
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (isApiPath(pathname)) {
    const cls = classifyApi(pathname);
    if (hasMalformedEncoding(pathname)) {
      return sendJson(res, 400, errorShape(cls.version, 'invalid', 'That request could not be read.'), []);
    }
    const body =
      method === 'GET' || method === 'HEAD'
        ? { raw: Buffer.alloc(0), oversize: false, contentType: 'application/json', malformed: false, parsed: null }
        : await readBody(req);
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
    const keyHeader = req.headers['idempotency-key'];
    let idempotencyKey: string | null = null;
    if (keyHeader !== undefined) {
      const key = Array.isArray(keyHeader) ? keyHeader[0]! : keyHeader;
      if (!/^[ -~]{1,255}$/.test(key)) {
        return sendJson(res, 400, errorShape(cls.version, 'invalid', 'That request could not be read.'), []);
      }
      idempotencyKey = key;
    }
    const apiReq: ApiRequest = {
      method,
      relative: cls.relative,
      version: cls.version,
      unversioned: cls.unversioned,
      query: url.searchParams,
      body: body.parsed,
      rawBody: body.raw.length === 0 ? null : body.raw,
      bodyOversize: body.oversize,
      bodyContentType: body.contentType,
      bodyMalformed: body.malformed,
      token,
      idempotencyKey,
      segments: null,
      prefixUsed: cls.version === 'v2' ? '/api/v2' : cls.version === 'v1' ? '/api/v1' : '/api',
    };
    const outcome = await handleApi(apiReq, {
      pool: state.pool!,
      config: state.config,
      ready: state.ready,
    });
    const headers: Array<[string, string]> = [...outcome.headers, ['Content-Type', outcome.contentType]];
    if (cls.version === 'v1') {
      headers.push(['Deprecation', 'true'], ['Sunset', 'Sat, 31 Oct 2026 16:00:00 GMT']);
    }
    res.writeHead(outcome.status, headers);
    res.end(method === 'HEAD' ? undefined : outcome.body);
    return;
  }

  // Assets are served from the build; missing ones answer a bare 404.
  if (pathname.startsWith('/assets/')) {
    const target = path.join(root, 'public', pathname);
    if (!target.startsWith(path.join(root, 'public') + path.sep) || target.endsWith('.map')) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end();
      return;
    }
    try {
      const data = await readFile(target);
      res.writeHead(200, { 'Content-Type': contentTypeFor(target), 'Cache-Control': 'public, max-age=3600' });
      res.end(data);
      return;
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end();
      return;
    }
  }

  // Pages answer with the application page; anything else answers 404 with it.
  if (!state.ready) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(STARTING_PAGE);
    return;
  }
  const index = await readIndex(state, root);
  if (isPagePath(pathname)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(index);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(index);
}

async function readIndex(state: ServerState, root: string): Promise<Buffer> {
  if (state.indexHtml === null) {
    state.indexHtml = await readFile(path.join(root, 'public', 'index.html'));
  }
  return state.indexHtml;
}

function errorShape(version: Version | null, code: string, message: string): string {
  if (version === 'v2') return `{"error":{"code":${JSON.stringify(code)},"message":${JSON.stringify(message)}}}`;
  return `{"error":${JSON.stringify(code)},"message":${JSON.stringify(message)}}`;
}

function contentTypeFor(file: string): string {
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  if (file.endsWith('.ttf')) return 'font/ttf';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function sendJson(res: http.ServerResponse, status: number, body: string, headers: Array<[string, string]>): void {
  res.writeHead(status, [...headers, ['Content-Type', 'application/json; charset=utf-8']]);
  res.end(body);
}

main();
