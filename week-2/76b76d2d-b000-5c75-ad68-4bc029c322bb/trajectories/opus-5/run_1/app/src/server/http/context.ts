import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Locale } from '../../shared/money.ts';
import type { Role } from '../../shared/domain.ts';
import { one } from '../db/pool.ts';
import { ApiError } from './errors.ts';

export const SESSION_COOKIE = 'halide_session';
export const GUEST_COOKIE = 'halide_guest';
export const LOCALE_COOKIE = 'halide_locale';
const BODY_LIMIT = 16384;

export type SessionAccount = {
  id: number;
  number: string | null;
  name: string;
  email: string;
  locale: Locale;
  role: Role;
  kb_account_id: string | null;
};

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  url: URL;
  path: string;
  cookies: Record<string, string>;
  locale: Locale;
  body: Record<string, unknown>;
  rawBody: string;
  params: Record<string, string>;
  account: SessionAccount | null;
  sessionToken: string | null;
  guestKey: string | null;
  setCookies: string[];
};

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name !== '') out[name] = decodeURIComponent(value);
  }
  return out;
}

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'fr';
}

/** The one locale rule for API requests and prefix-less pages. */
export function resolveLocale(options: {
  header?: string | undefined;
  cookie?: string | undefined;
  account?: Locale | null;
  acceptLanguage?: string | undefined;
}): Locale {
  if (isLocale(options.header)) return options.header;
  if (isLocale(options.cookie)) return options.cookie;
  if (options.account === 'en' || options.account === 'fr') return options.account;
  const first = (options.acceptLanguage ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  if (first.startsWith('en')) return 'en';
  return 'fr';
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) reject(new ApiError('body_too_large'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

export function checkContentType(req: IncomingMessage, raw: string): void {
  if (raw.length === 0) return;
  const header = req.headers['content-type'];
  if (header === undefined) throw new ApiError('unsupported_media_type');
  const media = header.split(';')[0].trim().toLowerCase();
  if (media !== 'application/json') throw new ApiError('unsupported_media_type');
}

export function parseJsonBody(raw: string): Record<string, unknown> {
  if (raw.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError('invalid_json');
  }
  if (parsed === null || typeof parsed !== 'object') throw new ApiError('invalid_json');
  return parsed as Record<string, unknown>;
}

export async function loadSession(token: string | undefined): Promise<SessionAccount | null> {
  if (token === undefined) return null;
  const row = await one<SessionAccount>(
    `select a.id, a.number, a.name, a.email, a.locale, a.role, a.kb_account_id
       from sessions s join accounts a on a.id = s.account_id where s.token = $1`,
    [token],
  );
  return row;
}

