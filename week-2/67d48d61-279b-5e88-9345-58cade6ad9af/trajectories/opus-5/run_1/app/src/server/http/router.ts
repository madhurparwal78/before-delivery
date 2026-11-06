import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, resolve } from 'node:path';
import { MAX_JSON_BYTES, MAX_MULTIPART_BYTES, taskNumber } from '../../shared/domain.js';
import { addEventClient } from '../events.js';
import {
  downloadAttachment,
  listAttachments,
  uploadAttachment,
} from '../routes/attachments.js';
import { healthReply, productionReply, statusReply } from '../routes/meta.js';
import { fileRequest, getRequests } from '../routes/requests.js';
import {
  addRelation,
  bulkTasks,
  createTask,
  getTask,
  listTasks,
  patchTask,
  removeRelation,
  requireTask,
  snapshotReply,
  taskActivity,
  undoLastChange,
} from '../routes/tasks.js';
import { decideTriage } from '../routes/triage.js';
import {
  checkOrigin,
  readActor,
  readIdempotencyKey,
  readJsonBody,
  readMultipart,
  type Ctx,
} from './context.js';
import { ApiError, apiError } from './errors.js';
import type { Reply } from './reply.js';

const CLIENT_ROOT = resolve(process.cwd(), 'dist/client');
const SCREEN_PATHS = new Set(['/tasks', '/triage', '/requests']);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = (req.method ?? 'GET').toUpperCase();

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    try {
      const reply = await handleApi(req, res, url, method);
      if (!reply.streamed) send(res, reply);
    } catch (error) {
      if (error instanceof ApiError) {
        send(res, { status: error.status, json: error.body() });
        return;
      }
      process.stderr.write(`${String(error)}\n`);
      send(res, {
        status: 500,
        json: { error: { code: 'server_error', message: 'Promptside could not finish that.' } },
      });
    }
    return;
  }

  await serveClient(res, url, method);
}

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  if (reply.buffer) {
    headers['Content-Type'] = reply.contentType ?? 'application/octet-stream';
    headers['Content-Length'] = String(reply.buffer.length);
    res.writeHead(reply.status, headers);
    res.end(reply.buffer);
    return;
  }
  if (reply.json === undefined || reply.json === null) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const body = Buffer.from(JSON.stringify(reply.json), 'utf8');
  headers['Content-Type'] = 'application/json; charset=utf-8';
  headers['Content-Length'] = String(body.length);
  res.writeHead(reply.status, headers);
  res.end(body);
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<Reply> {
  const segments = url.pathname.split('/').filter((part) => part.length > 0).slice(1);

  if (WRITE_METHODS.has(method)) {
    checkOrigin(req);
    const declared = Number(req.headers['content-length'] ?? '0');
    const limit = isUpload(segments) ? MAX_MULTIPART_BYTES : MAX_JSON_BYTES;
    if (Number.isFinite(declared) && declared > limit) throw apiError.payloadTooLarge();
  }

  const route = segments.join('/');
  const idFrom = (value: string | undefined): number | null =>
    value === undefined ? null : taskNumber(value);

  if (method === 'GET' && route === 'health') return healthReply();
  if (method === 'GET' && route === 'status') return statusReply();
  if (method === 'GET' && route === 'production') return productionReply();
  if (method === 'GET' && route === 'snapshot') return snapshotReply();
  if (method === 'GET' && route === 'requests') return getRequests();
  if (method === 'GET' && route === 'events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': open\n\n');
    addEventClient(res);
    return { status: 200, streamed: true };
  }
  if (method === 'GET' && route === 'tasks') return listTasks(await context(req, url, method));
  if (method === 'GET' && segments[0] === 'tasks' && segments.length === 2) {
    return getTask(await requireTask(idFrom(segments[1])));
  }
  if (
    method === 'GET' &&
    segments[0] === 'tasks' &&
    segments.length === 3 &&
    segments[2] === 'activity'
  ) {
    return taskActivity(await requireTask(idFrom(segments[1])));
  }
  if (
    method === 'GET' &&
    segments[0] === 'tasks' &&
    segments.length === 3 &&
    segments[2] === 'attachments'
  ) {
    return listAttachments(await requireTask(idFrom(segments[1])));
  }
  if (
    method === 'GET' &&
    segments[0] === 'attachments' &&
    segments.length === 3 &&
    segments[2] === 'download'
  ) {
    return downloadAttachment(segments[1] as string);
  }

  if (method === 'POST' && route === 'tasks') return createTask(await context(req, url, method));
  if (method === 'POST' && route === 'tasks/bulk') return bulkTasks(await context(req, url, method));
  if (method === 'POST' && route === 'undo') return undoLastChange(await context(req, url, method));
  if (method === 'POST' && route === 'requests') {
    return fileRequest(await context(req, url, method));
  }
  if (method === 'PATCH' && segments[0] === 'tasks' && segments.length === 2) {
    const number = await requireTask(idFrom(segments[1]));
    return patchTask(await context(req, url, method), number);
  }
  if (
    method === 'POST' &&
    segments[0] === 'tasks' &&
    segments.length === 3 &&
    segments[2] === 'relations'
  ) {
    const number = await requireTask(idFrom(segments[1]));
    return addRelation(await context(req, url, method), number);
  }
  if (
    method === 'DELETE' &&
    segments[0] === 'tasks' &&
    segments.length === 4 &&
    segments[2] === 'relations'
  ) {
    const number = await requireTask(idFrom(segments[1]));
    const target = await requireTask(idFrom(segments[3]));
    return removeRelation(await context(req, url, method, 'none'), number, target);
  }
  if (
    method === 'POST' &&
    segments[0] === 'tasks' &&
    segments.length === 3 &&
    segments[2] === 'attachments'
  ) {
    const number = await requireTask(idFrom(segments[1]));
    return uploadAttachment(await context(req, url, method, 'multipart'), number);
  }
  if (
    method === 'POST' &&
    segments[0] === 'triage' &&
    segments.length === 3 &&
    segments[2] === 'decision'
  ) {
    const number = await requireTask(idFrom(segments[1]));
    return decideTriage(await context(req, url, method), number);
  }

  throw apiError.notFound();
}

