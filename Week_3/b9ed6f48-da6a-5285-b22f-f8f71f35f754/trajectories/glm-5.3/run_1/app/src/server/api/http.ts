import type { IncomingMessage, ServerResponse } from 'node:http';
import { MESSAGES, type ErrorCode } from '../core/copy.ts';

/** The single error shape: {"error":{"code","message","fields"}} */

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    public fields?: Record<string, string>,
    message?: string,
  ) {
    super(message ?? MESSAGES[code]);
  }

  body(): ErrorBody {
    const out: ErrorBody = { error: { code: this.code, message: this.message } };
    if (this.fields && Object.keys(this.fields).length) {
      out.error.fields = this.fields;
    }
    return out;
  }
}

export function validationFailed(fields: Record<string, string>): ApiError {
  return new ApiError(422, 'validation_failed', fields, MESSAGES.validation_failed);
}

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  cookies: Record<string, string>;
  origin: string | null;
  setCookie(cookie: string): void;
  /** raw JSON body already parsed, or null when absent */
  json(): Promise<unknown>;
  /** raw text of the body (for idempotency hashing) */
  rawBody(): Promise<string>;
}

export interface AppContext {
  // filled by main.ts
}

export type Handler = (ctx: RouteContext) => Promise<void>;

export function sendJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(text);
}

export function sendNoContent(res: ServerResponse, headers?: Record<string, string>): void {
  res.writeHead(204, headers);
  res.end();
}

export function sendRedirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

export function notFound(res: ServerResponse): void {
  sendJson(res, 404, new ApiError(404, 'not_found').body());
}

export async function readBodyJson(ctx: RouteContext): Promise<Record<string, unknown>> {
  const raw = await ctx.rawBody();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}
