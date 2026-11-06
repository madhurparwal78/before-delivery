// Device sessions: live, then rotated or ended. The cookie value is stored only as a hash.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { config } from './config.ts';
import { db, transaction, type Tx } from './db.ts';
import { apiError } from './errors.ts';
import { emit, endSessionChannels } from './events.ts';
import { header, type Request } from './http.ts';
import { dropSessionPresence } from './presence.ts';

const SWEEP_MS = 2000;
export const COOKIE = 'quire_session';

export interface Session { id: string; csrfToken: string; label: string }

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
const randomToken = (): string => randomBytes(32).toString('base64url');

/** `<Browser> on <OS>` from a user agent, or `Unknown browser`. */
export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\/|Chromium\//.test(ua) ? 'Chrome'
    : /Version\/[\d.]+.*Safari\//.test(ua) ? 'Safari'
    : null;
  const os = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  return browser && os ? `${browser} on ${os}` : 'Unknown browser';
}

export function cookieHeader(token: string): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

function cookieToken(req: Pick<Request, 'headers'>): string | null {
  for (const part of (header(req, 'cookie') ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return null;
}

/** Creates a new device session; returns the cookie token. */
export async function startSession(tx: Tx, label: string): Promise<{ token: string; session: Session }> {
  const token = randomToken();
  const session: Session = { id: randomUUID(), csrfToken: randomToken(), label };
  await tx.query(
    'INSERT INTO device_sessions (id, token_hash, csrf_token, label, created_at, last_seen_at) VALUES ($1, $2, $3, $4, now(), now())',
    [session.id, tokenHash(token), session.csrfToken, label]);
  await emit(tx, 'sessions.changed', {});
  return { token, session };
}

/** Gives a session a new id, cookie and CSRF token (password change); the old cookie stops working. */
export async function rotateSession(tx: Tx, oldId: string): Promise<{ token: string; session: Session }> {
  const token = randomToken();
  const id = randomUUID();
  const csrfToken = randomToken();
  const [row] = await tx.query<{ label: string }>(
    'UPDATE device_sessions SET id = $1, token_hash = $2, csrf_token = $3, last_seen_at = now() WHERE id = $4 RETURNING label',
    [id, tokenHash(token), csrfToken, oldId]);
  await tx.query('UPDATE presence SET session_id = $1 WHERE session_id = $2', [id, oldId]);
  await emit(tx, 'sessions.changed', {});
  return { token, session: { id, csrfToken, label: row.label } };
}

/** SQL condition for a live session; `param` holds the idle period in seconds. */
export const liveSessionsWhere = (param: string): string =>
  `ended_at IS NULL AND last_seen_at > now() - make_interval(secs => ${param})`;

/** Ends sessions in the transaction; their channels get `session.ended` after commit. */
export async function endSessions(tx: Tx, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await tx.query('UPDATE device_sessions SET ended_at = now() WHERE id = ANY($1::uuid[]) AND ended_at IS NULL', [ids]);
  await emit(tx, 'sessions.changed', {});
  tx.afterCommit(async () => {
    for (const id of ids) {
      endSessionChannels(id);
      await dropSessionPresence(id);
    }
  });
}

/** The live session behind the request cookie, refreshing its last-seen time; 401 otherwise. */
export async function authenticate(req: Request): Promise<Session> {
  const token = cookieToken(req);
  if (token) {
    const [row] = await db.query<{ id: string; csrf_token: string; label: string }>(
      `UPDATE device_sessions SET last_seen_at = now()
        WHERE token_hash = $1 AND ${liveSessionsWhere('$2')}
        RETURNING id, csrf_token, label`, [tokenHash(token), config.sessionIdleSeconds]);
    if (row) return { id: row.id, csrfToken: row.csrf_token, label: row.label };
  }
  throw apiError(401, 'unauthenticated');
}

/** The theme for a page shell when the cookie names a live session, else null (pages never show workspace content signed out). */
export async function optionalSession(cookie: string | undefined): Promise<{ theme: string } | null> {
  const token = cookieToken({ headers: { cookie } });
  if (!token) return null;
  const [row] = await db.query<{ theme: string }>(
    `UPDATE device_sessions SET last_seen_at = now() WHERE token_hash = $1 AND ${liveSessionsWhere('$2')}
     RETURNING (SELECT theme FROM workspace_settings WHERE id = 1) AS theme`, [tokenHash(token), config.sessionIdleSeconds]);
  return row ? { theme: row.theme } : null;
}

export function requireCsrf(req: Request, session: Session): void {
  if (header(req, 'x-csrf-token') !== session.csrfToken) throw apiError(403, 'csrf_failed');
}

/** Ends sessions that made no request for the idle period, so their channels and lists learn at once. */
export function startIdleSweep(): void {
  setInterval(() => {
    transaction(async (tx) => {
      const idle = await tx.query<{ id: string }>(
        `SELECT id FROM device_sessions WHERE ended_at IS NULL AND last_seen_at <= now() - make_interval(secs => $1) FOR UPDATE SKIP LOCKED`,
        [config.sessionIdleSeconds]);
      await endSessions(tx, idle.map((r) => r.id));
    }).catch(() => undefined);
  }, SWEEP_MS).unref();
}
