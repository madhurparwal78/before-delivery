import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { buildRouteTable } from './api';
import { config } from './config';
import { applySchema } from './db/schema';
import { applySeed } from './db/seed';
import { query, queryOne, waitForDatabase } from './db/pool';
import { parseSignatureHeader, signatureMatches } from './domain/signature';
import { hashPartnerKey } from './domain/password';
import { ApiError, failure } from './http/errors';
import {
  PartnerKeyRecord,
  Reply,
  RouteTable,
  RunContext,
  SenderRecord,
  SessionResolution,
  headerValue,
  sha256Of,
} from './http/runtime';
import { resolveSession } from './http/session';
import { ensureBucket } from './services/s3';
import { ensureTenant } from './services/killbill';
import { findWorkspace } from './store/workspace';
import { matchPage, pageShell, sitemapXml } from './web/shell';
import { startWorker } from './worker';
import { allJurisdictions } from './store/workspace';
import { requestPageExists } from './api/requestpages';

const PUBLIC_ROOT = join(__dirname, '..', 'public');

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function jsonText(value: unknown): string {
  return JSON.stringify(value, (_key, inner) =>
    typeof inner === 'bigint' ? Number(inner) : (inner as unknown),
  );
}

function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  if (reply.setCookie !== undefined) headers['Set-Cookie'] = reply.setCookie;
  if (reply.bytes !== undefined) {
    headers['Content-Type'] = reply.contentType ?? 'application/octet-stream';
    headers['Content-Length'] = String(reply.bytes.length);
    response.writeHead(reply.status, headers);
    response.end(reply.bytes);
    return;
  }
  if (reply.json === undefined) {
    response.writeHead(reply.status, headers);
    response.end();
    return;
  }
  const body = Buffer.from(jsonText(reply.json), 'utf8');
  headers['Content-Type'] = 'application/json; charset=utf-8';
  headers['Content-Length'] = String(body.length);
  response.writeHead(reply.status, headers);
  response.end(body);
}

function sendError(response: ServerResponse, error: ApiError): void {
  send(response, {
    status: error.status,
    json: error.body(),
    headers: error.extraHeaders,
  });
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  const body = Buffer.from(html, 'utf8');
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': String(body.length),
  });
  response.end(body);
}

function serveStatic(pathname: string, response: ServerResponse): boolean {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  if (relative === '') return false;
  const full = join(PUBLIC_ROOT, relative);
  if (!full.startsWith(PUBLIC_ROOT)) return false;
  if (!existsSync(full) || !statSync(full).isFile()) return false;
  const contentType = CONTENT_TYPES[extname(full)];
  if (contentType === undefined) return false;
  response.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600',
  });
  createReadStream(full).pipe(response);
  return true;
}

function bodyReader(request: IncomingMessage): (limit: number) => Promise<{
  bytes: Buffer;
  tooLarge: boolean;
}> {
  let pending: Promise<{ bytes: Buffer; tooLarge: boolean }> | null = null;
  return (limit: number) => {
    if (pending !== null) return pending;
    pending = (async () => {
      const declared = headerValue(request.headers, 'content-length');
      if (declared !== null && Number.parseInt(declared, 10) > limit) {
        // The body is discarded unread, so the 413 answers before any parsing.
        request.resume();
        return { bytes: Buffer.alloc(0), tooLarge: true };
      }
      const chunks: Buffer[] = [];
      let total = 0;
      let tooLarge = false;
      for await (const chunk of request) {
        const part = chunk as Buffer;
        total += part.length;
        if (total > limit) {
          tooLarge = true;
          continue;
        }
        chunks.push(part);
      }
      return { bytes: tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks), tooLarge };
    })();
    return pending;
  };
}

async function findPartnerKey(request: IncomingMessage): Promise<PartnerKeyRecord | null> {
  const header = headerValue(request.headers, 'authorization');
  if (header === null || !header.toLowerCase().startsWith('bearer ')) return null;
  const secret = header.slice(7).trim();
  if (secret === '') return null;
  const row = await queryOne<{
    id: string;
    workspace_slug: string;
    label: string;
    starts_with: string;
  }>(
    `SELECT id, workspace_slug, label, starts_with FROM partner_keys
     WHERE key_hash = $1 AND revoked_at IS NULL`,
    [hashPartnerKey(secret)],
  );
  if (row === null) return null;
  await query('UPDATE partner_keys SET last_used_at = $2 WHERE id = $1', [row.id, new Date()]);
  return {
    id: row.id,
    workspaceSlug: row.workspace_slug,
    label: row.label,
    startsWith: row.starts_with,
  };
}

async function findSender(slug: string, raw: Buffer, request: IncomingMessage, now: Date): Promise<SenderRecord | null> {
  const header = parseSignatureHeader(headerValue(request.headers, 'lanternline-signature') ?? undefined);
  const lei = headerValue(request.headers, 'lanternline-sender');
  if (header === null || lei === null) return null;
  const row = await queryOne<{
    id: string;
    legal_name: string;
    lei: string;
    signing_value: string | null;
  }>(
    `SELECT id, legal_name, lei, signing_value FROM counterparties
     WHERE workspace_slug = $1 AND lei = $2 AND network = 'on_network'`,
    [slug, lei.toUpperCase()],
  );
  if (row === null || row.signing_value === null) return null;
  if (!signatureMatches(header, row.signing_value, raw, now)) return null;
  return { counterpartyId: row.id, legalName: row.legal_name, lei: row.lei };
}