function isUpload(segments: string[]): boolean {
  return segments[0] === 'tasks' && segments.length === 3 && segments[2] === 'attachments';
}

async function context(
  req: IncomingMessage,
  url: URL,
  method: string,
  body: 'json' | 'multipart' | 'none' = 'json',
): Promise<Ctx> {
  const actor = readActor(req);
  const key = readIdempotencyKey(req);
  const wantsBody = WRITE_METHODS.has(method) && body !== 'none';
  return {
    req,
    url,
    method,
    body: wantsBody && body === 'json' ? await readJsonBody(req) : {},
    multipart: wantsBody && body === 'multipart' ? await readMultipart(req) : null,
    actor: actor.actor,
    headerFields: { ...actor.headerFields, ...key.headerFields },
    idempotencyKey: key.key,
  };
}

async function serveClient(res: ServerResponse, url: URL, method: string): Promise<void> {
  if (method !== 'GET' && method !== 'HEAD') {
    await sendPage(res, 404);
    return;
  }
  if (url.pathname === '/') {
    res.writeHead(302, { Location: '/tasks' });
    res.end();
    return;
  }
  if (SCREEN_PATHS.has(url.pathname)) {
    await sendPage(res, 200);
    return;
  }

  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(CLIENT_ROOT, relative);
  if (!file.startsWith(CLIENT_ROOT)) {
    await sendPage(res, 404);
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) {
      await sendPage(res, 404);
      return;
    }
    const extension = file.slice(file.lastIndexOf('.'));
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
      'Content-Length': String(body.length),
      'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(method === 'HEAD' ? undefined : body);
  } catch {
    await sendPage(res, 404);
  }
}

async function sendPage(res: ServerResponse, status: number): Promise<void> {
  try {
    const body = await readFile(join(CLIENT_ROOT, 'index.html'));
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(body.length),
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Promptside');
  }
}
