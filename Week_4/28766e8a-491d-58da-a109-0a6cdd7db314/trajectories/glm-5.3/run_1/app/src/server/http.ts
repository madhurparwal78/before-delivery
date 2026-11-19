import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from '../shared/errors.js';

export type Json = Record<string, unknown>;

export class Request {
  readonly url: URL;
  readonly body?: unknown;
  readonly rawBody: Buffer;
  constructor(
    readonly req: IncomingMessage,
    readonly method: string,
    readonly pathname: string,
    readonly query: URLSearchParams,
    url: URL,
    body: unknown,
    rawBody: Buffer,
    readonly sessionUserId: string | null,
  ) {
    this.url = url;
    this.body = body;
    this.rawBody = rawBody;
  }
  get origin(): string | undefined {
    return this.req.headers['origin'];
  }
  header(name: string): string | undefined {
    const value = this.req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }
  cookie(name: string): string | null {
    const raw = this.header('cookie');
    if (!raw) return null;
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
    }
    return null;
  }
}

export class Response {
  private headers: Record<string, string> = {};
  private statusCode = 200;
  private sent = false;
  constructor(private res: ServerResponse) {}
  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }
  getHeaders(): Record<string, string> {
    return this.headers;
  }
  json(value: unknown): void {
    if (this.sent) return;
    this.sent = true;
    const body = JSON.stringify(value);
    this.res.writeHead(this.statusCode, {
      ...this.headers,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });
    this.res.end(body);
  }
  text(body: string, contentType: string): void {
    if (this.sent) return;
    this.sent = true;
    this.res.writeHead(this.statusCode, {
      ...this.headers,
      'content-type': contentType,
      'content-length': Buffer.byteLength(body),
    });
    this.res.end(body);
  }
  data(body: Buffer, contentType: string): void {
    if (this.sent) return;
    this.sent = true;
    this.res.writeHead(this.statusCode, {
      ...this.headers,
      'content-type': contentType,
      'content-length': body.length,
    });
    this.res.end(body);
  }
  empty(): void {
    if (this.sent) return;
    this.sent = true;
    this.res.writeHead(this.statusCode, this.headers);
    this.res.end();
  }
  redirect(location: string): void {
    if (this.sent) return;
    this.sent = true;
    this.res.writeHead(this.statusCode, { ...this.headers, location: location });
    this.res.end();
  }
  get written(): boolean {
    return this.sent;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
