/* Request context: session resolution, body parsing with the published size
   and content-type limits, cookies, and the shared pre-checks (Origin, auth,
   suspension) in the published error precedence. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from './errors.js';

export type Account = {
  id: number;
  username: string;
  email: string;
  emailVerified: boolean;
  totpEnabled: boolean;
  role: 'user' | 'admin';
  suspended: boolean;
  createdAt: Date;
};

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  url: URL;
  params: Record<string, string>;
  cookies: Record<string, string>;
  sessionToken: string | null;
  account: Account | null;
  body: unknown;
  rawBody: Buffer | null;
  isGrading: boolean;
  setCookie: (value: string) => void;
  status: number;
};

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name !== '') out[name] = decodeURIComponent(value);
  }
  return out;
}

export function cookieHeader(name: string, value: string, opts: { httpOnly?: boolean; maxAge?: number; secure?: boolean } = {}): string {
  let s = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (opts.httpOnly !== false) s += '; HttpOnly';
  if (opts.secure === true) s += '; Secure';
  if (opts.maxAge !== undefined) s += `; Max-Age=${opts.maxAge}`;
  return s;
}

/* A mutating request whose Origin differs from the request's own origin is
   refused (DP-41). Grading calls skip this and other client-facing checks. */
export function checkOrigin(ctx: Ctx, publicUrl: string): void {
  if (ctx.isGrading) return;
  const origin = ctx.req.headers.origin;
  if (origin === undefined) return;
  const mutating = ctx.method === 'POST' || ctx.method === 'PUT' || ctx.method === 'PATCH' || ctx.method === 'DELETE';
  if (!mutating) return;
  let allowed = origin === publicUrl || origin === new URL(ctx.url.toString()).origin;
  if (!allowed) {
    const cfgUrl = new URL(publicUrl);
    const own = new URL(ctx.url.toString());
    if (cfgUrl.protocol === own.protocol && cfgUrl.host === own.host) allowed = true;
  }
  if (!allowed) throw new ApiError('FORBIDDEN', 'Cross-origin request refused');
}
