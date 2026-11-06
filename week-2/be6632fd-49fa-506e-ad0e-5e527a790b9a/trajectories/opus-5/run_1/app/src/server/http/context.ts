import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../config.ts';
import { invalidJson, tooLarge, unsupportedMediaType } from './errors.ts';

export interface RequestBody {
  bytes: Buffer;
  /** True when the request body stopped being read because it passed its limit. */
  overLimit: boolean;
}

export class Ctx {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly method: string;
  readonly url: URL;
  readonly nowMs: number;
  params: Record<string, string> = {};
  private readonly body: RequestBody;

  constructor(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    body: RequestBody,
    nowMs: number,
  ) {
    this.request = request;
    this.response = response;
    this.method = (request.method ?? 'GET').toUpperCase();
    this.url = url;
    this.body = body;
    this.nowMs = nowMs;
  }

  header(name: string): string | null {
    const value = this.request.headers[name.toLowerCase()];
    if (value === undefined) return null;
    return Array.isArray(value) ? (value[0] ?? null) : value;
  }

  get path(): string {
    return this.url.pathname;
  }

  query(name: string): string | null {
    return this.url.searchParams.get(name);
  }

  /** The first X-Forwarded-For entry, trimmed, else the socket address. */
  get clientKey(): string {
    const forwarded = this.header('x-forwarded-for');
    if (forwarded !== null) {
      const first = forwarded.split(',')[0]?.trim();
      if (first !== undefined && first !== '') return first;
    }
    return this.request.socket.remoteAddress ?? 'unknown';
  }

  cookie(name: string): string | null {
    const header = this.header('cookie');
    if (header === null) return null;
    for (const part of header.split(';')) {
      const index = part.indexOf('=');
      if (index === -1) continue;
      if (part.slice(0, index).trim() === name) {
        return decodeURIComponent(part.slice(index + 1).trim());
      }
    }
    return null;
  }

  get rawBody(): Buffer {
    return this.body.bytes;
  }

  /** Reads the JSON body, applying the 413, 415 and 400 steps of the error ladder in order. */
  json(): Record<string, unknown> {
    if (this.body.overLimit) throw tooLarge();
    const contentType = this.header('content-type');
    if (this.body.bytes.length === 0 && contentType === null) return {};
    if (contentType === null || !isJsonContentType(contentType)) throw unsupportedMediaType();
    if (this.body.bytes.length === 0) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.body.bytes.toString('utf8')) as unknown;
    } catch {
      throw invalidJson();
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidJson();
    return parsed as Record<string, unknown>;
  }

  /** The app's own origin: the origin of APP_PUBLIC_URL, or its scheme with the request's Host. */
  get allowedOrigins(): string[] {
    const configured = new URL(config.publicUrl);
    const origins = [configured.origin];
    const host = this.header('host');
    if (host !== null && host !== '') origins.push(`${configured.protocol}//${host}`);
    return origins;
  }
}

function isJsonContentType(value: string): boolean {
  const base = value.split(';')[0]?.trim().toLowerCase();
  return base === 'application/json';
}

export function readBody(request: IncomingMessage, limitBytes: number): Promise<RequestBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let overLimit = false;
    request.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > limitBytes) {
        overLimit = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve({ bytes: Buffer.concat(chunks), overLimit }));
    request.on('error', reject);
  });
}
