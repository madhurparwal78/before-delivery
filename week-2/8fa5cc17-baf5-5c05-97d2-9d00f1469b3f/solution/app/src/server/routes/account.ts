// Sign-in, sign-out, device sessions, the password, settings and the live sync channel.
import { db, one, transaction } from '../db.ts';
import { apiError, FieldErrors, notFound } from '../errors.ts';
import { emit, openChannel, rotateChannels } from '../events.ts';
import { noContent, objectBody, ok, route, type Request, type Route } from '../http.ts';
import { clearFailures, lockedFor, recordFailure, retryAfter, ADDRESS_FAILURES, EMAIL_FAILURES, type Identity } from '../lockout.ts';
import { iso } from '../model.ts';
import { hashPassword, verifyPassword } from '../passwords.ts';
import { dropSessionPresence } from '../presence.ts';
import { cookieHeader, deviceLabel, endSessions, liveSessionsWhere, rotateSession, startSession } from '../sessions.ts';
import { loadSettings } from '../workspace.ts';
import { isTimeZone } from '../../shared/time.ts';
import { config } from '../config.ts';

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 200;
// Compared against when the email is unknown, so both paths cost one slow hash.
const decoyHash = hashPassword('quire-decoy-password');

interface OwnerRow { email: string; display_name: string; password_hash: string }

const owner = async (): Promise<OwnerRow> => {
  const row = await one<OwnerRow>(db, 'SELECT email, display_name, password_hash FROM owner_account LIMIT 1');
  if (!row) throw new Error('owner missing');
  return row;
};

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

async function signIn(req: Request) {
  const body = objectBody(req);
  const errors = new FieldErrors();
  if (typeof body.email !== 'string' || body.email.trim() === '') errors.add('email', 'Enter your email address.');
  if (typeof body.password !== 'string' || body.password === '') errors.add('password', 'Enter your password.');
  errors.throwIfAny();
  const email = normaliseEmail(body.email as string);
  const identities: Identity[] = [
    { kind: 'email', value: email, threshold: EMAIL_FAILURES },
    { kind: 'address', value: req.clientAddress, threshold: ADDRESS_FAILURES },
  ];
  const locked = await transaction((tx) => lockedFor(tx, identities));
  if (locked > 0) throw apiError(429, 'locked', {}, { 'Retry-After': retryAfter(locked) });
  const account = await owner();
  const known = normaliseEmail(account.email) === email;
  const matches = await verifyPassword(body.password as string, known ? account.password_hash : await decoyHash);
  if (!known || !matches) {
    const nowLocked = await transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(18471)');
      return recordFailure(tx, identities);
    });
    if (nowLocked > 0) throw apiError(429, 'locked', {}, { 'Retry-After': retryAfter(nowLocked) });
    throw apiError(401, 'invalid_credentials');
  }
  // Checked again under the same lock as failures: a burst of guesses cannot slip past a fresh lock.
  const signedIn = await transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(18471)');
    const lockedNow = await lockedFor(tx, identities);
    if (lockedNow > 0) return lockedNow;
    await clearFailures(tx, identities[0]);
    return startSession(tx, deviceLabel(req.headers['user-agent']));
  });
  if (typeof signedIn === 'number') throw apiError(429, 'locked', {}, { 'Retry-After': retryAfter(signedIn) });
  const { token, session } = signedIn;
  return {
    status: 200,
    body: { user: { email: account.email, display_name: account.display_name }, csrf_token: session.csrfToken },
    headers: { 'Set-Cookie': cookieHeader(token) },
  };
}

async function signOut(req: Request) {
  await transaction((tx) => endSessions(tx, [req.session.id]));
  return { status: 204, headers: { 'Set-Cookie': `${cookieHeader('')}; Max-Age=0` } };
}

async function sessionInfo(req: Request) {
  const account = await owner();
  const settings = await loadSettings(db);
  return ok({
    user: { email: account.email, display_name: account.display_name }, csrf_token: req.session.csrfToken,
    session_id: req.session.id, home_time_zone: settings.home_time_zone, theme: settings.theme,
  });
}

