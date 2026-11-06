// The API's one pipeline: the precedence ladder, the one error shape and the route table.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { COPY } from '../shared/copy';
import { readSession, type Desk, type SessionRead } from './session';

const JSON_LIMIT = 1_000_000;
const UPLOAD_LIMIT = 9_000_000;

export const FRAME_FILE_LIMIT = 8_000_000;

interface ErrorShape {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

/** A refused request. Thrown anywhere in a handler and answered in the one error shape. */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    override readonly message: string,
    readonly fields?: Record<string, string>,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function notFound(): Refusal {
  return new Refusal(404, 'notFound', 'That address does not exist.');
}

export function conflict(message: string): Refusal {
  return new Refusal(409, 'conflict', message);
}

export function stale(message: string): Refusal {
  return new Refusal(412, 'stale', message);
}

export function unavailable(message: string): Refusal {
  return new Refusal(503, 'unavailable', message);
}

export function invalid(fields: Record<string, string>): Refusal {
  return new Refusal(422, 'invalid', Object.values(fields)[0] as string, fields);
}

export function refused(message: string): Refusal {
  return new Refusal(422, 'refused', message);
}

export function limited(message: string, retryAfterSeconds: number): Refusal {
  return new Refusal(429, 'rateLimited', message, undefined, { 'Retry-After': String(retryAfterSeconds) });
}

interface UploadedFile {
  fileName: string;
  bytes: Buffer;
}

export interface Context {
  params: Record<string, string>;
  query: URLSearchParams;
  session: SessionRead;
  /** The signed-in desk; routes with `desk` auth always have one. */
  desk: Desk;
  rawBody: Buffer;
  body: Record<string, unknown>;
  file: UploadedFile | null;
  now: number;
  /** What a route's `load` step found, before the content type is judged. */
  found: any;
}

export interface Answer {
  status: number;
  json?: unknown;
  bytes?: { data: Buffer; type: string; fileName?: string };
}

export function ok(json: unknown, status = 200): Answer {
  return { status, json };
}

export function noContent(): Answer {
  return { status: 204 };
}

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  shape: string;
  auth: 'desk' | 'none';
  body: 'json' | 'multipart' | 'none';
  fileLimit: number;
  fileRefusal: ((context: Context) => Promise<string>) | undefined;
  rate: ((context: Context) => Promise<void>) | undefined;
  load: ((context: Context) => Promise<unknown>) | undefined;
  handle: (context: Context) => Promise<Answer>;
}

const routes: Route[] = [];

interface RouteOptions {
  auth?: 'desk' | 'none';
  body?: 'json' | 'multipart' | 'none';
  fileLimit?: number;
  fileRefusal?: (context: Context) => Promise<string>;
  rate?: (context: Context) => Promise<void>;
  load?: (context: Context) => Promise<unknown>;
}

export function route(method: string, path: string, options: RouteOptions, handle: (context: Context) => Promise<Answer>): void {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:([a-zA-Z]+)/g, (_, key: string) => { keys.push(key); return '([^/]+)'; })}$`);
  routes.push({
    method,
    pattern,
    keys,
    shape: path.replace(/:[a-zA-Z]+/g, ':'),
    auth: options.auth ?? 'desk',
    body: options.body ?? (method === 'GET' || method === 'DELETE' ? 'none' : 'json'),
    fileLimit: options.fileLimit ?? FRAME_FILE_LIMIT,
    fileRefusal: options.fileRefusal,
    rate: options.rate,
    load: options.load,
    handle,
  });
}

function send(res: ServerResponse, answer: Answer, headers: Record<string, string> = {}): void {
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.setHeader('Cache-Control', 'no-store');
  if (answer.bytes) {
    res.setHeader('Content-Type', answer.bytes.type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (answer.bytes.fileName) res.setHeader('Content-Disposition', `attachment; filename="${answer.bytes.fileName.replace(/[^\x20-\x7e]|"/g, '_')}"`);
    res.statusCode = answer.status;
    res.end(answer.bytes.data);
    return;
  }
  res.statusCode = answer.status;
  if (answer.json === undefined) {
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(answer.json));
}

function sendRefusal(res: ServerResponse, refusal: Refusal): void {
  const error: ErrorShape = { code: refusal.code, message: refusal.message };
  if (refusal.fields) error.fields = refusal.fields;
  send(res, { status: refusal.status, json: { error } }, refusal.headers);
}

function isLocalOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  return origin === `http://${req.headers.host}`;
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) parts.push(chunk);
    });
    req.on('end', () => resolve(size > limit ? null : Buffer.concat(parts)));
    req.on('error', reject);
  });
}

