import type { IncomingMessage, ServerResponse } from 'node:http';
import { pool } from '../db/pool.js';
import { acceptedAthleteIds, findUser, isLinkedCoach, type UserRow } from '../db/users.js';
import { notFound, unauthenticated } from './errors.js';

export const SESSION_COOKIE = 'tempoline_session';

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  user: UserRow | null;
  sessionId: string | null;
  today: string;
}

export function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function requireUser(ctx: RequestContext): UserRow {
  if (!ctx.user) throw unauthenticated();
  return ctx.user;
}

export function requireCoach(ctx: RequestContext): UserRow {
  const user = requireUser(ctx);
  if (user.role !== 'coach') throw notFound();
  return user;
}

export function requireAthlete(ctx: RequestContext): UserRow {
  const user = requireUser(ctx);
  if (user.role !== 'athlete') throw notFound();
  return user;
}

/** An athlete sees only themselves; a coach sees athletes with an accepted link. */
export async function visibleAthlete(ctx: RequestContext, athleteId: string): Promise<UserRow> {
  const user = requireUser(ctx);
  if (user.role === 'athlete') {
    if (user.id !== athleteId) throw notFound();
    return user;
  }
  const athlete = await findUser(pool, athleteId);
  if (!athlete || athlete.role !== 'athlete') throw notFound();
  if (!(await isLinkedCoach(pool, user.id, athleteId))) throw notFound();
  return athlete;
}

export async function visibleAthleteIds(user: UserRow): Promise<string[]> {
  if (user.role === 'athlete') return [user.id];
  return acceptedAthleteIds(pool, user.id);
}
