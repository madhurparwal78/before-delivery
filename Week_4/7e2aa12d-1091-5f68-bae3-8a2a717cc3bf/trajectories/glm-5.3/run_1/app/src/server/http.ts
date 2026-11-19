// One HTTP front door: body limit, the published error order, JSON replies.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_COOKIE } from './auth.js';

export const BODY_LIMIT = 65536;

export class HttpError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(String(body['error'] ?? status));
  }
}

export function invalid(message: string): HttpError {
  return new HttpError(422, { error: 'invalid', message });
}

export const notFound = (): HttpError => new HttpError(404, { error: 'not_found' });
export const signInRequired = (): HttpError => new HttpError(401, { error: 'sign_in_required' });
export const tooLarge = (): HttpError => new HttpError(413, { error: 'too_large' });
export const badBody = (): HttpError => new HttpError(422, { error: 'invalid', message: 'The request body is not valid.' });

export interface Reply {
  status: number;
  body?: unknown;
  cookies?: string[];
  location?: string;
}

export function json(status: number, body?: unknown, cookies?: string[]): Reply {
  return { status, body, cookies };
}

export function reply(res: ServerResponse, value: Reply): void {
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
  if (value.cookies && value.cookies.length > 0) headers['set-cookie'] = value.cookies.join(', ');
  if (value.location) headers['location'] = value.location;
  res.writeHead(value.status, headers);
  if (value.body === undefined) res.end();
  else res.end(JSON.stringify(value.body));
}

export async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > BODY_LIMIT) throw tooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw badBody();
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw badBody();
  }
}

export function sessionFrom(req: IncomingMessage): string | undefined {
  const cookie = req.headers.cookie;
  if (!cookie) return undefined;
  const parts = cookie.split(';').map((p) => p.trim());
  const found = parts.find((p) => p.startsWith(`${SESSION_COOKIE}=`));
  if (!found) return undefined;
  const value = found.slice(SESSION_COOKIE.length + 1);
  return value.length > 0 ? value : undefined;
}
