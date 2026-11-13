import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config';
import { ApiError, ValidationError } from './errors';

export class Reply {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly headers: Record<string, string> = {},
  ) {}
}

export class RawReply {
  constructor(
    readonly status: number,
    readonly body: Buffer,
    readonly headers: Record<string, string>,
  ) {}
}

/** Returned by handlers that have written the response themselves, such as event streams. */
export const STREAMING = Symbol('streaming');

export type HandlerResult = Reply | RawReply | typeof STREAMING;

export interface UploadPart {
  filename: string;
  content: Buffer;
}

export class RequestContext {
  readonly params: Record<string, string>;
  readonly url: URL;
  private cached: Buffer | null = null;

  constructor(
    readonly request: IncomingMessage,
    readonly response: ServerResponse,
    url: URL,
    params: Record<string, string>,
  ) {
    this.url = url;
    this.params = params;
  }

  header(name: string): string | undefined {
    const value = this.request.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  cookie(name: string): string | undefined {
    const header = this.header('cookie');
    if (header === undefined) return undefined;
    for (const part of header.split(';')) {
      const [key, ...rest] = part.trim().split('=');
      if (key === name) return decodeURIComponent(rest.join('='));
    }
    return undefined;
  }

  query(name: string): string | null {
    return this.url.searchParams.get(name);
  }

  /** Reads the body, draining an over-sized one so the refusal still reaches the client. */
  async raw(limit: number): Promise<Buffer> {
    if (this.cached !== null) return this.cached;
    const chunks: Buffer[] = [];
    let total = 0;
    let over = false;
    for await (const chunk of this.request) {
      const buffer = chunk as Buffer;
      total += buffer.byteLength;
      if (total > limit) {
        over = true;
        if (total > limit * 4) {
          this.request.destroy();
          break;
        }
        continue;
      }
      chunks.push(buffer);
    }
    if (over) throw new ApiError('body_too_large');
    this.cached = Buffer.concat(chunks);
    return this.cached;
  }

  async json(): Promise<Record<string, unknown>> {
    const contentType = this.header('content-type') ?? '';
    const raw = await this.raw(config.jsonMaxBytes);
    if (raw.byteLength === 0) return {};
    if (!contentType.includes('application/json')) throw new ApiError('bad_request');
    try {
      const parsed: unknown = JSON.parse(raw.toString('utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new ApiError('bad_request');
      return parsed as Record<string, unknown>;
    } catch (error) {
      throw error instanceof ApiError ? error : new ApiError('bad_request');
    }
  }

  /** Reads the `file` part of a multipart upload. */
  async upload(limit: number): Promise<UploadPart | null> {
    const contentType = this.header('content-type') ?? '';
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    if (!contentType.includes('multipart/form-data') || match === null) throw new ApiError('bad_request');
    const boundary = `--${match[1] ?? match[2] ?? ''}`;
    const raw = await this.raw(limit + 65_536).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'body_too_large') {
        throw new ApiError('file_too_large', { limit_bytes: limit });
      }
      throw error;
    });
    const separator = Buffer.from(`\r\n${boundary}`, 'latin1');
    const body = Buffer.concat([Buffer.from('\r\n', 'latin1'), raw]);
    let cursor = body.indexOf(separator);
    while (cursor !== -1) {
      const headerStart = cursor + separator.byteLength;
      if (body.subarray(headerStart, headerStart + 2).toString('latin1') === '--') break;
      const headerEnd = body.indexOf(Buffer.from('\r\n\r\n', 'latin1'), headerStart);
      if (headerEnd === -1) break;
      const headers = body.subarray(headerStart, headerEnd).toString('utf8');
      const next = body.indexOf(separator, headerEnd);
      if (next === -1) break;
      const content = body.subarray(headerEnd + 4, next);
      const nameMatch = /name="([^"]*)"/.exec(headers);
      const filenameMatch = /filename="([^"]*)"/.exec(headers);
      if (nameMatch?.[1] === 'file' && filenameMatch !== null) {
        return { filename: filenameMatch[1] ?? 'upload.dxf', content };
      }
      cursor = next;
    }
    return null;
  }
}

export type Handler = (context: RequestContext) => Promise<HandlerResult>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, segments: pattern.split('/').filter((part) => part.length > 0), handler });
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter((part) => part.length > 0);
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const segment = route.segments[i]!;
        const value = parts[i]!;
        if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
        else if (segment !== value) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Reply {
  return new Reply(status, body, headers);
}

export function noContent(headers: Record<string, string> = {}): Reply {
  return new Reply(204, null, headers);
}

export function attachment(
  body: Buffer,
  contentType: string,
  filename: string,
): RawReply {
  return new RawReply(200, body, {
    'content-type': contentType,
    'content-disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
  });
}

export function errorReply(error: unknown): Reply {
  if (error instanceof ApiError) return json(error.status, error.body());
  if (error instanceof ValidationError) return json(error.status, error.body());
  process.stderr.write(`unhandled request error: ${String(error)}\n`);
  return json(500, { error: 'bad_request' });
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Same-origin only: a state-changing request must come from the app's own origin. */
export function sameOrigin(context: RequestContext): boolean {
  if (!STATE_CHANGING.has(context.request.method ?? 'GET')) return true;
  const origin = context.header('origin');
  if (origin === undefined) return true;
  const host = context.header('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
