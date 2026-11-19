import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  currentRevision?: number;
  retryAfterSeconds?: number;
}

// One shared error shape for every API error.
export function apiError(status: number, code: string, message: string, extra?: Omit<ApiErrorBody, 'error' | 'message'>): { status: number; body: ApiErrorBody } {
  const body: ApiErrorBody = { error: code, message };
  if (extra?.fields) body.fields = extra.fields;
  if (extra?.currentRevision !== undefined) body.currentRevision = extra.currentRevision;
  if (extra?.retryAfterSeconds !== undefined) body.retryAfterSeconds = extra.retryAfterSeconds;
  return { status, body };
}

export function validationError(fields: Record<string, string>): { status: number; body: ApiErrorBody } {
  return apiError(422, 'validation', 'Check the highlighted fields.', { fields });
}

export function sendError(res: ServerResponse, err: { status: number; body: ApiErrorBody }, extraHeaders: OutgoingHttpHeaders = {}): void {
  const payload = JSON.stringify(err.body);
  const headers: OutgoingHttpHeaders = { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)), ...extraHeaders };
  if (err.body.retryAfterSeconds !== undefined) {
    headers['Retry-After'] = String(err.body.retryAfterSeconds);
  }
  res.writeHead(err.status, headers);
  res.end(payload);
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) });
  res.end(payload);
}
