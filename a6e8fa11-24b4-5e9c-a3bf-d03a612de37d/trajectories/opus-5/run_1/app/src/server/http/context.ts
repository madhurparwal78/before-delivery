import { IncomingMessage, ServerResponse } from 'node:http';
import { MemberRole } from '../../shared/workbook';
import { ApiError } from './errors';

export interface AuthMember {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  stationId: string;
  stationName: string;
  timeZone: string;
  sessionId: string;
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  searchParams: URLSearchParams;
  params: Record<string, string>;
  rawBody: Buffer;
  member: AuthMember | null;
  origin: string;
}

export const SESSION_COOKIE = 'fb_session';

export function readCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function setSessionCookie(res: ServerResponse, sessionId: string): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(text);
}

export function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff' });
  res.end();
}

export function sendApiError(res: ServerResponse, failure: ApiError): void {
  sendJson(res, failure.status, failure.body());
}

export function requireMember(ctx: RequestContext): AuthMember {
  if (!ctx.member) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  return ctx.member;
}

export function jsonBody(ctx: RequestContext): Record<string, unknown> {
  if (ctx.rawBody.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(ctx.rawBody.toString('utf8'));
  } catch {
    throw new ApiError(422, 'invalid_request', 'Send a JSON object.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(422, 'invalid_request', 'Send a JSON object.');
  }
  return parsed as Record<string, unknown>;
}
