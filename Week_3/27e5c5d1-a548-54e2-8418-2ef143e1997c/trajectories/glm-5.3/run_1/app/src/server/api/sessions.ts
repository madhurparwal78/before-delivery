import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fail, failures } from './errors.js';
import type { WorkerRuntime } from '../worker-runtime.js';
import { hashPassword, hashToken, newSessionToken, verifyPassword } from '../ids.js';
import { checkKeys, codePointLength, safeReturnPath } from '../rules.js';
import type { SessionRow } from '../store.js';
import type { FastifyPluginAsync } from 'fastify';

export const JSON_LIMIT = 65_536;
export const UPLOAD_LIMIT = 10_000_000;

/** Parse and size-limit a JSON body before authentication; malformed JSON answers 422 on body. */
export function parseJsonBody(request: FastifyRequest): Record<string, unknown> {
  const contentType = request.headers['content-type'] ?? '';
  if (contentType && !contentType.toLowerCase().startsWith('application/json')) {
    fail(failures.unsupportedMediaType());
  }
  const raw = (request.body as { raw?: Buffer } | undefined)?.raw ?? request.body;
  if (typeof raw !== 'string' && !(raw instanceof Buffer)) {
    fail(failures.validation({ body: 'Malformed JSON.' }));
  }
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(failures.validation({ body: 'Malformed JSON.' }));
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail(failures.validation({ body: 'Malformed JSON.' }));
  }
  return parsed as Record<string, unknown>;
}

export interface SessionRequest {
  session: SessionRow | null;
  tokenHash: string | null;
}

export function readCookie(request: FastifyRequest): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'kinfold_session') return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function applyFailure(reply: FastifyReply, failure: { status: number; body: unknown; allow?: string }): void {
  reply.status(failure.status);
  if (failure.allow) reply.header('Allow', failure.allow);
  reply.send(failure.body);
}