/** The first file part of a multipart body; other fields are ignored. */
function firstFile(raw: Buffer, contentType: string): UploadedFile | null {
  const boundary = /boundary="?([^";]+)"?/.exec(contentType)?.[1];
  if (!boundary) return null;
  const marker = Buffer.from(`--${boundary}`);
  let at = raw.indexOf(marker);
  while (at !== -1) {
    const headerStart = at + marker.length + 2;
    const headerEnd = raw.indexOf('\r\n\r\n', headerStart);
    if (headerEnd === -1) return null;
    const next = raw.indexOf(marker, headerEnd);
    if (next === -1) return null;
    const headers = raw.subarray(headerStart, headerEnd).toString('utf8');
    const disposition = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] ?? '';
    const fileName = /filename="([^"]*)"/.exec(disposition)?.[1];
    if (/\bname="file"/.test(disposition) && fileName !== undefined) {
      return { fileName, bytes: raw.subarray(headerEnd + 4, next - 2) };
    }
    at = next;
  }
  return null;
}

/** A path segment as text; one that can't be decoded, or holds a NUL, names nothing. */
function pathSegment(raw: string): string {
  let text: string;
  try {
    text = decodeURIComponent(raw);
  } catch {
    throw notFound();
  }
  if (text.includes('\0')) throw notFound();
  return text;
}

function holdsNul(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\0');
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, inner]) => key.includes('\0') || holdsNul(inner));
}

const NUL_REFUSAL = 'This text holds a character the desk cannot keep.';

async function pipeline(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const path = url.pathname;
  const matching = routes.filter((candidate) => candidate.pattern.test(path));
  if (!matching.length) throw notFound();
  const chosen = matching.find((candidate) => candidate.method === req.method);
  if (!chosen) {
    const allow = [...new Set(matching.map((candidate) => candidate.method))].join(', ');
    throw new Refusal(405, 'methodNotAllowed', 'This address does not take that method.', undefined, { Allow: allow });
  }

  const bodyLimit = chosen.body === 'multipart' ? UPLOAD_LIMIT : JSON_LIMIT;
  const tooLarge = new Refusal(413, 'tooLarge', chosen.body === 'multipart' ? COPY.overFrameLimit : 'This request is too large.');
  if (Number(req.headers['content-length'] ?? 0) > bodyLimit) {
    req.resume();
    throw tooLarge;
  }
  const rawBody = await readBody(req, bodyLimit);
  if (rawBody === null) throw tooLarge;

  const params: Record<string, string> = {};
  const values = chosen.pattern.exec(path) as RegExpExecArray;
  chosen.keys.forEach((key, index) => { params[key] = pathSegment(values[index + 1] as string); });
  const session = await readSession(req);
  const context: Context = {
    params,
    query: url.searchParams,
    session,
    desk: (session.state === 'live' ? session.desk : null) as Desk,
    rawBody,
    body: {},
    file: null,
    now: Date.now(),
    found: undefined,
  };

  const contentType = req.headers['content-type'] ?? '';
  if (chosen.body === 'multipart' && contentType.startsWith('multipart/form-data')) {
    context.file = firstFile(rawBody, contentType);
    if (context.file && context.file.bytes.length > chosen.fileLimit) {
      throw new Refusal(413, 'tooLarge', chosen.fileRefusal ? await chosen.fileRefusal(context) : COPY.overFrameLimit);
    }
  }
  if (chosen.rate) await chosen.rate(context);
  if (req.method !== 'GET' && !isLocalOrigin(req)) throw new Refusal(403, 'foreignOrigin', 'This request came from another site.');
  if (chosen.auth === 'desk' && session.state !== 'live') {
    throw session.state === 'ended'
      ? new Refusal(401, 'session_ended', COPY.sessionEnded)
      : new Refusal(401, 'notSignedIn', 'Sign in to keep going.');
  }
  if (chosen.load) context.found = await chosen.load(context);
  if (chosen.body === 'multipart' && !contentType.startsWith('multipart/form-data')) {
    throw new Refusal(415, 'unsupportedType', 'Send this as multipart form data.');
  }
  if (chosen.body === 'json') {
    if (!contentType.toLowerCase().startsWith('application/json')) throw new Refusal(415, 'unsupportedType', 'Send this as JSON.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new Refusal(400, 'malformed', 'This request is not valid JSON.');
    }
    context.body = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  }
  if (holdsNul(context.body) || holdsNul(Object.fromEntries(url.searchParams)) || context.file?.fileName.includes('\0')) throw refused(NUL_REFUSAL);
  const answer = await chosen.handle(context);
  send(res, answer, answerHeaders.get(answer) ?? {});
}

const answerHeaders = new WeakMap<Answer, Record<string, string>>();

/** An answer that also sets response headers (the session cookie). */
export function withHeaders(answer: Answer, headers: Record<string, string>): Answer {
  answerHeaders.set(answer, headers);
  return answer;
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  try {
    await pipeline(req, res, url);
  } catch (error) {
    if (error instanceof Refusal) {
      sendRefusal(res, error);
      return;
    }
    // Postgres data exceptions are values it can't hold (a NUL inside a file's text, a number past a column): the input is refused.
    if (String((error as { code?: unknown }).code).startsWith('22')) {
      sendRefusal(res, refused(NUL_REFUSAL));
      return;
    }
    console.error(error);
    sendRefusal(res, new Refusal(500, 'internal', 'Something went wrong on the desk. Try again.'));
  }
}

/** A UUID path segment; anything else can't name a row. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
