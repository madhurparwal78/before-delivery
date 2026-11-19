import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError } from '../errors.js';
import { config } from '../config.js';
import { isImageContentType, MAX_IMAGE_BYTES, type ImageContentType } from '../domain/images.js';

export const MAX_JSON_BYTES = 65_536;

export type BodyKind = 'json' | 'image' | 'none';

export class RequestContext {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly nowMs: number;
  readonly cookies: Readonly<Record<string, string>>;
  params: Readonly<Record<string, string>> = {};
  private readonly setCookies: string[] = [];

  constructor(
    readonly req: IncomingMessage,
    readonly res: ServerResponse,
  ) {
    this.method = (req.method ?? 'GET').toUpperCase();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    this.path = url.pathname;
    this.query = url.searchParams;
    this.nowMs = Date.now();
    this.cookies = parseCookies(req.headers.cookie);
  }

  /** The client IP is the connection's remote address. Forwarding headers are ignored. */
  get ip(): string {
    return this.req.socket.remoteAddress ?? 'unknown';
  }

  header(name: string): string | undefined {
    const value = this.req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  addCookie(name: string, value: string, maxAgeSeconds: number): void {
    const parts = [
      `${name}=${value}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAgeSeconds}`,
    ];
    this.setCookies.push(parts.join('; '));
  }

  clearCookie(name: string): void {
    this.setCookies.push(`${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  pendingCookies(): readonly string[] {
    return this.setCookies;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const piece of header.split(';')) {
    const index = piece.indexOf('=');
    if (index <= 0) continue;
    const name = piece.slice(0, index).trim();
    const value = piece.slice(index + 1).trim();
    if (name !== '') cookies[name] = value;
  }
  return cookies;
}

const STATE_CHANGING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * The server sends no CORS headers. A state-changing request whose `Origin` header names
 * a different origin is rejected.
 */
export function assertSameOrigin(context: RequestContext): void {
  if (!STATE_CHANGING.has(context.method)) return;
  const origin = context.header('origin');
  if (origin === undefined || origin === 'null') return;
  const host = context.header('host');
  const allowed = new Set<string>([config.publicBaseUrl]);
  if (host !== undefined) {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }
  if (!allowed.has(origin.replace(/\/+$/, ''))) throw new AppError('cross_origin');
}

async function readBody(context: RequestContext, limit: number): Promise<Buffer> {
  const declared = context.header('content-length');
  if (declared !== undefined) {
    const length = Number.parseInt(declared, 10);
    if (Number.isFinite(length) && length > limit) throw new AppError('too_large');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of context.req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) throw new AppError('too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function contentTypeOf(context: RequestContext): string {
  return (context.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/** Reads a JSON body of at most 65,536 bytes. An empty body reads as an empty object. */
export async function readJsonBody(context: RequestContext): Promise<Record<string, unknown>> {
  const raw = await readBody(context, MAX_JSON_BYTES);
  if (raw.length === 0) return {};
  const type = contentTypeOf(context);
  if (type !== 'application/json') throw new AppError('unsupported_media_type');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new AppError('validation', { fields: { body: 'Check this value' } });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AppError('validation', { fields: { body: 'Check this value' } });
  }
  return parsed as Record<string, unknown>;
}

export interface ImageBody {
  readonly bytes: Buffer;
  readonly declaredType: ImageContentType;
}

/** Reads a raw image body of at most 5,000,000 bytes with an accepted declared type. */
export async function readImageBody(context: RequestContext): Promise<ImageBody> {
  const raw = await readBody(context, MAX_IMAGE_BYTES);
  const type = contentTypeOf(context);
  if (!isImageContentType(type)) throw new AppError('unsupported_media_type');
  return { bytes: raw, declaredType: type };
}
