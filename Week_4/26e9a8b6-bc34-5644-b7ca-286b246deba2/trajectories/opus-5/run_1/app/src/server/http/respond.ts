import type { ServerResponse } from 'node:http';

export const SESSION_COOKIE = 'pw_session';

function framingHeaders(isEmbed: boolean): Record<string, string> {
  return isEmbed
    ? { 'Content-Security-Policy': 'frame-ancestors *' }
    : { 'Content-Security-Policy': "frame-ancestors 'self'" };
}

export function send(
  res: ServerResponse,
  isEmbed: boolean,
  status: number,
  contentType: string,
  payload: Buffer | string,
  headers: Record<string, string> = {},
): void {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': String(body.byteLength),
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    ...framingHeaders(isEmbed),
    ...headers,
  });
  if (res.req.method === 'HEAD') res.end();
  else res.end(body);
}

export function sendJson(
  res: ServerResponse,
  isEmbed: boolean,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  send(res, isEmbed, status, 'application/json', JSON.stringify(body), headers);
}

export function sendHtml(
  res: ServerResponse,
  isEmbed: boolean,
  status: number,
  html: string,
  headers: Record<string, string> = {},
): void {
  /* Pages are never cached, so a withdrawn guide stops being gone once published. */
  send(res, isEmbed, status, 'text/html; charset=utf-8', html, {
    'Cache-Control': 'no-store',
    ...headers,
  });
}

export function sendNoContent(
  res: ServerResponse,
  isEmbed: boolean,
  headers: Record<string, string> = {},
): void {
  send(res, isEmbed, 204, 'text/plain; charset=utf-8', '', headers);
}

export function redirect(res: ServerResponse, isEmbed: boolean, location: string): void {
  send(res, isEmbed, 302, 'text/plain; charset=utf-8', '', { Location: location });
}

export function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}
