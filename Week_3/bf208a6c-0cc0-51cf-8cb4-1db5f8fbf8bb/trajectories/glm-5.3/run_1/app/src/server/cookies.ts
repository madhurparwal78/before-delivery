export interface CookieOptions {
  httpOnly?: boolean;
  path?: string;
  sameSite?: 'Lax' | 'Strict' | 'None';
  maxAge?: number | null;
  expires?: Date | null;
}

export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`);
  if (opts.maxAge === null && opts.expires === null) parts.push('Max-Age=0');
  else if (typeof opts.maxAge === 'number') parts.push(`Max-Age=${opts.maxAge}`);
  else if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  return parts.join('; ');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

const SESSION_COOKIE = 'pinsheet_session';
const PASS_COOKIE = 'pinsheet_pass';

export interface PassUnlock {
  boardId: string;
  generation: number;
}

export function encodePassCookie(unlocks: PassUnlock[]): string {
  return unlocks.map((u) => `${u.boardId}:${u.generation}`).join('.');
}

export function decodePassCookie(value: string | undefined): PassUnlock[] {
  if (!value) return [];
  const out: PassUnlock[] = [];
  for (const part of value.split('.')) {
    if (!part) continue;
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const boardId = part.slice(0, idx);
    const gen = Number(part.slice(idx + 1));
    if (!Number.isInteger(gen) || gen < 1) continue;
    out.push({ boardId, generation: gen });
  }
  return out;
}

export { SESSION_COOKIE, PASS_COOKIE };