async function changePassword(req: Request) {
  const body = objectBody(req);
  const errors = new FieldErrors();
  const account = await owner();
  const current = typeof body.current_password === 'string' ? body.current_password : '';
  if (!current || !(await verifyPassword(current, account.password_hash))) errors.add('current_password', "That isn't your current password.");
  const next = typeof body.new_password === 'string' ? body.new_password : '';
  const length = [...next].length;
  if (length < PASSWORD_MIN) errors.add('new_password', 'Use at least 12 characters.');
  else if (length > PASSWORD_MAX) errors.add('new_password', 'Use at most 200 characters.');
  errors.throwIfAny();
  const hash = await hashPassword(next);
  const rotated = await transaction(async (tx) => {
    await tx.query('UPDATE owner_account SET password_hash = $1', [hash]);
    const others = await tx.query<{ id: string }>(`SELECT id FROM device_sessions WHERE ended_at IS NULL AND id <> $1`, [req.session.id]);
    await endSessions(tx, others.map((r) => r.id));
    return rotateSession(tx, req.session.id);
  });
  rotateChannels(req.session.id, rotated.session.id);
  return { status: 200, body: { csrf_token: rotated.session.csrfToken }, headers: { 'Set-Cookie': cookieHeader(rotated.token) } };
}

async function listSessions(req: Request) {
  const rows = await db.query<{ id: string; label: string; created_at: Date; last_seen_at: Date }>(
    `SELECT id, label, created_at, last_seen_at FROM device_sessions WHERE ${liveSessionsWhere('$1')} ORDER BY created_at DESC, id`,
    [config.sessionIdleSeconds]);
  return ok({
    sessions: rows.map((s) => ({
      id: s.id, label: s.label, created_at: iso(s.created_at), last_seen_at: iso(s.last_seen_at), current: s.id === req.session.id,
    })),
  });
}

async function revokeSession(req: Request) {
  const id = req.params.id;
  const live = await db.query(`SELECT 1 FROM device_sessions WHERE id = $1 AND ${liveSessionsWhere('$2')}`, [id, config.sessionIdleSeconds]);
  if (!live.length) throw notFound();
  if (id === req.session.id) throw apiError(409, 'current_session');
  await transaction((tx) => endSessions(tx, [id]));
  return noContent();
}

async function events(req: Request) {
  const lastId = req.headers['last-event-id'];
  const session = req.session;
  // The reply is streamed directly; the router sends nothing more.
  await openChannel(req.res, session.id, Array.isArray(lastId) ? lastId[0] : lastId, () => void dropSessionPresence(session.id));
  return { status: 0 };
}

async function getSettings() {
  return ok({ ...(await loadSettings(db)) });
}

async function putSettings(req: Request) {
  const body = objectBody(req);
  const errors = new FieldErrors();
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(body, k);
  if (!has('home_time_zone') && !has('theme')) errors.add('home_time_zone', 'Choose a time zone from the list.');
  if (has('home_time_zone') && !isTimeZone(body.home_time_zone)) errors.add('home_time_zone', 'Choose a time zone from the list.');
  if (has('theme') && body.theme !== 'paper' && body.theme !== 'lamplight') errors.add('theme', 'Choose Paper or Lamplight.');
  errors.throwIfAny();
  const settings = await transaction(async (tx) => {
    if (has('home_time_zone')) await tx.query('UPDATE workspace_settings SET home_time_zone = $1 WHERE id = 1', [body.home_time_zone]);
    if (has('theme')) await tx.query('UPDATE workspace_settings SET theme = $1 WHERE id = 1', [body.theme]);
    const saved = await loadSettings(tx);
    await emit(tx, 'settings.saved', { ...saved });
    return saved;
  });
  return ok({ ...settings });
}

export const accountRoutes: Route[] = [
  route('POST', '/api/auth/sign-in', 'json', signIn, { open: true }),
  route('POST', '/api/auth/sign-out', 'none', signOut),
  route('GET', '/api/session', 'none', sessionInfo),
  route('POST', '/api/account/password', 'json', changePassword),
  route('GET', '/api/sessions', 'none', listSessions),
  route('DELETE', '/api/sessions/:id', 'none', revokeSession),
  route('GET', '/api/events', 'none', events),
  route('GET', '/api/settings', 'none', getSettings),
  route('PUT', '/api/settings', 'json', putSettings),
];
