import type { IncomingHttpHeaders } from 'node:http';
import { isLocale, type Locale, type StaffRole } from '../../shared/types.js';
import { LIMITS } from '../config.js';
import { clearedCookie, serializeCookie } from './cookies.js';

export const COOKIE = {
  locale: 'pdl_locale',
  cart: 'pdl_cart',
  session: 'pdl_session',
  staff: 'pdl_staff',
} as const;

export type Customer = { id: string; email: string; locale: Locale };

export type StaffMember = { email: string; name: string; role: StaffRole };

export class RequestContext {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: IncomingHttpHeaders;
  readonly cookies: Map<string, string>;
  readonly locale: Locale;
  readonly body: unknown;
  params: Record<string, string> = {};
  customer: Customer | null = null;
  staff: StaffMember | null = null;
  readonly responseCookies: string[] = [];

  constructor(input: {
    method: string;
    path: string;
    query: URLSearchParams;
    headers: IncomingHttpHeaders;
    cookies: Map<string, string>;
    body: unknown;
  }) {
    this.method = input.method;
    this.path = input.path;
    this.query = input.query;
    this.headers = input.headers;
    this.cookies = input.cookies;
    this.body = input.body;
    this.locale = resolveLocale(input.cookies.get(COOKIE.locale), input.headers['accept-language']);
  }

  get cartId(): string | null {
    return this.cookies.get(COOKIE.cart) ?? null;
  }

  header(name: string): string | undefined {
    const value = this.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  setSessionCookie(name: string, value: string): void {
    this.responseCookies.push(
      serializeCookie(name, value, { httpOnly: true, maxAgeSeconds: LIMITS.sessionSeconds }),
    );
  }

  setCartCookie(value: string): void {
    this.responseCookies.push(
      serializeCookie(COOKIE.cart, value, { httpOnly: true, maxAgeSeconds: 7 * 24 * 60 * 60 }),
    );
  }

  clearCookie(name: string): void {
    this.responseCookies.push(clearedCookie(name));
  }
}

export function resolveLocale(
  cookie: string | undefined,
  acceptLanguage: string | undefined,
): Locale {
  if (cookie && isLocale(cookie)) return cookie;
  if (acceptLanguage && acceptLanguage.trim().toLowerCase().startsWith('fr')) return 'fr-CA';
  return 'en-CA';
}

export type ApiResponse = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

export type Handler = (ctx: RequestContext) => Promise<ApiResponse>;