const REPLAY_SKIPPED = [401, 429, 503];

async function storedPartnerResponse(
  partnerKeyId: string,
  requestKey: string,
  bodySha256: string,
): Promise<Reply | null> {
  const row = await queryOne<{
    body_sha256: string;
    response_status: number;
    response_body: string;
  }>(
    'SELECT body_sha256, response_status, response_body FROM partner_request_keys WHERE partner_key_id = $1 AND request_key = $2',
    [partnerKeyId, requestKey],
  );
  if (row === null) return null;
  if (row.body_sha256 !== bodySha256) throw failure('request_key_reused');
  return { status: row.response_status, json: JSON.parse(row.response_body) as unknown };
}

async function rememberPartnerResponse(
  partnerKeyId: string,
  requestKey: string,
  bodySha256: string,
  status: number,
  body: unknown,
): Promise<void> {
  if (REPLAY_SKIPPED.includes(status)) return;
  await query(
    `INSERT INTO partner_request_keys (partner_key_id, request_key, body_sha256, response_status, response_body, created_at)
     VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT (partner_key_id, request_key) DO NOTHING`,
    [partnerKeyId, requestKey, bodySha256, status, jsonText(body)],
  );
}

async function pageStatus(pathname: string, now: Date): Promise<number> {
  const match = matchPage(pathname);
  if (match.kind === 'unknown') return 404;
  if (match.kind === 'exchange') {
    const row = await queryOne<{ listed: boolean }>('SELECT listed FROM listings WHERE slug = $1', [
      match.listingSlug,
    ]);
    if (row === null) return 404;
    return row.listed ? 200 : 410;
  }
  if (match.kind === 'request-page') {
    const state = await requestPageExists(match.token, now);
    if (state === 'missing') return 404;
    return state === 'ended' ? 410 : 200;
  }
  return 200;
}

async function handle(
  table: RouteTable,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const now = new Date();
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;
  const method = request.method ?? 'GET';

  if (method === 'GET' && pathname === '/sitemap.xml') {
    const codes = (await allJurisdictions()).map((row) => row.code);
    const slugs = (
      await query<{ slug: string }>(
        'SELECT slug FROM listings WHERE listed = true ORDER BY sort_order',
      )
    ).map((row) => row.slug);
    const xml = sitemapXml(config().publicUrl, codes, slugs);
    const body = Buffer.from(xml, 'utf8');
    response.writeHead(200, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Length': String(body.length),
    });
    response.end(body);
    return;
  }

  if (!pathname.startsWith('/api/')) {
    if (method === 'GET' && serveStatic(pathname, response)) return;
    if (method !== 'GET' && method !== 'HEAD') {
      sendHtml(response, 404, pageShell());
      return;
    }
    sendHtml(response, await pageStatus(pathname, now), pageShell());
    return;
  }

  const resolved = table.resolve(method, pathname);
  if (resolved instanceof ApiError) {
    sendError(response, resolved);
    return;
  }

  const readBody = bodyReader(request);
  let sessionCache: Promise<SessionResolution> | null = null;
  let partnerCache: Promise<PartnerKeyRecord | null> | null = null;
  const context: RunContext = {
    method,
    url,
    params: resolved.params,
    headers: request.headers,
    now,
    readBody,
    resolveSession: () => {
      if (sessionCache === null) sessionCache = resolveSession(request.headers, now);
      return sessionCache;
    },
    resolvePartnerKey: () => {
      if (partnerCache === null) partnerCache = findPartnerKey(request);
      return partnerCache;
    },
    resolveSender: (slug, raw) => findSender(slug, raw, request, now),
    loadWorkspace: findWorkspace,
    replayPartnerRequest: storedPartnerResponse,
  };

  const requestKey = headerValue(request.headers, 'request-key');
  let reply: Reply;
  try {
    reply = await resolved.route.run(context);
  } catch (error) {
    if (error instanceof ApiError) {
      reply = { status: error.status, json: error.body(), headers: error.extraHeaders };
    } else {
      process.stderr.write(`${String(error)}\n`);
      reply = { status: 500, json: { error: { code: 'server_error', message: 'Not found.', fields: {} } } };
    }
  }
  if (pathname === '/api/partner/v1/cases' && requestKey !== null && requestKey !== '') {
    const key = await context.resolvePartnerKey();
    const read = await readBody(64000);
    if (key !== null && !read.tooLarge && reply.json !== undefined) {
      await rememberPartnerResponse(
        key.id,
        requestKey,
        sha256Of(read.bytes),
        reply.status,
        reply.json,
      ).catch(() => undefined);
    }
  }
  send(response, reply);
}

async function boot(): Promise<void> {
  const settings = config();
  await waitForDatabase();
  await applySchema();
  await applySeed();
  void ensureBucket().catch(() => retryLater(ensureBucket));
  void ensureTenant().catch(() => retryLater(ensureTenant));
  const table = buildRouteTable();
  startWorker();
  const server = createServer((request, response) => {
    handle(table, request, response).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      response.end('{"error":{"code":"server_error","message":"Not found.","fields":{}}}');
    });
  });
  server.listen(settings.port, '0.0.0.0');
}

function retryLater(work: () => Promise<void>): void {
  const timer = setTimeout(() => {
    work().catch(() => retryLater(work));
  }, 10000);
  timer.unref();
}

void boot();
