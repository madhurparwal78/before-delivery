import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Quizmaster } from '../../shared/protocol.js';
import { sessionQuizmaster } from '../accounts.js';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from '../config.js';
import { notSignedIn } from '../errors.js';
import { readSessionCookie } from '../http/request.js';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  /** Server receipt time of the request, measured before any work. */
  receivedAt: number;
}

export function param(ctx: Ctx, name: string): string {
  return ctx.params[name] ?? '';
}

export async function requireQuizmaster(ctx: Ctx): Promise<Quizmaster> {
  const token = readSessionCookie(ctx.req);
  if (!token) throw notSignedIn();
  const quizmaster = await sessionQuizmaster(token);
  if (!quizmaster) throw notSignedIn();
  return quizmaster;
}

export function setSessionCookie(res: ServerResponse, token: string): void {
  res.setHeader(
    'set-cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`,
  );
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
