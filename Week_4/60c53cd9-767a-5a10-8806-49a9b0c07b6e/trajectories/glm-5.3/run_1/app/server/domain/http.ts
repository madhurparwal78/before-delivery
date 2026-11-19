// HTTP plumbing: the request/response wrappers, JSON parsing that judges integer
// fields on the raw token, the single error shape, and the precedence order in
// one place (API: Error precedence).
import { apiErrorBody, MSG, type ApiError, type FieldErrors } from './errors.js';

export interface Sender {
  status: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
}

export function jsonReply(status: number, value: unknown, headers: Record<string, string> = {}): Sender {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body: Buffer.from(JSON.stringify(value), 'utf8'),
  };
}

export function emptyReply(status: number, headers: Record<string, string> = {}): Sender {
  return { status, headers, body: Buffer.alloc(0) };
}

export function errorReply(err: ApiError, headers: Record<string, string> = {}): Sender {
  const finalHeaders: Record<string, string | string[]> = { ...headers, 'content-type': 'application/json; charset=utf-8' };
  const body = JSON.stringify(apiErrorBody(err));
  return { status: err.status, headers: finalHeaders, body: Buffer.from(body, 'utf8') };
}

export function textReply(status: number, text: string, headers: Record<string, string> = {}): Sender {
  return {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...headers },
    body: Buffer.from(text, 'utf8'),
  };
}

// Integer literal check (Business rules: Prices on the wire). Judged on the raw
// JSON text so quoted numbers, exponents and fractions all fail.
const INTEGER_LITERAL = /^(0|[1-9][0-9]*)$/;

export function rawIntLiteral(text: string): boolean {
  return INTEGER_LITERAL.test(text);
}

// Finds the raw JSON token for a top-level field of an object body, so integer
// fields can be judged before parsing, per Business rules.
export function rawFieldText(raw: string, field: string): string | null {
  const pattern = new RegExp(`"${field}"\\s*:\\s*`);
  const match = pattern.exec(raw);
  if (!match) return null;
  let position = match.index + match[0].length;
  while (position < raw.length && /\s/.test(raw[position])) position++;
  const end = /[,}\n]/.exec(raw.slice(position));
  return end ? raw.slice(position, position + end.index) : raw.slice(position);
}

export function parseJson(raw: Buffer): { ok: true; json: unknown } | { ok: false } {
  if (raw.length === 0) return { ok: false };
  try {
    return { ok: true, json: JSON.parse(raw.toString('utf8')) };
  } catch {
    return { ok: false };
  }
}

export { MSG };
