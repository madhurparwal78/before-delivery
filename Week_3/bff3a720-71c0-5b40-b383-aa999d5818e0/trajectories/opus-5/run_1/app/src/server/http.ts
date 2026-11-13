import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { MAX_JSON_BYTES, MAX_UPLOAD_BYTES } from './config.js';
import { db } from './db.js';
import { now } from './clock.js';
import { ApiError, errors } from './errors.js';
import { isoZoned } from './domain/time.js';

export interface MemberRow {
  id: string;
  display_name: string;
  email: string;
  roles: string[];
  id_state: string;
  photo_file_id: string | null;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface UploadPart {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: Buffer;
  contentType?: string;
  noContent?: boolean;
  /** The handler already wrote the response, as the event stream does. */
  handled?: boolean;
}

export class Ctx {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly url: URL;
  params: Record<string, string>;
  member: MemberRow | null = null;
  private bodyBuffer: Buffer | null = null;
  private idemState: { key: string; route: string; bodyHash: string; conflict: boolean } | null =
    null;

  constructor(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    params: Record<string, string>,
  ) {
    this.req = req;
    this.res = res;
    this.method = req.method ?? 'GET';
    this.url = url;
    this.params = params;
  }

  header(name: string): string | null {
    const value = this.req.headers[name.toLowerCase()];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }

  query(name: string): string | null {
    return this.url.searchParams.get(name);
  }

  param(name: string): string {
    const value = this.params[name];
    if (value === undefined) throw errors.notFound();
    return value;
  }

  requireMember(): MemberRow {
    if (!this.member) throw errors.unauthenticated();
    return this.member;
  }

  setBody(buffer: Buffer): void {
    this.bodyBuffer = buffer;
  }

  rawBody(): Buffer {
    return this.bodyBuffer ?? Buffer.alloc(0);
  }

  json(): Record<string, JsonValue> {
    const buffer = this.bodyBuffer;
    if (!buffer || buffer.byteLength === 0) return {};
    try {
      const parsed: unknown = JSON.parse(buffer.toString('utf8'));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw errors.validationFailed({ body: 'Send a JSON object.' });
      }
      return parsed as Record<string, JsonValue>;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw errors.validationFailed({ body: 'Send a JSON object.' });
    }
  }

  /**
   * Step 5 of the precedence order: an idempotent replay answers before any later check.
   * Returns the stored reply when the same key and body were already answered.
   */
  async idempotency(route: string): Promise<Reply | null> {
    const key = this.header('idempotency-key');
    if (key === null || key.length < 1 || key.length > 100) return null;
    const member = this.requireMember();
    const bodyHash = createHash('sha256').update(this.rawBody()).digest('hex');
    const { rows } = await db.query<{ body_hash: string; status: number; response: unknown }>(
      'select body_hash, status, response from idempotency_keys where member_id = $1 and route = $2 and key = $3 and created_at > $4',
      [member.id, route, key, new Date(now().getTime() - 86_400_000)],
    );
    const stored = rows[0];
    this.idemState = { key, route, bodyHash, conflict: false };
    if (!stored) return null;
    if (stored.body_hash !== bodyHash) {
      this.idemState.conflict = true;
      return null;
    }
    return {
      status: stored.status,
      body: stored.response,
      headers: { 'Idempotent-Replay': 'true' },
    };
  }

  /** Step 7: the same key with a different body is a state conflict. */
  assertNoIdempotencyConflict(): void {
    if (this.idemState?.conflict) throw errors.idempotencyConflict();
  }

  /** Step 8: the four idempotent routes need a key. */
  requireIdempotencyKey(): void {
    const key = this.header('idempotency-key');
    if (key === null || key.length < 1 || key.length > 100) {
      throw errors.validationFailed({ idempotency_key: 'Send an Idempotency-Key header.' });
    }
  }