export function sessionCookie(token: string): string {
  return `kinfold_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return 'kinfold_session=; Path=/; HttpOnly; SameSite=Lax';
}

/** The published method sets per path; anything else answers 405 with Allow. */
function allowedMethodsFor(path: string): string[] | null {
  if (path === '/api/session') return ['POST', 'DELETE'];
  if (path === '/api/me' || path === '/api/health' || path === '/api/service-status') return ['GET'];
  if (path === '/api/account/password') return ['POST'];
  const workspaceMember = /^\/api\/workspaces\/[^/]+\/members\/[^/]+$/.exec(path);
  if (workspaceMember) return ['GET', 'PATCH', 'DELETE'];
  const workspaceMembers = /^\/api\/workspaces\/[^/]+\/members$/.exec(path);
  if (workspaceMembers) return ['GET', 'POST'];
  const workspaceBoards = /^\/api\/workspaces\/[^/]+\/boards$/.exec(path);
  if (workspaceBoards) return ['GET', 'POST'];
  const workspaceSearch = /^\/api\/workspaces\/[^/]+\/search$/.exec(path);
  if (workspaceSearch) return ['GET'];
  const permissionLog = /^\/api\/workspaces\/[^/]+\/permission-log(\/[^/]+)?$/.exec(path);
  if (permissionLog) return ['GET'];
  const workspaceRoot = /^\/api\/workspaces\/[^/]+$/.exec(path);
  if (workspaceRoot) return ['GET', 'PATCH'];
  if (/^\/api\/boards\/[^/]+\/events$/.test(path)) return ['GET'];
  const boardMembers = /^\/api\/boards\/[^/]+\/members(\/[^/]+)?$/.exec(path);
  if (boardMembers) return ['GET', 'POST', 'PATCH', 'DELETE'];
  const boardCandidates = /^\/api\/boards\/[^/]+\/candidates$/.exec(path);
  if (boardCandidates) return ['GET'];
  const boardArchived = /^\/api\/boards\/[^/]+\/archived$/.exec(path);
  if (boardArchived) return ['GET'];
  const boardLists = /^\/api\/boards\/[^/]+\/lists$/.exec(path);
  if (boardLists) return ['POST'];
  const boardRoot = /^\/api\/boards\/[^/]+$/.exec(path);
  if (boardRoot) return ['GET', 'PATCH'];
  if (/^\/api\/lists\/[^/]+$/.test(path)) return ['PATCH'];
  if (/^\/api\/lists\/[^/]+\/cards$/.test(path)) return ['POST'];
  const cardMove = /^\/api\/cards\/[^/]+\/move$/.exec(path);
  if (cardMove) return ['POST'];
  const cardStatus = /^\/api\/cards\/[^/]+\/status$/.exec(path);
  if (cardStatus) return ['POST'];
  const cardChecklist = /^\/api\/cards\/[^/]+\/checklist$/.exec(path);
  if (cardChecklist) return ['POST'];
  const cardPrivate = /^\/api\/cards\/[^/]+\/private-members$/.exec(path);
  if (cardPrivate) return ['PUT'];
  const cardAttachments = /^\/api\/cards\/[^/]+\/attachments$/.exec(path);
  if (cardAttachments) return ['POST'];
  const cardRoot = /^\/api\/cards\/[^/]+$/.exec(path);
  if (cardRoot) return ['GET', 'PATCH', 'DELETE'];
  if (/^\/api\/checklist-items\/[^/]+$/.test(path)) return ['PATCH', 'DELETE'];
  if (/^\/api\/attachments\/[^/]+$/.test(path)) return ['GET', 'DELETE'];
  return null;
}

/** The boundary hooks: same-origin writes, size limits, no-store caching, worker header. */
export function registerBoundary(app: FastifyInstance, runtime: WorkerRuntime): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Kinfold-Worker', String(runtime.workerId));
    reply.header('Cache-Control', 'no-store');
    const method = request.method;
    if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
      const origin = request.headers.origin;
      if (origin) {
        const host = request.headers.host ?? '';
        try {
          const originUrl = new URL(origin);
          if (originUrl.host !== host) fail(failures.crossOrigin());
        } catch {
          fail(failures.crossOrigin());
        }
      }
    }
    // Methods the published paths do not support answer 405 with the Allow header.
    const path = (request.url.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
    const allowed = allowedMethodsFor(path);
    if (allowed && !allowed.includes(method)) {
      reply.header('Allow', allowed.join(', '));
      fail(failures.methodNotAllowed(allowed.join(', ')));
    }
  });

  app.addHook('preHandler', async (request) => {
    const url = request.url.split('?')[0] ?? request.url;
    if (url.startsWith('/api/')) {
      const lengthHeader = request.headers['content-length'];
      const length = lengthHeader ? Number.parseInt(lengthHeader, 10) : 0;
      if (url.startsWith('/api/cards/') && url.endsWith('/attachments')) {
        if (Number.isFinite(length) && length > UPLOAD_LIMIT) fail(failures.tooLarge());
      } else if (Number.isFinite(length) && length > JSON_LIMIT) {
        fail(failures.tooLarge());
      }
    }
  });
}

/** The session lookup on every request: never cached. */
export async function loadSession(request: FastifyRequest, runtime: WorkerRuntime): Promise<SessionRequest> {
  const token = readCookie(request);
  if (!token) return { session: null, tokenHash: null };
  const tokenHash = hashToken(token);
  const session = await runtime.store.sessionByToken(tokenHash);
  return { session, tokenHash };
}

export interface Authed {
  session: SessionRow;
  tokenHash: string;
}

export function requireAuth(sr: SessionRequest): Authed {
  if (!sr.session || !sr.tokenHash) fail(failures.signedOut());
  return { session: sr.session, tokenHash: sr.tokenHash };
}

export const sessionRoutes: FastifyPluginAsync<{ runtime: WorkerRuntime }> = async (app, opts) => {
  const { runtime } = opts;

  app.post('/api/session', async (request, reply) => {
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: ['email', 'password'], optional: ['next'] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) {
        const fields: Record<string, string> = {};
        for (const key of keys.unknownKeys) fields[key] = 'Not a valid field.';
        fail(failures.validation(fields));
      }
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) {
      fail(failures.validation({ ...(email ? {} : { email: 'Enter your email.' }), ...(password ? {} : { password: 'Enter your password.' }) }));
    }
    const user = await runtime.store.userByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      fail(failures.invalidCredentials());
    }
    const token = newSessionToken();
    const tokenHash = hashToken(token);
    await runtime.store.insertSession(tokenHash, user.userId);
    const person = await runtime.store.userById(user.userId);
    reply.status(200);
    reply.header('Set-Cookie', sessionCookie(token));
    const nextValue = typeof body.next === 'string' ? body.next : undefined;
    reply.send({
      user: {
        userId: user.userId,
        displayName: person?.displayName ?? '',
        initials: person?.initials ?? '',
        colour: person?.colour ?? 'sage',
      },
      redirectTo: safeReturnPath(nextValue),
    });
  });

  app.delete('/api/session', async (request, reply) => {
    const sr = await loadSession(request, runtime);
    if (!sr.session || !sr.tokenHash) {
      reply.status(204);
      reply.header('Set-Cookie', clearSessionCookie());
      reply.send();
      return;
    }
    await runtime.store.deleteSession(sr.tokenHash);
    reply.status(204);
    reply.header('Set-Cookie', clearSessionCookie());
    reply.send();
  });

  app.get('/api/me', async (request, reply) => {
    const sr = await loadSession(request, runtime);
    const authed = requireAuth(sr);
    const workspaces = await runtime.store.listWorkspacesForUser(authed.session.userId);
    const person = await runtime.store.userById(authed.session.userId);
    reply.send({
      userId: authed.session.userId,
      displayName: authed.session.displayName,
      initials: authed.session.initials,
      colour: authed.session.colour,
      email: person?.email ?? '',
      workspaces: workspaces.map((w) => ({ id: w.workspaceId, name: w.name, parentName: w.parentName, timeZone: w.timeZone, role: w.role })),
    });
  });

  app.post('/api/account/password', async (request, reply) => {
    const sr = await loadSession(request, runtime);
    const authed = requireAuth(sr);
    const body = parseJsonBody(request);
    const keys = checkKeys(body, { required: ['currentPassword', 'newPassword'], optional: [] });
    if (!keys.ok) {
      if ('unknownKeys' in keys && keys.unknownKeys) {
        const fields: Record<string, string> = {};
        for (const key of keys.unknownKeys) fields[key] = 'Not a valid field.';
        fail(failures.validation(fields));
      }
      fail(failures.validation({ body: 'Malformed JSON.' }));
    }
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    const person = await runtime.store.userById(authed.session.userId);
    if (!person) fail(failures.notFound());
    const stored = await runtime.store.userByEmail(person.email);
    if (!stored || !(await verifyPassword(currentPassword, stored.passwordHash))) {
      fail(failures.validation({ currentPassword: 'That is not your current password.' }));
    }
    const length = codePointLength(newPassword);
    if (length < 12 || length > 200) {
      fail(failures.validation({ newPassword: 'Use 12 to 200 characters.' }));
    }
    const passwordHash = await hashPassword(newPassword);
    await runtime.store.pool.query(`UPDATE kinfold_users SET password_hash = $1 WHERE user_id = $2`, [
      passwordHash,
      authed.session.userId,
    ]);
    const ended = await runtime.store.deleteOtherSessions(authed.session.userId, authed.tokenHash);
    // End every other session of this account at once, on both workers.
    await runtime.relay.publishUser(authed.session.userId, {
      kind: 'session',
      userId: authed.session.userId,
      workspaceId: '',
      boardIds: [],
      keepTokenHash: authed.tokenHash,
    });
    reply.send({ signedOutSessions: ended });
  });

  app.get('/api/service-status', async (_request, reply) => {
    await runtime.storage.ensureChecked();
    reply.send({ live: runtime.relay.isUp() ? 'up' : 'paused', storage: runtime.storage.isUp() ? 'up' : 'down' });
  });

  app.get('/api/health', async (_request, reply) => {
    reply.send({ status: 'ok' });
  });
};
