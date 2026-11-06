import { createHmac, timingSafeEqual } from 'node:crypto';
import { config, LIMITS } from '../config.js';

export function parseCookies(header: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name && !jar.has(name)) jar.set(name, decodeURIComponent(value));
  }
  return jar;
}

export type CookieOptions = { httpOnly: boolean; maxAgeSeconds?: number };

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  return parts.join('; ');
}

export function clearedCookie(name: string): string {
  return `${name}=; Path=/; SameSite=Lax; HttpOnly; Max-Age=0`;
}

function sign(payload: string): string {
  return createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
}

export function sealSession(value: Record<string, string>): string {
  const payload = JSON.stringify({ ...value, exp: Date.now() + LIMITS.sessionSeconds * 1_000 });
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function openSession(token: string | undefined): Record<string, string> | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const expected = Buffer.from(sign(encoded));
  const given = Buffer.from(token.slice(dot + 1));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record['exp'] !== 'number' || record['exp'] < Date.now()) return null;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return null;
  }
}
