import type { IncomingMessage, ServerResponse } from 'node:http';

// Every API error uses this one published shape and code list.
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    move?: number | null;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly move?: number | null,
    public readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, err: ApiError): void {
  const body: ErrorBody = { error: { code: err.code, message: err.message } };
  if (err.fields) body.error.fields = err.fields;
  if (err.move !== undefined) body.error.move = err.move;
  const headers: Record<string, string> = {};
  if (err.retryAfter !== undefined) headers['Retry-After'] = String(Math.max(1, Math.ceil(err.retryAfter)));
  sendJson(res, err.status, body, headers);
}

// The session is the cookie seam_session (HttpOnly, SameSite=Lax, Path=/).
export function readSessionCookie(req: IncomingMessage): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (name === 'seam_session') return part.slice(idx + 1).trim();
  }
  return null;
}
