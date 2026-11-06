import { createHmac, timingSafeEqual } from 'node:crypto';

export function parseCookies(header: string | undefined): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === '') continue;
    out[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export interface CookieOptions {
  readonly maxAgeSeconds?: number;
  readonly path?: string;
  readonly httpOnly?: boolean;
}

export function serialiseCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  parts.push('SameSite=Lax');
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  return parts.join('; ');
}

export function clearCookie(name: string, path = '/'): string {
  return `${name}=; Path=${path}; SameSite=Lax; HttpOnly; Max-Age=0`;
}

export function sign(value: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${mac}`;
}

export function unsign(signed: string, secret: string): string | null {
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const mac = signed.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(value).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return value;
}
