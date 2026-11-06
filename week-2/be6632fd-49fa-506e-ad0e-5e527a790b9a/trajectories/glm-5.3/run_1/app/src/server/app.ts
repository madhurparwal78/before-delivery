import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import { readConfig, Storage, Mailer, KillBill, type Config } from './providers.js';
import { createPool, type Db } from './db.js';
import { ApiError, NOT_FOUND_BODY } from '../domain/errors.js';
import { MESSAGES } from '../domain/copy.js';
import type { Session, MemberRow } from './http.js';

export interface AppState {
  cfg: Config;
  db: Db;
  storage: Storage;
  mailer: Mailer;
  killbill: KillBill;
  sessions: Map<string, { memberId: string; expiresAt: number }>;
}

declare module 'fastify' {
  interface FastifyRequest {
    appState: AppState;
    session: Session | null;
  }
}

export function cookieValue(req: FastifyRequest, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function setSessionCookie(reply: FastifyReply, token: string, ttlSeconds: number): void {
  reply.header('set-cookie', `hourline_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}`);
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header('set-cookie', 'hourline_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

export function sessionCookieName(): string {
  return 'hourline_session';
}

export async function loadSession(state: AppState, req: FastifyRequest): Promise<Session | null> {
  const token = cookieValue(req, sessionCookieName());
  if (!token) return null;
  const res = await state.db.query(
    `SELECT s.token, s.expires_at, m.* FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token = $1`,
    [token]
  );
  if (res.rowCount === 0 || !res.rows[0]) return null;
  const row = res.rows[0];
  const expiresAt = new Date(row.expires_at).getTime();
  const now = Date.now();
  if (expiresAt <= now) {
    await state.db.query('DELETE FROM sessions WHERE token = $1', [token]);
    req.sessionEnded = true;
    return null;
  }
  const ws = await state.db.query('SELECT id, name FROM workspaces WHERE id = $1', [row.workspace_id]);
  if (ws.rowCount === 0 || ws.rows.length === 0) return null;
  const member: MemberRow = {
    id: row.id, workspace_id: row.workspace_id, name: row.name, email: row.email,
    role: row.role, stockist_id: row.stockist_id, created_at: new Date(row.created_at)
  };
  return {
    member,
    workspace: { id: ws.rows[0].id, name: ws.rows[0].name },
    sessionId: token
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    sessionEnded?: boolean;
  }
}

// The published content types: JSON everywhere except the two multipart endpoints.
export function isWrongContentType(req: FastifyRequest): boolean {
  const path = req.url.split('?')[0];
  const multipartPaths = [/^\/api\/drops\/[^/]+\/looks$/, /^\/api\/drops\/[^/]+\/line-sheet\/import$/];
  if (multipartPaths.some(p => p.test(path))) {
    return !(req.headers['content-type'] ?? '').toLowerCase().startsWith('multipart/form-data');
  }
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return false;
  const ct = (req.headers['content-type'] ?? '').toLowerCase();
  if (ct === '') return method !== 'POST' || path.startsWith('/api/drops/') && /\/(archive|restore|erase-contact|schedule|withdraw|revoke|regenerate|confirm|publish)$/.test(path);
  return !(ct.startsWith('application/json') || ct.startsWith('multipart/form-data'));
}

export function buildApp(state: AppState): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.NODE_ENV === 'production' ? 'warn' : 'info' }, bodyLimit: 256000 });
  app.addHook('onRequest', async (req, reply) => {
    req.appState = state;
    if (req.url.startsWith('/api/') || req.url.startsWith('/sitemap')) {
      req.session = await loadSession(state, req);
    }
  });
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    const buf = body as Buffer;
    if (buf.length === 0) { done(null, {}); return; }
    try { done(null, JSON.parse(buf.toString('utf8'))); } catch { done(new ApiError('invalid_json'), undefined); }
  });
  app.addContentTypeParser('*', (req, _body, done) => {
    if (isWrongContentType(req)) { done(new ApiError('unsupported_media_type'), undefined); return; }
    done(null, undefined);
  });
  app.addHook('preParsing', async (req, _reply, payload) => {
    if (isWrongContentType(req)) throw new ApiError('unsupported_media_type');
    return payload;
  });
  return app;
}

export { MESSAGES, ApiError };