  async storeIdempotent(status: number, body: unknown): Promise<void> {
    const state = this.idemState;
    if (!state || state.conflict || status < 200 || status >= 300) return;
    await db.query(
      `insert into idempotency_keys (member_id, route, key, body_hash, status, response, created_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (member_id, route, key) do nothing`,
      [
        this.requireMember().id,
        state.route,
        state.key,
        state.bodyHash,
        status,
        JSON.stringify(body),
        now(),
      ],
    );
  }

  cookie(name: string): string | null {
    const header = this.header('cookie');
    if (!header) return null;
    for (const pair of header.split(';')) {
      const index = pair.indexOf('=');
      if (index < 0) continue;
      if (pair.slice(0, index).trim() === name) return pair.slice(index + 1).trim();
    }
    return null;
  }
}

export type Handler = (ctx: Ctx) => Promise<Reply>;

export interface RouteDef {
  method: string;
  pattern: string;
  /** JSON routes reject other content types; upload routes take multipart/form-data. */
  kind: 'json' | 'upload' | 'plain';
  auth: 'none' | 'member';
  handler: Handler;
}

interface CompiledRoute extends RouteDef {
  segments: string[];
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(route: RouteDef): void {
    this.routes.push({ ...route, segments: route.pattern.split('/').filter(Boolean) });
  }

  match(method: string, pathname: string): { route: CompiledRoute; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    let pathMatched = false;
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i += 1) {
        const expected = route.segments[i] as string;
        const actual = parts[i] as string;
        if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
        else if (expected !== actual) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pathMatched = true;
      if (route.method === method) return { route, params };
    }
    if (pathMatched) return null;
    return null;
  }
}

export function maxBytesFor(kind: RouteDef['kind']): number {
  return kind === 'upload' ? MAX_UPLOAD_BYTES : MAX_JSON_BYTES;
}

export async function readBody(ctx: Ctx, limit: number): Promise<void> {
  const declared = ctx.header('content-length');
  if (declared !== null && Number(declared) > limit) throw errors.payloadTooLarge();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of ctx.req) {
    const part = chunk as Buffer;
    total += part.byteLength;
    if (total > limit) throw errors.payloadTooLarge();
    chunks.push(part);
  }
  ctx.setBody(Buffer.concat(chunks));
}

export function assertContentType(ctx: Ctx, kind: RouteDef['kind']): void {
  if (kind === 'plain') return;
  const header = (ctx.header('content-type') ?? '').toLowerCase();
  if (kind === 'json') {
    if (!header.startsWith('application/json')) throw errors.unsupportedMediaType();
    return;
  }
  if (!header.startsWith('multipart/form-data')) throw errors.unsupportedMediaType();
}

/** Read the one part named `file` out of a multipart body. */
export function readFilePart(ctx: Ctx): UploadPart | null {
  const header = ctx.header('content-type') ?? '';
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(header);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) return null;
  const body = ctx.rawBody();
  const delimiter = Buffer.from(`--${boundary.trim()}`);
  let cursor = body.indexOf(delimiter);
  while (cursor >= 0) {
    const partStart = cursor + delimiter.byteLength;
    if (body.slice(partStart, partStart + 2).toString() === '--') break;
    const headerEnd = body.indexOf('\r\n\r\n', partStart);
    if (headerEnd < 0) break;
    const headerText = body.slice(partStart, headerEnd).toString('utf8');
    const next = body.indexOf(delimiter, headerEnd);
    const contentEnd = next < 0 ? body.byteLength : next - 2;
    const content = body.slice(headerEnd + 4, contentEnd);
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    if (nameMatch?.[1] === 'file') {
      return {
        filename: /filename="([^"]*)"/i.exec(headerText)?.[1] ?? 'upload',
        contentType: /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() ?? '',
        bytes: content,
      };
    }
    cursor = next;
  }
  return null;
}

export function withServerNow<T extends Record<string, unknown>>(body: T): T & { server_now: string } {
  return { ...body, server_now: isoZoned(now()) };
}
