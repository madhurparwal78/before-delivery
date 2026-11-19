import type { IncomingMessage } from 'node:http';
import config, { publicOrigin } from './config.js';
import { query } from './db.js';

export type Locale = 'en' | 'ja' | 'es';


export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'ja' || value === 'es';
}

/** The single place locale resolution lives (DP-62). */
export function resolveLocale(accountLocale: Locale | null, cookieLocale: string | undefined, acceptLanguage: string | undefined): Locale {
  if (accountLocale) return accountLocale;
  if (cookieLocale && isLocale(cookieLocale)) return cookieLocale;
  if (acceptLanguage) {
    const entries = acceptLanguage
      .split(',')
      .map((part) => {
        const params = part.trim().split(';');
        const lang = params[0]?.trim() ?? '';
        const qParam = params.slice(1).map((p) => p.trim()).find((p) => p.startsWith('q='));
        const q = qParam ? Number(qParam.slice(2)) : 1;
        return { lang, q: Number.isFinite(q) ? q : 0, order: -1 };
      })
      .filter((e) => e.lang !== '' && e.q > 0)
      .sort((a, b) => b.q - a.q);
    for (const entry of entries) {
      const primary = entry.lang.split('-')[0]?.toLowerCase();
      if (primary === 'en' || primary === 'ja' || primary === 'es') return primary;
    }
  }
  return 'en';
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export function serializeCookie(name: string, value: string, opts: { maxAge?: number; httpOnly?: boolean } = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

export type SessionAccount = {
  id: string;
  email: string;
  display_name: string;
  locale: Locale;
  email_verified: boolean;
  verification_email: 'sent' | 'not_sent';
  storage_notice: 'upload_unavailable' | 'delete_unavailable' | null;
};

export interface Ctx {
  req: IncomingMessage;
  account: SessionAccount | null;
  locale: Locale;
  cookies: Record<string, string>;
}


export async function contextFrom(req: IncomingMessage): Promise<Ctx> {
  const cookies = parseCookies(req);
  const account = cookies.lw_session ? await accountForSessionToken(cookies.lw_session) : null;
  const locale = resolveLocale(account?.locale ?? null, cookies.lw_locale, req.headers['accept-language']);
  return { req, account, locale, cookies };
}

export async function accountForSessionToken(token: string): Promise<SessionAccount | null> {
  const res = await query<SessionAccount>(
    `select a.id, a.email, a.display_name, a.locale, a.email_verified, a.verification_email, a.storage_notice
       from sessions s join accounts a on a.id = s.account_id
      where s.token = $1 and s.expires_at > now()`,
    [token],
  );
  return res.rows[0] ?? null;
}

export function crossOriginForbidden(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  return origin !== publicOrigin;
}





export function sessionCookie(value: string): string {
  return serializeCookie('lw_session', value, { httpOnly: true, maxAge: 60 * 60 * 24 * 30 });
}

export function localeCookie(value: Locale): string {
  return serializeCookie('lw_locale', value, { maxAge: 60 * 60 * 24 * 365 });
}

