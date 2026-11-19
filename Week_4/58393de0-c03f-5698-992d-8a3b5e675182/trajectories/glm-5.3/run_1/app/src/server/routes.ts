import pg from 'pg';
import { createHash } from 'node:crypto';
import { route, type Ctx, type Handler, type Route } from './router.js';
import type { ServerConfig } from './config.js';
import type { Storage } from './storage.js';
import { now, setClock } from './clock.js';
import * as stream from './stream.js';
import { randomId, randomToken, randomJoinCode, newSalt, hashPassword, verifyPassword } from './ids.js';
import { accountById, endSessionsForAccount, type SessionRow } from './sessions.js';
import { classroomById, classroomStateOf, educatorRole, fullClassroom, type ClassroomRow } from './classrooms.js';
import { validationError, apiError } from './apiError.js';
import { normalizeNickname, isNicknameValid, nicknameKey, localToInstant, roundDownToMinute, addDays, zonedParts } from '../shared/util.js';
import { secondsUntil } from '../shared/classroomState.js';
import { isValidExportFileName } from '../shared/exportName.js';
import { sendVerificationEmail } from './mail.js';
import { createSnapshotStore } from './snapshots.js';

export interface Deps {
  pool: pg.Pool;
  cfg: ServerConfig;
  storage: Storage;
}

type HandlerResult = Awaited<ReturnType<Handler>>;

export function buildRoutes(deps: Deps): Route[] {
  const { pool, cfg, storage } = deps;
  const snapshotStore = createSnapshotStore(storage);
  const t = (fn: (ctx: Ctx) => Promise<HandlerResult>): Handler => fn;

  // ---------------- session helpers ----------------

  function setSessionCookie(ctx: Ctx, token: string): void {
    const headers = ctx.res.getHeader('Set-Cookie');
    const cookie = `qy_session=${token}; HttpOnly; SameSite=Lax; Path=/`;
    if (Array.isArray(headers)) ctx.res.setHeader('Set-Cookie', [...headers, cookie]);
    else if (typeof headers === 'string') ctx.res.setHeader('Set-Cookie', [headers, cookie]);
    else ctx.res.setHeader('Set-Cookie', cookie);
  }

  function clearSessionCookie(ctx: Ctx): void {
    ctx.res.setHeader('Set-Cookie', 'qy_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  }

  async function createSession(ctx: Ctx, kind: 'account' | 'pending_join', accountId: string | null, pendingClassroomId: string | null): Promise<string> {
    const token = randomToken();
    const id = randomId('ses');
    await pool.query('INSERT INTO sessions (id, token, account_id, kind, pending_classroom_id) VALUES ($1, $2, $3, $4, $5)', [id, token, accountId, kind, pendingClassroomId]);
    setSessionCookie(ctx, token);
    return token;
  }

  // Error precedence step 2: 401 signed out, including pending and ended sessions.
  // Ended sessions carry their reason (removed / archived classroom).
  function signedOutError(session: SessionRow | null): { status: number; body: { error: string; message: string } } {
    if (session?.kind === 'ended' && session.endedReason === 'removed') {
      return apiError(401, 'removed', 'removed');
    }
    return apiError(401, 'signed_out', 'Sign in to continue.');
  }

  async function requireAccount(ctx: Ctx): Promise<{ account: import('../shared/types.js').Account } | { error: HandlerResult }> {
    if (!ctx.session || ctx.session.kind === 'ended' || ctx.session.kind === 'pending_join' || !ctx.session.accountId) {
      return { error: signedOutError(ctx.session) };
    }
    const account = await accountById(pool, ctx.session.accountId);
    if (!account) return { error: signedOutError(null) };
    return { account };
  }

  async function requireEducator(ctx: Ctx): Promise<{ account: import('../shared/types.js').Account } | { error: HandlerResult }> {
    const r = await requireAccount(ctx);
    if ('error' in r) return r;
    if (r.account.kind !== 'educator') return { error: apiError(403, 'forbidden', 'Only this classroom\'s instructors can do that.') };
    return r;
  }

  async function requireVerified(ctx: Ctx): Promise<{ account: import('../shared/types.js').Account } | { error: HandlerResult }> {
    const r = await requireAccount(ctx);
    if ('error' in r) return r;
    // Students have no email; the unverified restriction applies to
    // Educators and Personal makers only.
    if (r.account.kind !== 'student' && !r.account.emailVerified) {
      return { error: apiError(403, 'email_unverified', 'unverified') };
    }
    return r;
  }

  const routes: Route[] = [];
  const add = (method: string, path: string, handler: Handler) => routes.push(route(method, path, handler));

  // ---------------- auth ----------------

  add('GET', '/api/config', t(async () => ({
    status: 200,
    body: {
      autosaveMs: cfg.timers.autosaveMs,
      blocksStepMs: cfg.timers.blocksStepMs,
      simTickMs: cfg.timers.simTickMs,
      toastMs: cfg.timers.toastMs,
      glancetFadeMs: cfg.timers.glancetFadeMs,
    },
  })));

  add('GET', '/api/session', t(async (ctx) => {
    if (!ctx.session || ctx.session.kind === 'ended' || ctx.session.kind === 'pending_join' || !ctx.session.accountId) {
      let pendingJoin: { classroomName: string } | null = null;
      if (ctx.session?.kind === 'pending_join' && ctx.session.pendingClassroomId) {
        const row = await classroomById(pool, ctx.session.pendingClassroomId);
        if (row) pendingJoin = { classroomName: row.name };
      }
      return { status: 200, body: { account: null, pendingJoin } };
    }
    const account = await accountById(pool, ctx.session.accountId);
    if (!account) return { status: 200, body: { account: null, pendingJoin: null } };
    let pendingJoin: { classroomName: string } | null = null;
    return { status: 200, body: { account, pendingJoin } };
  }));

  add('POST', '/api/auth/signup', t(async (ctx) => {
    const body = ctx.body as { email?: string; password?: string; displayName?: string; accountType?: string };
    const email = (body?.email ?? '').trim();
    const password = body?.password ?? '';
    const displayName = (body?.displayName ?? '').trim();
    const accountType = body?.accountType === 'educator' ? 'educator' : body?.accountType === 'personal' ? 'personal' : null;
    const fields: Record<string, string> = {};
    if (accountType === null) return validationError({ accountType: 'Check the highlighted fields.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) fields.email = 'Enter a valid email address.';
    if (password.length < 10 || password.length > 200) fields.password = 'Use at least 10 characters.';
    if (displayName.length < 1 || displayName.length > 60) fields.displayName = 'Use 1 to 60 characters.';
    if (Object.keys(fields).length > 0) return validationError(fields);

    const emailKey = email.toLocaleLowerCase('en-US');
    const existing = await pool.query('SELECT id FROM accounts WHERE lower(email) = $1', [emailKey]);
    if (existing.rows[0]) return apiError(409, 'email_taken', 'An account already uses that email.');

    const id = randomId('acc');
    const salt = newSalt();
    await pool.query(
      'INSERT INTO accounts (id, kind, display_name, email, email_verified, password_hash, classroom_id, nickname) VALUES ($1, $2, $3, $4, FALSE, $5, NULL, NULL)',
      [id, accountType, displayName, email, `${salt}:${hashPassword(password, salt)}`],
    );

    const verification = await issueVerification(cfg, email);
    if (verification.sent) {
      await pool.query(
        'INSERT INTO verification_tokens (id, account_id, token, sent_at, expires_at, mail_accepted) VALUES ($1, $2, $3, $4, $5, TRUE)',
        [randomId('vtok'), id, verification.token, verification.sentAt, verification.expiresAt],
      );
    }

    await createSession(ctx, 'account', id, null);
    const account = await accountById(pool, id);
    return { status: 201, body: { account, verificationEmailSent: verification.sent } };
  }));

  async function issueVerification(cfg: ServerConfig, email: string): Promise<{ sent: boolean; token: string; sentAt: Date; expiresAt: Date }> {
    const token = randomToken();
    const sentAt = now();
    const expiresAt = new Date(sentAt.getTime() + cfg.verifyTtlSeconds * 1000);
    const result = await sendVerificationEmail(cfg.smtp, email, token, expiresAt);
    return { sent: result.sent, token, sentAt, expiresAt };
  }

  add('POST', '/api/auth/signin', t(async (ctx) => {
    const body = ctx.body as { email?: string; password?: string };
    const email = (body?.email ?? '').trim().toLocaleLowerCase('en-US');
    const { rows } = await pool.query('SELECT id, password_hash FROM accounts WHERE lower(email) = $1', [email]);
    const row = rows[0];
    if (!row?.password_hash) return apiError(401, 'bad_credentials', 'Email or password is wrong.');
    const [salt, hash] = (row.password_hash as string).split(':');
    if (!salt || !hash || !verifyPassword(body?.password ?? '', salt, hash)) {
      return apiError(401, 'bad_credentials', 'Email or password is wrong.');
    }
    await createSession(ctx, 'account', row.id, null);
    const account = await accountById(pool, row.id);
    return { status: 200, body: { account } };
  }));

  add('POST', '/api/auth/signout', t(async (ctx) => {
    if (ctx.session) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [ctx.session.id]);
    }
    clearSessionCookie(ctx);
    return { status: 204 };
  }));

  add('POST', '/api/auth/verify', t(async (ctx) => {
    const token = (ctx.body as { token?: string })?.token ?? '';
    const { rows } = await pool.query('SELECT id, account_id, sent_at, expires_at, used_at FROM verification_tokens WHERE token = $1', [token]);
    const row = rows[0];
    const expired = !row || row.used_at !== null || now().getTime() >= (row.expires_at as Date).getTime();
    if (expired) return apiError(410, 'link_expired', 'This verification link has expired or was replaced. Send a new one from your account.');
    await pool.query('UPDATE verification_tokens SET used_at = $1 WHERE id = $2', [now(), row.id]);
    await pool.query('UPDATE accounts SET email_verified = TRUE WHERE id = $1', [row.account_id]);
    const account = await accountById(pool, row.account_id);
    return { status: 200, body: { account } };
  }));

  add('POST', '/api/auth/resend-verification', t(async (ctx) => {
    const r = await requireAccount(ctx);
    if ('error' in r) return r.error;
    const account = r.account;
    if (account.emailVerified) return apiError(409, 'already_verified', 'Your email is already verified.');
    const { rows } = await pool.query('SELECT max(sent_at) AS latest FROM verification_tokens WHERE account_id = $1 AND mail_accepted = TRUE', [account.id]);
    const latest = rows[0]?.latest as Date | null;
    if (latest) {
      const elapsed = now().getTime() - latest.getTime();
      if (elapsed < 60000) {
        const retry = Math.ceil((60000 - elapsed) / 1000);
        return apiError(429, 'rate_limited', 'Wait a minute before sending another email.', { retryAfterSeconds: retry });
      }
    }
    const verification = await issueVerification(cfg, account.email ?? '');
    if (!verification.sent) return apiError(503, 'mail_unavailable', 'We couldn\'t send the email. Try again in a minute.');
    await pool.query(
      'INSERT INTO verification_tokens (id, account_id, token, sent_at, expires_at, mail_accepted) VALUES ($1, $2, $3, $4, $5, TRUE)',
      [randomId('vtok'), account.id, verification.token, verification.sentAt, verification.expiresAt],
    );
    await pool.query('UPDATE verification_tokens SET used_at = $2 WHERE account_id = $1 AND used_at IS NULL AND token != $3', [account.id, now(), verification.token]);
    return { status: 202, body: { sentTo: account.email } };
  }));

  // ---------------- joining ----------------

  add('POST', '/api/join/code', t(async (ctx) => {
    const raw = (ctx.body as { code?: string })?.code ?? '';
    const code = normalizeJoinCode(raw);

    // Rate limit: failed code attempts per IP (checked on failures).
    async function countFailedAttempts(): Promise<Date[]> {
      const cutoff = new Date(now().getTime() - 60000);
      const { rows } = await pool.query('SELECT attempted_at FROM join_attempts WHERE ip = $1 AND attempted_at > $2 ORDER BY attempted_at ASC', [ctx.ip, cutoff]);
      return rows.map((r) => r.attempted_at as Date);
    }

    const attempts = await countFailedAttempts();
    if (attempts.length >= cfg.joinRateLimit) {
      const firstAt = attempts[0]!;
      const retryMs = 60000 - (now().getTime() - firstAt.getTime());
      const retry = Math.max(1, Math.ceil(retryMs / 1000));
      return apiError(429, 'too_many_attempts', 'Too many attempts. Try again in 60 seconds.', { retryAfterSeconds: retry });
    }

    const { rows } = await pool.query('SELECT id FROM classrooms WHERE upper(join_code) = $1 AND archived = FALSE', [code]);
    const classroomId = rows[0]?.id as string | undefined;
    if (!classroomId) {
      await pool.query('INSERT INTO join_attempts (ip, attempted_at) VALUES ($1, $2)', [ctx.ip, now()]);
      return apiError(404, 'unknown_code', 'This class code is not open for joining.');
    }
    const row = await classroomById(pool, classroomId);
    if (!row) return apiError(404, 'unknown_code', 'This class code is not open for joining.');
    const state = classroomStateOf(row, now());
    if (state !== 'open') {
      await pool.query('INSERT INTO join_attempts (ip, attempted_at) VALUES ($1, $2)', [ctx.ip, now()]);
      return apiError(409, 'join_closed', 'This class code is not open for joining.');
    }
    const studentCount = await pool.query('SELECT count(*)::int AS n FROM students WHERE classroom_id = $1', [classroomId]);
    if ((studentCount.rows[0]?.n ?? 0) >= 40) {
      await pool.query('INSERT INTO join_attempts (ip, attempted_at) VALUES ($1, $2)', [ctx.ip, now()]);
      return apiError(409, 'classroom_full', 'This classroom is full. Ask your instructor.');
    }

    // Replace any existing pending session for this browser.
    if (ctx.session?.kind === 'pending_join') {
      await pool.query('DELETE FROM sessions WHERE id = $1', [ctx.session.id]);
    }
    await createSession(ctx, 'pending_join', null, classroomId);
    return { status: 200, body: { classroom: { name: row.name } } };
  }));

  function normalizeJoinCode(raw: string): string {
    return raw.toUpperCase().replaceAll(/[\s-]/g, '');
  }

  add('POST', '/api/join/nickname', t(async (ctx) => {
    if (!ctx.session || ctx.session.kind !== 'pending_join' || !ctx.session.pendingClassroomId) {
      return apiError(401, 'signed_out', 'Sign in to continue.');
    }
    const classroomId = ctx.session.pendingClassroomId;
    const raw = (ctx.body as { nickname?: string })?.nickname ?? '';
    const nickname = normalizeNickname(raw);
    if (!isNicknameValid(raw)) {
      return validationError({ nickname: 'Use 2 to 24 letters, numbers, spaces, hyphens or apostrophes.' });
    }
    const row = await classroomById(pool, classroomId);
    if (!row) return apiError(401, 'signed_out', 'Sign in to continue.');
    const state = classroomStateOf(row, now());
    if (state !== 'open') return apiError(409, 'join_closed', 'This class code is not open for joining.');
    const taken = await pool.query('SELECT id FROM students WHERE classroom_id = $1 AND lower(nickname) = $2', [classroomId, nicknameKey(nickname)]);
    if (taken.rows[0]) return apiError(409, 'nickname_taken', 'That nickname is taken in this classroom.');
    const studentCount = await pool.query('SELECT count(*)::int AS n FROM students WHERE classroom_id = $1', [classroomId]);
    if ((studentCount.rows[0]?.n ?? 0) >= 40) return apiError(409, 'classroom_full', 'This classroom is full. Ask your instructor.');

    const accountId = randomId('acc');
    await pool.query(
      'INSERT INTO accounts (id, kind, display_name, email, email_verified, password_hash, classroom_id, nickname) VALUES ($1, $2, $3, NULL, FALSE, NULL, $4, $5)',
      [accountId, 'student', nickname, classroomId, nickname],
    );
    await pool.query('INSERT INTO students (id, classroom_id, nickname) VALUES ($1, $2, $3)', [accountId, classroomId, nickname]);
    await pool.query('DELETE FROM sessions WHERE id = $1', [ctx.session.id]);
    await createSession(ctx, 'account', accountId, null);
    stream.broadcast({ event: 'student-joined', data: { classroomId, student: { id: accountId, nickname } } }, { classroomId });
    const account = await accountById(pool, accountId);
    return { status: 201, body: { account } };
  }));

  add('GET', '/api/class', t(async (ctx) => {
    const r = await requireAccount(ctx);
    if ('error' in r) return r.error;
    if (r.account.kind !== 'student' || !r.account.classroomId) {
      return apiError(404, 'not_found', 'Not found.');
    }
    const row = await classroomById(pool, r.account.classroomId);
    if (!row) return apiError(404, 'not_found', 'Not found.');
    if (row.archived) {
      await endSessionsForAccount(pool, r.account.id, 'archived');
      return apiError(401, 'signed_out', 'Sign in to continue.');
    }
    const state = classroomStateOf(row, now());
    return {
      status: 200,
      body: {
        id: row.id, name: row.name, timeZone: row.timeZone, state,
        handInAt: row.handInAt.toISOString(), serverNow: now().toISOString(),
        secondsToHandIn: state === 'handed_in' ? 0 : secondsUntil(now(), row.handInAt),
      },
    };
  }));

  // ---------------- classrooms ----------------

  function isKnownZone(zone: string): boolean {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }

  interface ParsedTimes {
    ok: true;
    joinOpensAt: Date;
    joinClosesAt: Date;
    handInAt: Date;
  }

  async function resolveClassroomTimes(
    timeZone: string,
    joinOpensLocal: string | undefined,
    joinClosesLocal: string | undefined,
    handInLocal: string | undefined,
    stored?: { joinOpensAt: Date; joinClosesAt: Date; handInAt: Date },
  ): Promise<ParsedTimes | { ok: false; errors: Record<string, string> }> {
    const errors: Record<string, string> = {};
    const parse = (value: string, field: string): Date | null => {
      const normalized = value.includes('T') ? value : value.replace(' ', 'T');
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) {
        errors[field] = 'Use the form YYYY-MM-DD HH:mm.';
        return null;
      }
      const instant = localToInstant(normalized, timeZone);
      if (instant === null) {
        errors[field] = `That time does not exist in ${timeZone}.`;
        return null;
      }
      return instant;
    };

    function laterThanNowCheck(handIn: Date | null): boolean {
      if (handIn === null || handIn.getTime() <= now().getTime()) {
        errors.handInLocal = 'Hand-in time must be later than now.';
        return false;
      }
      return true;
    }
    function atOrAfterJoinCloses(handIn: Date | null, closes: Date): boolean {
      if (handIn === null || handIn.getTime() < closes.getTime()) {
        errors.handInLocal = 'Hand-in time must be at or after Join closes.';
        return false;
      }
      return true;
    }

    if (stored) {
      let joinOpensAt = stored.joinOpensAt;
      let joinClosesAt = stored.joinClosesAt;
      let handInAt = stored.handInAt;
      if (joinOpensLocal !== undefined && joinOpensLocal !== '') {
        const parsed = parse(joinOpensLocal, 'joinOpensLocal');
        if (parsed) joinOpensAt = parsed;
      }
      if (joinClosesLocal !== undefined && joinClosesLocal !== '') {
        const parsed = parse(joinClosesLocal, 'joinClosesLocal');
        if (parsed) joinClosesAt = parsed;
      }
      if (handInLocal !== undefined && handInLocal !== '') {
        const parsed = parse(handInLocal, 'handInLocal');
        if (parsed) handInAt = parsed;
      }
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      if (joinOpensAt.getTime() >= joinClosesAt.getTime()) {
        return { ok: false, errors: { joinClosesLocal: 'Join closes must be after Join opens.' } };
      }
      if (handInLocal !== undefined && handInLocal !== '') {
        if (!laterThanNowCheck(handInAt)) return { ok: false, errors };
        if (!atOrAfterJoinCloses(handInAt, joinClosesAt)) return { ok: false, errors };
      }
      return { ok: true, joinOpensAt, joinClosesAt, handInAt };
    }

    const t0 = now();
    const joinOpensAt = joinOpensLocal === undefined || joinOpensLocal === ''
      ? roundDownToMinute(t0)
      : parse(joinOpensLocal, 'joinOpensLocal');
    if (joinOpensAt === null || Object.keys(errors).length > 0) return { ok: false, errors };
    const joinClosesAt = joinClosesLocal === undefined || joinClosesLocal === ''
      ? addWallTime(joinOpensAt, timeZone, 14)
      : parse(joinClosesLocal, 'joinClosesLocal');
    if (joinClosesAt === null || Object.keys(errors).length > 0) return { ok: false, errors };
    const handInAt = handInLocal === undefined || handInLocal === ''
      ? addWallTime(joinOpensAt, timeZone, 70)
      : parse(handInLocal, 'handInLocal');
    if (handInAt === null || Object.keys(errors).length > 0) return { ok: false, errors };
    if (joinClosesAt.getTime() <= joinOpensAt.getTime()) {
      return { ok: false, errors: { joinClosesLocal: 'Join closes must be after Join opens.' } };
    }
    if (!laterThanNowCheck(handInAt)) return { ok: false, errors };
    if (!atOrAfterJoinCloses(handInAt, joinClosesAt)) return { ok: false, errors };
    return { ok: true, joinOpensAt, joinClosesAt, handInAt };
  }

  function addWallTime(base: Date, timeZone: string, days: number): Date {
    const parts = zonedParts(base, timeZone);
    const target = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute));
    const instant = localToInstant(`${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(target.getUTCDate())}T${pad(target.getUTCHours())}:${pad(target.getUTCMinutes())}`, timeZone);
    return instant ?? addDays(base, days);
  }

  function pad(n: number): string { return n < 10 ? `0${n}` : `${n}`; }

  add('GET', '/api/classrooms', t(async (ctx) => {
    const r = await requireEducator(ctx);
    if ('error' in r) return r.error;
    const { rows } = await pool.query(`
      SELECT c.* FROM classrooms c
      WHERE c.owner_id = $1 OR EXISTS (SELECT 1 FROM classroom_educators ce WHERE ce.classroom_id = c.id AND ce.educator_id = $1)
      ORDER BY c.created_at DESC
    `, [r.account.id]);
    const out = [];
    for (const row of rows) {
      const cRow: ClassroomRow = {
        id: row.id, name: row.name, timeZone: row.time_zone, joinCode: row.join_code,
        joinOpensAt: row.join_opens_at as Date, joinClosesAt: row.join_closes_at as Date,
        handInAt: row.hand_in_at as Date, archived: row.archived, ownerId: row.owner_id,
      };
      const role = cRow.ownerId === r.account.id ? 'owner' : 'assistant';
      out.push(await fullClassroom(pool, cRow, role));
    }
    return { status: 200, body: { classrooms: out } };
  }));

  add('POST', '/api/classrooms', t(async (ctx) => {
    const r = await requireVerified(ctx);
    if ('error' in r) return r.error;
    if (r.account.kind !== 'educator') return apiError(403, 'forbidden', 'Only this classroom\'s instructors can do that.');
    const body = ctx.body as { name?: string; timeZone?: string; joinOpensLocal?: string; joinClosesLocal?: string; handInLocal?: string };
    const name = (body?.name ?? '').trim();
    if (name.length < 1 || name.length > 60) return validationError({ name: 'Use 1 to 60 characters.' });
    const timeZone = body?.timeZone ?? '';
    if (!isKnownZone(timeZone)) return validationError({ timeZone: 'Choose a time zone from the list.' });
    const times = await resolveClassroomTimes(timeZone, body?.joinOpensLocal, body?.joinClosesLocal, body?.handInLocal);
    if (!times.ok) return validationError(times.errors);
    let joinCode = randomJoinCode();
    for (let i = 0; i < 20; i++) {
      const clash = await pool.query('SELECT id FROM classrooms WHERE upper(join_code) = $1 AND archived = FALSE', [joinCode]);
      if (!clash.rows[0]) break;
      joinCode = randomJoinCode();
    }

    const id = randomId('cls');
    await pool.query(
      'INSERT INTO classrooms (id, name, time_zone, join_code, join_opens_at, join_closes_at, hand_in_at, archived, owner_id) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8)',
      [id, name, timeZone, joinCode, times.joinOpensAt, times.joinClosesAt, times.handInAt, r.account.id],
    );
    await pool.query('INSERT INTO classroom_educators (classroom_id, educator_id, role) VALUES ($1, $2, $3)', [id, r.account.id, 'owner']);
    const row = await classroomById(pool, id);
    const classroom = await fullClassroom(pool, row!, 'owner');
    return { status: 201, body: classroom };
  }));

  add('GET', '/api/classrooms/:id', t(async (ctx) => {
    const r = await requireAccount(ctx);
    if ('error' in r) return r.error;
    const row = await classroomById(pool, ctx.params.id!);
    if (!row) return apiError(404, 'not_found', 'Not found.');
    const role = await educatorRole(pool, row.id, r.account.id);
    if (!role) {
      if (r.account.kind === 'student' && r.account.classroomId === row.id) {
        return apiError(403, 'forbidden', 'Only this classroom\'s instructors can do that.');
      }
      return apiError(404, 'not_found', 'Not found.');
    }
    const classroom = await fullClassroom(pool, row, role);
    return { status: 200, body: classroom };
  }));

  add('PATCH', '/api/classrooms/:id', t(async (ctx) => {
    const r = await requireAccount(ctx);
    if ('error' in r) return r.error;
    const row = await classroomById(pool, ctx.params.id!);
    if (!row) return apiError(404, 'not_found', 'Not found.');
    const role = await educatorRole(pool, row.id, r.account.id);
    if (!role) {
      if (r.account.kind === 'student' && r.account.classroomId === row.id) return apiError(403, 'forbidden', 'Only this classroom\'s instructors can do that.');
      return apiError(404, 'not_found', 'Not found.');
    }
    if (role !== 'owner') return apiError(403, 'forbidden', 'Only this classroom\'s instructors can do that.');
    const state = classroomStateOf(row, now());
    if (state === 'handed_in') return apiError(409, 'classroom_handed_in', 'This classroom was handed in. Changes are no longer saved.');
    if (state === 'archived') return apiError(409, 'classroom_archived', 'This classroom is archived.');
    const body = ctx.body as { joinOpensLocal?: string; joinClosesLocal?: string; handInLocal?: string };
    const times = await resolveClassroomTimes(row.timeZone, body?.joinOpensLocal, body?.joinClosesLocal, body?.handInLocal, { joinOpensAt: row.joinOpensAt, joinClosesAt: row.joinClosesAt, handInAt: row.handInAt });
    if (!times.ok) return validationError(times.errors);
    await pool.query('UPDATE classrooms SET join_opens_at = $2, join_closes_at = $3, hand_in_at = $4 WHERE id = $1',
      [row.id, times.joinOpensAt, times.joinClosesAt, times.handInAt]);
    const updated = await classroomById(pool, row.id);
    const classroom = await fullClassroom(pool, updated!, role);
    broadcastState(classroom);
    return { status: 200, body: classroom };
  }));

  function broadcastState(classroom: import('../shared/types.js').Classroom): void {
    stream.broadcast({
      event: 'classroom-state',
      data: { classroomId: classroom.id, state: classroom.state, serverNow: classroom.serverNow, secondsToHandIn: classroom.secondsToHandIn },
    }, { classroomId: classroom.id });
  }

  add('POST', '/api/classrooms/:id/join-code', t(async (ctx) => {
    const r = await requireAccount(ctx);
    if ('error' in r) return r.error;
    const row = await classroomById(pool, ctx.params.id!);
    if (!row) return apiError(404, 'not_found', 'Not found.');
    const role = await educatorRole(pool, row.id, r.account.id);
    if (!role) {
      if (r.account.kind === 'student' && r.account.classroomId === row.id) return apiError(403, 'forbidden', 'Only this classroom\'s instructors can do that.');
      return apiError(404, 'not_found', 'Not found.');
    }
    if (row.archived) return apiError(409, 'classroom_archived', 'This classroom is archived.');
    let code = randomJoinCode();
    for (let i = 0; i < 20; i++) {
      const clash = await pool.query('SELECT id FROM classrooms WHERE upper(join_code) = $1 AND archived = FALSE', [code]);
      if (!clash.rows[0]) break;
      code = randomJoinCode();
    }
    await pool.query('UPDATE classrooms SET join_code = $2 WHERE id = $1', [row.id, code]);
    return { status: 200, body: { joinCode: code } };
  }));

  add('POST', '/api/classrooms/:id/hand-in', t(async (ctx) => {
    const r = await requireAccount(ctx);
    if ('error' in r) return r.error;
    const row = await classroomById(pool, ctx.params.id!);
    if (!row) return apiError(404, 'not_found', 'Not found.');
    const role = await educatorRole(pool, row.id, r.account.id);
    if (!role) {
      if (r.account.kind === 'student' && r.account.classroomId === row.id) return apiError(403, 'forbidden', 'Only this classroom\'s instructors can do that.');
      return apiError(404, 'not_found', 'Not found.');
    }
    const state = classroomStateOf(row, now());
    if (state === 'draft') return apiError(409, 'classroom_not_started', 'This classroom hasn\'t opened yet.');
    if (state === 'handed_in') return apiError(409, 'classroom_handed_in', 'This classroom was handed in. Changes are no longer saved.');
    if (state === 'archived') return apiError(409, 'classroom_archived', 'This classroom is archived.');
    const t = now();
    await pool.query('UPDATE classrooms SET hand_in_at = $2 WHERE id = $1', [row.id, t]);
    const updated = await classroomById(pool, row.id);
    const classroom = await fullClassroom(pool, updated!, role);
    broadcastState(classroom);
    return { status: 200, body: classroom };
  }));

  add('POST', '/api/classrooms/:id/archive', t(async (ctx) => {
    const r = await requireAccount(ctx);
    if ('error' in r) return r.error;
    const row = await classroomById(pool, ctx.params.id!);
    if (!row) return apiError(404, 'not_found', 'Not found.');
    const role = await educatorRole(pool, row.id, r.account.id);
    if (!role) {
      if (r.account.kind === 'student' && r.account.classroomId === row.id) return apiError(403, 'forbidden', 'Only this classroom\'s instructors can do that.');
      return apiError(404, 'not_found', 'Not found.');
    }
    if (role !== 'owner') return apiError(403, 'forbidden', 'Only this classroom\'s instructors can do that.');
    const state = classroomStateOf(row, now());
    if (state !== 'handed_in') return apiError(409, 'not_handed_in', 'Hand in the classroom before archiving it.');
    await pool.query('UPDATE classrooms SET archived = TRUE, archived_at = $2 WHERE id = $1', [row.id, now()]);
    const updated = await classroomById(pool, row.id);
    const classroom = await fullClassroom(pool, updated!, 'owner');
    broadcastState(classroom);
    return { status: 200, body: classroom };
  }));

  // ---------------- students and assistants ----------------

  async function classroomForEducator(ctx: Ctx): Promise<{ row: ClassroomRow; role: 'owner' | 'assistant' } | { error: HandlerResult } | { notFound: true, forbiddenStudent: boolean }> {
    const r = await requireAccount(ctx);
    if ('error' in r) return { error: r.error };
    const row = await classroomById(pool, ctx.params.id!);
    if (!row) return { notFound: true, forbiddenStudent: false };
    const role = await educatorRole(pool, row.id, r.account.id);
    if (!role) {
      return { notFound: true, forbiddenStudent: r.account.kind === 'student' && r.account.classroomId === row.id };
    }
    return { row, role };
  }

  add('PATCH', '/api/classrooms/:id/students/:studentId', t(async (ctx) => {
    const target = await classroomForEducator(ctx);
    if ('error' in target) return target.error;
    if ('notFound' in target) return apiError(target.forbiddenStudent ? 403 : 404, target.forbiddenStudent ? 'forbidden' : 'not_found', target.forbiddenStudent ? 'Only this classroom\'s instructors can do that.' : 'Not found.');
    const { row } = target;
    const { rows } = await pool.query('SELECT id FROM students WHERE id = $1 AND classroom_id = $2', [ctx.params.studentId, row.id]);
    if (!rows[0]) return apiError(404, 'not_found', 'Not found.');
    const raw = (ctx.body as { nickname?: string })?.nickname ?? '';
    const nickname = normalizeNickname(raw);
    if (!isNicknameValid(raw)) return validationError({ nickname: 'Use 2 to 24 letters, numbers, spaces, hyphens or apostrophes.' });
    const taken = await pool.query('SELECT id FROM students WHERE classroom_id = $1 AND lower(nickname) = $2 AND id != $3', [row.id, nicknameKey(nickname), ctx.params.studentId]);
    if (taken.rows[0]) return apiError(409, 'nickname_taken', 'That nickname is taken in this classroom.');
    await pool.query('UPDATE students SET nickname = $2 WHERE id = $1', [ctx.params.studentId, nickname]);
    await pool.query('UPDATE accounts SET display_name = $2, nickname = $2 WHERE id = $1', [ctx.params.studentId, nickname]);
    stream.broadcast({ event: 'student-renamed', data: { classroomId: row.id, studentId: ctx.params.studentId!, nickname } }, { classroomId: row.id });
    return { status: 200, body: { id: ctx.params.studentId, nickname } };
  }));

  add('DELETE', '/api/classrooms/:id/students/:studentId', t(async (ctx) => {
    const target = await classroomForEducator(ctx);
    if ('error' in target) return target.error;
    if ('notFound' in target) return apiError(target.forbiddenStudent ? 403 : 404, target.forbiddenStudent ? 'forbidden' : 'not_found', target.forbiddenStudent ? 'Only this classroom\'s instructors can do that.' : 'Not found.');
    const { row } = target;
    const { rows } = await pool.query('SELECT id, nickname FROM students WHERE id = $1 AND classroom_id = $2', [ctx.params.studentId, row.id]);
    const student = rows[0];
    if (!student) return apiError(404, 'not_found', 'Not found.');
    await removeStudent(row, student.id, student.nickname);
    return { status: 204 };
  }));

  async function removeStudent(classroom: ClassroomRow, studentId: string, nickname: string): Promise<void> {
    const classroomId = classroom.id;
    const projectRows = await pool.query('SELECT id FROM projects WHERE owner_id = $1', [studentId]);
    const projectIds = projectRows.rows.map((r) => r.id as string);
    await endSessionsForAccount(pool, studentId, 'removed');
    await pool.query('DELETE FROM students WHERE id = $1', [studentId]);
    await pool.query('DELETE FROM accounts WHERE id = $1', [studentId]);
    if (projectIds.length > 0) {
      await pool.query('DELETE FROM projects WHERE owner_id = $1', [studentId]);
      await pool.query('DELETE FROM exports WHERE owner_id = $1', [studentId]);
      for (const pid of projectIds) {
        await storage.delPrefix(`projects/${pid}/`).catch(() => undefined);
      }
    }
    stream.broadcast({ event: 'student-removed', data: { classroomId, studentId, nickname } }, { classroomId });
    stream.closeForAccountClassroom(studentId, classroomId, `You were removed from ${classroom.name}.`);
  }

  add('POST', '/api/classrooms/:id/educators', t(async (ctx) => {
    const target = await classroomForEducator(ctx);
    if ('error' in target) return target.error;
    if ('notFound' in target) return apiError(target.forbiddenStudent ? 403 : 404, target.forbiddenStudent ? 'forbidden' : 'not_found', target.forbiddenStudent ? 'Only this classroom\'s instructors can do that.' : 'Not found.');
    const { row, role } = target;
    if (role !== 'owner') return apiError(403, 'forbidden', 'Only this classroom\'s instructors can do that.');
    const email = ((ctx.body as { email?: string })?.email ?? '').trim().toLocaleLowerCase('en-US');
    const { rows } = await pool.query('SELECT id, display_name, email FROM accounts WHERE lower(email) = $1 AND kind = $2 AND email_verified = TRUE', [email, 'educator']);
    const educator = rows[0];
    if (!educator) return apiError(422, 'no_such_educator', 'No verified Educator account uses that email.');
    const already = await pool.query('SELECT 1 FROM classroom_educators WHERE classroom_id = $1 AND educator_id = $2', [row.id, educator.id]);
    if (already.rows[0]) return apiError(409, 'already_added', 'That instructor is already in this classroom.');
    await pool.query('INSERT INTO classroom_educators (classroom_id, educator_id, role) VALUES ($1, $2, $3)', [row.id, educator.id, 'assistant']);
    return { status: 201, body: { id: educator.id, displayName: educator.display_name, email: educator.email, role: 'assistant' } };
  }));

  add('DELETE', '/api/classrooms/:id/educators/:educatorId', t(async (ctx) => {
    const target = await classroomForEducator(ctx);
    if ('error' in target) return target.error;
    if ('notFound' in target) return apiError(target.forbiddenStudent ? 403 : 404, target.forbiddenStudent ? 'forbidden' : 'not_found', target.forbiddenStudent ? 'Only this classroom\'s instructors can do that.' : 'Not found.');
    const { row, role } = target;
    if (role !== 'owner') return apiError(403, 'forbidden', 'Only this classroom\'s instructors can do that.');
    if (ctx.params.educatorId === row.ownerId) return apiError(409, 'owner_cannot_leave', 'The classroom owner can\'t be removed.');
    const { rows } = await pool.query('SELECT educator_id, role FROM classroom_educators WHERE classroom_id = $1 AND educator_id = $2', [row.id, ctx.params.educatorId]);
    if (!rows[0]) return apiError(404, 'not_found', 'Not found.');
    await pool.query('DELETE FROM classroom_educators WHERE classroom_id = $1 AND educator_id = $2', [row.id, ctx.params.educatorId]);
    stream.closeForAccountClassroom(ctx.params.educatorId!, row.id, `You were removed from ${row.name}.`);
    return { status: 204 };
  }));

  add('GET', '/api/classrooms/:id/exports', t(async (ctx) => {
    const target = await classroomForEducator(ctx);
    if ('error' in target) return target.error;
    if ('notFound' in target) return apiError(target.forbiddenStudent ? 403 : 404, target.forbiddenStudent ? 'forbidden' : 'not_found', target.forbiddenStudent ? 'Only this classroom\'s instructors can do that.' : 'Not found.');
    const { row } = target;
    const { rows } = await pool.query(`
      SELECT e.*, s.nickname FROM exports e
      JOIN accounts a ON a.id = e.owner_id
      JOIN students s ON s.id = a.id
      WHERE a.classroom_id = $1
      ORDER BY e.created_at DESC
    `, [row.id]);
    return {
      status: 200,
      body: {
        exports: rows.map((r) => ({
          id: r.id, projectId: r.project_id, ownerId: r.owner_id, fileName: r.file_name,
          format: r.format, unit: r.unit, bytes: r.bytes, triangleCount: r.triangle_count,
          bbox: r.bbox_x === null ? null : { x: r.bbox_x, y: r.bbox_y, z: r.bbox_z },
          createdAt: (r.created_at as Date).toISOString(), downloadUrl: `/api/exports/${r.id}/download`,
          nickname: r.nickname,
        })),
      },
    };
  }));

  // ---------------- projects ----------------

  function snapshotKindOf(snapshot: unknown): string | null {
    if (typeof snapshot !== 'object' || snapshot === null) return null;
    const kind = (snapshot as { kind?: unknown }).kind;
    return kind === '3d' || kind === 'circuit' || kind === 'blocks' ? kind : null;
  }

  async function projectById(id: string): Promise<{ id: string; kind: string; name: string; ownerId: string; classroomId: string | null; revision: number; handedIn: boolean; savedAt: Date } | null> {
    const { rows } = await pool.query('SELECT id, kind, name, owner_id, classroom_id, revision, handed_in, saved_at FROM projects WHERE id = $1', [id]);
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, kind: r.kind, name: r.name, ownerId: r.owner_id, classroomId: r.classroom_id, revision: r.revision, handedIn: r.handed_in, savedAt: r.saved_at as Date };
  }

  function serializeProject(p: NonNullable<Awaited<ReturnType<typeof projectById>>>): import('../shared/types.js').Project {
    return {
      id: p.id, kind: p.kind as '3d' | 'circuit' | 'blocks', name: p.name, ownerId: p.ownerId,
      classroomId: p.classroomId, revision: p.revision, savedAt: p.savedAt.toISOString(),
      state: p.handedIn ? 'handed_in' : 'editing',
    };
  }

  add('GET', '/api/projects', t(async (ctx) => {
    const r = await requireAccount(ctx);
    if ('error' in r) return r.error;
    const { rows } = await pool.query('SELECT id, kind, name, owner_id, classroom_id, revision, handed_in, saved_at FROM projects WHERE owner_id = $1 ORDER BY saved_at DESC', [r.account.id]);
    return { status: 200, body: { projects: rows.map((row) => serializeProject({
      id: row.id, kind: row.kind, name: row.name, ownerId: row.owner_id, classroomId: row.classroom_id,
      revision: row.revision, handedIn: row.handed_in, savedAt: row.saved_at as Date,
    })) } };
  }));

  add('POST', '/api/projects', t(async (ctx) => {
    const r = await requireVerified(ctx);
    if ('error' in r) return r.error;
    const body = ctx.body as { kind?: string; name?: string; snapshot?: unknown };
    const kind = body?.kind;
    if (kind !== '3d' && kind !== 'circuit' && kind !== 'blocks') return validationError({ kind: 'Check the highlighted fields.' });
    if (snapshotKindOf(body?.snapshot) !== kind) return validationError({ snapshot: 'Check the highlighted fields.' });
    const name = (body?.name ?? '').trim();
    if (name.length < 1 || name.length > 60) return validationError({ name: 'Use 1 to 60 characters.' });

    let classroomId: string | null = null;
    if (r.account.kind === 'student') {
      classroomId = r.account.classroomId;
      if (!classroomId) return apiError(404, 'not_found', 'Project not found');
      const classroom = await classroomById(pool, classroomId);
      if (!classroom) return apiError(404, 'not_found', 'Project not found');
      const state = classroomStateOf(classroom, now());
      if (state === 'handed_in') return apiError(409, 'classroom_handed_in', 'This classroom was handed in. Changes are no longer saved.');
      if (state === 'archived') return apiError(401, 'signed_out', 'Sign in to continue.');
    }

    const id = randomId('prj');
    try {
      await snapshotStore.put(id, 1, JSON.stringify(body?.snapshot));
    } catch {
      return apiError(503, 'storage_unavailable', 'Save failed: storage is unavailable. Your design is safe; try again.');
    }
    await pool.query(
      'INSERT INTO projects (id, kind, name, owner_id, classroom_id, revision, handed_in, saved_at) VALUES ($1, $2, $3, $4, $5, 1, FALSE, $6)',
      [id, kind, name, r.account.id, classroomId, now()],
    );
    const p = await projectById(id);
    const project = serializeProject(p!);
    stream.broadcast({ event: 'project-saved', data: { projectId: id, ownerId: r.account.id, classroomId, revision: 1, savedAt: project.savedAt, kind, name } }, { classroomId, ownerId: r.account.id });
    return { status: 201, body: { project } };
  }));

  add('GET', '/api/projects/:id', t(async (ctx) => {
    const r = await requireAccount(ctx);
    if ('error' in r) return r.error;
    const p = await projectById(ctx.params.id!);
    if (!p) return apiError(404, 'not_found', 'Project not found');
    const visible = await canSeeProject(r.account, p);
    if (!visible) return apiError(404, 'not_found', 'Project not found');
    let snapshot: string;
    try {
      snapshot = await snapshotStore.get(p.id, p.revision);
    } catch {
      return apiError(503, 'storage_unavailable', 'Storage is unavailable. Try again in a minute.');
    }
    return { status: 200, body: { project: serializeProject(p), snapshot: JSON.parse(snapshot) } };
  }));

  async function canSeeProject(account: import('../shared/types.js').Account, p: NonNullable<Awaited<ReturnType<typeof projectById>>>): Promise<boolean> {
    if (p.ownerId === account.id) return true;
    if (p.classroomId) {
      const role = await educatorRole(pool, p.classroomId, account.id);
      return role !== null;
    }
    return false;
  }

  add('PUT', '/api/projects/:id', t(async (ctx) => {
    const r = await requireAccount(ctx);
    if ('error' in r) return r.error;
    const p = await projectById(ctx.params.id!);
    if (!p) return apiError(404, 'not_found', 'Project not found');

    // Idempotency replay and conflict right after the 404 check.
    const idemKey = (ctx.req.headers['idempotency-key'] as string | undefined) ?? null;
    const bodyHash = cryptoHash(ctx.rawBody);
    if (idemKey) {
      const { rows } = await pool.query('SELECT request_hash, response_json FROM idempotency_keys WHERE project_id = $1 AND account_id = $2 AND key = $3', [p.id, r.account.id, idemKey]);
      const stored = rows[0];
      if (stored) {
        if (stored.request_hash === bodyHash) {
          return JSON.parse(stored.response_json) as HandlerResult;
        }
        return apiError(409, 'idempotency_conflict', 'That save was already sent with different content.');
      }
    }

    if (p.ownerId !== r.account.id) {
      const visible = await canSeeProject(r.account, p);
      if (visible) return apiError(403, 'forbidden', 'Only this classroom\'s instructors can do that.');
      return apiError(404, 'not_found', 'Project not found');
    }
    if (r.account.kind !== 'student' && !r.account.emailVerified) return apiError(403, 'email_unverified', 'Verify your email to save projects.');

    const body = ctx.body as { baseRevision?: number; snapshot?: unknown; name?: string };
    const baseRevision = typeof body?.baseRevision === 'number' ? body.baseRevision : NaN;
    if (!Number.isInteger(baseRevision) || baseRevision < 1) return validationError({ baseRevision: 'Check the highlighted fields.' });
    if (snapshotKindOf(body?.snapshot) !== p.kind) return validationError({ snapshot: 'Check the highlighted fields.' });
    let name = p.name;
    if (body?.name !== undefined) {
      const trimmed = (body.name ?? '').trim();
      if (trimmed.length < 1 || trimmed.length > 60) return validationError({ name: 'Use 1 to 60 characters.' });
      name = trimmed;
    }

    let classroomState: string | null = null;
    if (p.classroomId) {
      const classroom = await classroomById(pool, p.classroomId);
      if (classroom) classroomState = classroomStateOf(classroom, now());
    }
    if (classroomState === 'handed_in' || classroomState === 'archived') {
      return apiError(409, 'classroom_handed_in', 'This classroom was handed in. Changes are no longer saved.');
    }
    if (p.handedIn) return apiError(409, 'project_handed_in', 'You handed in this project. Changes are no longer saved.');
    if (baseRevision !== p.revision) {
      return apiError(409, 'stale_revision', 'This project changed in another tab. Reload to see the latest version.', { currentRevision: p.revision });
    }

    const newRevision = p.revision + 1;
    try {
      await snapshotStore.put(p.id, newRevision, JSON.stringify(body?.snapshot));
    } catch {
      return apiError(503, 'storage_unavailable', 'Save failed: storage is unavailable. Your design is safe; try again.');
    }
    const updated = await pool.query(
      'UPDATE projects SET revision = $2, saved_at = $3, name = $4 WHERE id = $1 AND revision = $5 RETURNING revision',
      [p.id, newRevision, now(), name, baseRevision],
    );
    if ((updated.rows[0]?.revision as number | undefined) !== newRevision) {
      // Concurrent save won; do not leave the stored snapshot as current.
      await snapshotStore.del(p.id, newRevision).catch(() => undefined);
      return apiError(409, 'stale_revision', 'This project changed in another tab. Reload to see the latest version.', { currentRevision: p.revision });
    }
    const savedAt = now().toISOString();
    const project: import('../shared/types.js').Project = {
      id: p.id, kind: p.kind as '3d' | 'circuit' | 'blocks', name, ownerId: p.ownerId,
      classroomId: p.classroomId, revision: newRevision, savedAt, state: 'editing',
    };
    const result: HandlerResult = { status: 200, body: { project } };
    if (idemKey) {
      await pool.query(
        'INSERT INTO idempotency_keys (project_id, account_id, key, request_hash, response_json) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
        [p.id, r.account.id, idemKey, bodyHash, JSON.stringify(result)],
      );
    }
    stream.broadcast({ event: 'project-saved', data: { projectId: p.id, ownerId: p.ownerId, classroomId: p.classroomId, revision: newRevision, savedAt, kind: p.kind, name } }, { classroomId: p.classroomId, ownerId: p.ownerId });
    return result;
  }));

  function cryptoHash(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  add('POST', '/api/projects/:id/hand-in', t(async (ctx) => {
    const r = await requireAccount(ctx);
    if ('error' in r) return r.error;
    const p = await projectById(ctx.params.id!);
    if (!p) return apiError(404, 'not_found', 'Project not found');
    if (p.ownerId !== r.account.id) {
      const visible = await canSeeProject(r.account, p);
      if (visible) return apiError(403, 'forbidden', 'Only this classroom\'s instructors can do that.');
      return apiError(404, 'not_found', 'Project not found');
    }
    if (!p.classroomId) return apiError(409, 'not_a_classroom_project', 'Only classroom projects are handed in.');
    const classroom = await classroomById(pool, p.classroomId);
    if (classroom) {
      const state = classroomStateOf(classroom, now());
      if (state === 'handed_in' || state === 'archived') return apiError(409, 'classroom_handed_in', 'This classroom was handed in. Changes are no longer saved.');
    }
    if (p.handedIn) return apiError(409, 'project_handed_in', 'You handed in this project. Changes are no longer saved.');
    await pool.query('UPDATE projects SET handed_in = TRUE WHERE id = $1', [p.id]);
    stream.broadcast({ event: 'project-handed-in', data: { projectId: p.id, ownerId: p.ownerId, classroomId: p.classroomId } }, { classroomId: p.classroomId });
    const updated = await projectById(p.id);
    return { status: 200, body: { project: serializeProject(updated!) } };
  }));

  // ---------------- exports ----------------

  add('POST', '/api/exports', t(async (ctx) => {
    const r = await requireVerified(ctx);
    if ('error' in r) return r.error;
    const format = ctx.url.searchParams.get('format');
    const unit = ctx.url.searchParams.get('unit');
    const name = ctx.url.searchParams.get('name');
    const projectId = ctx.url.searchParams.get('projectId');
    if (format !== 'stl' && format !== 'obj' && format !== 'svg') return validationError({ format: 'Check the highlighted fields.' });
    if (unit !== 'mm' && unit !== 'in') return validationError({ unit: 'Check the highlighted fields.' });
    if (!name || !isValidExportFileName(name, format)) return validationError({ name: 'Check the highlighted fields.' });

    let project: NonNullable<Awaited<ReturnType<typeof projectById>>> | null = null;
    if (projectId) {
      project = await projectById(projectId);
      if (!project || !(await canSeeProject(r.account, project))) return apiError(404, 'not_found', 'Project not found');
      if (project.kind === 'circuit' && (format !== 'svg' || unit !== 'mm')) {
        return validationError({ format: 'Check the highlighted fields.' });
      }
    }

    const file = ctx.rawBody;
    const ext = name.slice(name.lastIndexOf('.') + 1);
    if (ext !== format) return validationError({ name: 'Check the highlighted fields.' });

    // Structural checks per format.
    if (format === 'stl') {
      if (file.length < 84 || (file.length - 84) % 50 !== 0) return validationError({ file: 'Check the highlighted fields.' });
    } else if (format === 'obj') {
      const text = file.toString('utf8');
      if (!/^f\s/m.test(text)) return validationError({ file: 'Check the highlighted fields.' });
    } else {
      const text = file.toString('utf8');
      if (!/<svg[\s>]/i.test(text)) return validationError({ file: 'Check the highlighted fields.' });
    }

    let bbox: { x: number; y: number; z: number } | null = null;
    let triangleCount: number | null = null;
    if (project && project.kind === 'circuit') {
      bbox = null;
      triangleCount = null;
    } else {
      const dims = extractDims(name, ctx.url.searchParams.get('bbox'));
      if (dims) bbox = dims;
      if (format === 'stl') triangleCount = (file.length - 84) / 50;
      if (format === 'obj') triangleCount = countObjFaces(file.toString('utf8'));
    }

    const id = randomId('exp');
    try {
      await storage.put(`exports/${r.account.id}/${id}/${name}`, file);
    } catch {
      return apiError(503, 'storage_unavailable', 'Export failed: storage is unavailable. Your design is safe; try again.');
    }
    await pool.query(
      'INSERT INTO exports (id, project_id, owner_id, file_name, format, unit, bytes, triangle_count, bbox_x, bbox_y, bbox_z, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
      [id, project?.id ?? null, r.account.id, name, format, unit, file.length, triangleCount, bbox?.x ?? null, bbox?.y ?? null, bbox?.z ?? null, now()],
    );
    return {
      status: 201,
      body: {
        id, projectId: project?.id ?? null, ownerId: r.account.id, fileName: name, format, unit,
        bytes: file.length, triangleCount, bbox, createdAt: now().toISOString(), downloadUrl: `/api/exports/${id}/download`,
      },
    };

    function extractDims(_n: string, raw: string | null): { x: number; y: number; z: number } | null {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as { x: number; y: number; z: number };
        return parsed;
      } catch {
        return null;
      }
    }
    function countObjFaces(text: string): number {
      return (text.match(/^f\s/gm) ?? []).length;
    }
  }));

  add('GET', '/api/exports', t(async (ctx) => {
    const r = await requireAccount(ctx);
    if ('error' in r) return r.error;
    const { rows } = await pool.query('SELECT * FROM exports WHERE owner_id = $1 ORDER BY created_at DESC', [r.account.id]);
    return {
      status: 200,
      body: {
        exports: rows.map((row) => ({
          id: row.id, projectId: row.project_id, ownerId: row.owner_id, fileName: row.file_name,
          format: row.format, unit: row.unit, bytes: row.bytes, triangleCount: row.triangle_count,
          bbox: row.bbox_x === null ? null : { x: row.bbox_x, y: row.bbox_y, z: row.bbox_z },
          createdAt: (row.created_at as Date).toISOString(), downloadUrl: `/api/exports/${row.id}/download`,
        })),
      },
    };
  }));

  add('GET', '/api/exports/:id/download', t(async (ctx) => {
    const r = await requireAccount(ctx);
    if ('error' in r) return r.error;
    const { rows } = await pool.query('SELECT * FROM exports WHERE id = $1', [ctx.params.id]);
    const row = rows[0];
    if (!row) return apiError(404, 'not_found', 'Project not found');
    let allowed = row.owner_id === r.account.id;
    if (!allowed && row.project_id) {
      const p = await projectById(row.project_id);
      if (p?.classroomId) allowed = (await educatorRole(pool, p.classroomId, r.account.id)) !== null;
    }
    if (!allowed) return apiError(404, 'not_found', 'Project not found');
    let data: Buffer;
    try {
      data = await storage.get(`exports/${row.owner_id}/${row.id}/${row.file_name}`);
    } catch {
      return apiError(503, 'storage_unavailable', 'Storage is unavailable. Try again in a minute.');
    }
    const contentType = row.format === 'stl' ? 'model/stl' : row.format === 'obj' ? 'model/obj' : 'image/svg+xml';
    return { status: 200, headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${row.file_name}"`, 'Content-Length': String(data.length) }, body: data };
  }));

  // ---------------- live stream ----------------

  add('GET', '/api/stream', t(async (ctx) => {
    if (!ctx.session || ctx.session.kind === 'ended' || ctx.session.kind === 'pending_join' || !ctx.session.accountId) {
      return apiError(401, 'signed_out', 'Sign in to continue.');
    }
    const account = await accountById(pool, ctx.session.accountId);
    if (!account) return apiError(401, 'signed_out', 'Sign in to continue.');
    const classroomIds = new Set<string>();
    if (account.kind === 'student' && account.classroomId) classroomIds.add(account.classroomId);
    if (account.kind === 'educator') {
      const { rows } = await pool.query('SELECT classroom_id FROM classroom_educators WHERE educator_id = $1', [account.id]);
      for (const row of rows) classroomIds.add(row.classroom_id as string);
    }
    // Hand over the response to the stream; the route result is void.
    stream.openStream(ctx.res, account.id, account.kind, classroomIds);
    return undefined;
  }));

  // ---------------- grading ----------------

  add('POST', '/api/grading/seed', t(async (ctx) => {
    const token = ctx.req.headers['x-grading-token'] as string | undefined;
    if (token !== cfg.gradingToken) return apiError(403, 'forbidden', 'Only this classroom\'s instructors can do that.');
    const result = await seedData();
    return { status: 200, body: result };
  }));

  add('GET', '/api/grading/session', t(async (ctx) => {
    const token = ctx.url.searchParams.get('token');
    const userId = ctx.url.searchParams.get('user');
    if (token !== cfg.gradingToken) return apiError(403, 'forbidden', 'Only this classroom\'s instructors can do that.');
    const account = userId ? await accountById(pool, userId) : null;
    if (!account) return apiError(404, 'not_found', 'Not found.');
    const home = account.kind === 'educator' ? '/dashboard' : account.kind === 'personal' ? '/projects' : '/class';
    await createSession(ctx, 'account', account.id, null);
    return { status: 302, headers: { Location: home }, body: undefined };
  }));

  add('POST', '/api/grading/clock', t(async (ctx) => {
    const token = ctx.req.headers['x-grading-token'] as string | undefined;
    if (token !== cfg.gradingToken) return apiError(403, 'forbidden', 'Only this classroom\'s instructors can do that.');
    const body = ctx.body as { now?: string | null };
    if (body?.now === undefined) return validationError({ now: 'Check the highlighted fields.' });
    if (body.now === null) {
      setClock(null);
      return { status: 200, body: { now: now().toISOString() } };
    }
    const t = new Date(body.now);
    if (Number.isNaN(t.getTime())) return validationError({ now: 'Check the highlighted fields.' });
    setClock(t);
    broadcastAllStates();
    return { status: 200, body: { now: now().toISOString() } };
  }));

  async function broadcastAllStates(): Promise<void> {
    const { rows } = await pool.query('SELECT id FROM classrooms WHERE archived = FALSE');
    for (const row of rows) {
      const cRow = await classroomById(pool, row.id);
      if (!cRow) continue;
      const state = classroomStateOf(cRow, now());
      stream.broadcast({
        event: 'classroom-state',
        data: { classroomId: cRow.id, state, serverNow: now().toISOString(), secondsToHandIn: state === 'handed_in' ? 0 : secondsUntil(now(), cRow.handInAt) },
      }, { classroomId: cRow.id });
    }
  }

  async function seedData(): Promise<unknown> {
    setClock(null);
    await pool.query('DELETE FROM idempotency_keys');
    await pool.query('DELETE FROM exports');
    await pool.query('DELETE FROM projects');
    await pool.query('DELETE FROM students');
    await pool.query('DELETE FROM classroom_educators');
    await pool.query('DELETE FROM classrooms');
    await pool.query('DELETE FROM verification_tokens');
    await pool.query('DELETE FROM sessions');
    await pool.query('DELETE FROM accounts');
    await pool.query('DELETE FROM join_attempts');
    await storage.delPrefix('projects/').catch(() => undefined);
    await storage.delPrefix('exports/').catch(() => undefined);

    let storageSeeded = true;
    const T = roundDownToMinute(now());

    async function insertAccount(id: string, kind: string, displayName: string, email: string | null, verified: boolean, password: string): Promise<void> {
      const salt = newSalt();
      await pool.query(
        'INSERT INTO accounts (id, kind, display_name, email, email_verified, password_hash, classroom_id, nickname) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)',
        [id, kind, displayName, email, verified, `${salt}:${hashPassword(password, salt)}`],
      );
    }

    const educatorId = randomId('acc');
    const assistantId = randomId('acc');
    const personalId = randomId('acc');
    await insertAccount(educatorId, 'educator', 'Dana Whitlock', 'dana@hollowbrook.test', true, 'kiln-maple-2026');
    await insertAccount(assistantId, 'educator', 'Sam Ortega', 'sam@hollowbrook.test', true, 'brass-tack-2026');
    await insertAccount(personalId, 'personal', 'Priya Natarajan', 'priya@makers.test', false, 'orbit-glue-2026');

    const classroomId = randomId('cls');
    const joinOpensAt = new Date(T.getTime() - 86400000);
    const joinClosesAt = new Date(T.getTime() + 7 * 86400000);
    const handInAt = new Date(T.getTime() + 14 * 86400000);
    await pool.query(
      'INSERT INTO classrooms (id, name, time_zone, join_code, join_opens_at, join_closes_at, hand_in_at, archived, owner_id) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8)',
      [classroomId, 'Robotics Lab', 'America/Chicago', 'ROBO42', joinOpensAt, joinClosesAt, handInAt, educatorId],
    );
    await pool.query('INSERT INTO classroom_educators (classroom_id, educator_id, role) VALUES ($1, $2, $3)', [classroomId, educatorId, 'owner']);
    await pool.query('INSERT INTO classroom_educators (classroom_id, educator_id, role) VALUES ($1, $2, $3)', [classroomId, assistantId, 'assistant']);

    const students: { id: string; nickname: string }[] = [];
    for (const nickname of ['Tiny Turtle', 'Blue Fox']) {
      const id = randomId('acc');
      await pool.query('INSERT INTO accounts (id, kind, display_name, email, email_verified, password_hash, classroom_id, nickname) VALUES ($1, $2, $3, NULL, FALSE, NULL, $4, $5)', [id, 'student', nickname, classroomId, nickname]);
      await pool.query('INSERT INTO students (id, classroom_id, nickname) VALUES ($1, $2, $3)', [id, classroomId, nickname]);
      students.push({ id, nickname });
    }

    const gearSnapshot = {
      kind: '3d',
      objects: [{
        id: 'grp1', kind: 'group', mode: 'solid', x: 0, y: 0, z: 10, w: 40, d: 40, h: 20, rotationZ: 0, color: '#4caf50',
        children: [
          { id: 'b1', kind: 'box', mode: 'solid', x: 0, y: 0, z: 10, w: 40, d: 40, h: 20, rotationZ: 0, color: '#4caf50', children: [] },
          { id: 'c1', kind: 'cylinder', mode: 'hole', x: 0, y: 0, z: 10, w: 16, d: 16, h: 20, rotationZ: 0, color: '#9c27b0', children: [] },
        ],
      }],
      workplane: { origin: [0, 0, 0], normal: [0, 0, 1] },
    };
    const nightSnapshot = {
      kind: 'circuit',
      components: [
        { label: 'BAT-1', type: 'battery', volts: 9 },
        { label: 'R-1', type: 'resistor', ohms: 330 },
        { label: 'LED-1', type: 'led' },
      ],
      wires: [{ from: 'BAT-1+', to: 'R-1+' }, { from: 'R-1-', to: 'LED-1+' }, { from: 'LED-1-', to: 'BAT-1-' }],
    };
    function sphereObject(i: number, z: number): unknown {
      return { id: `s${i}`, kind: 'sphere', mode: 'solid', x: 0, y: 0, z, w: 20, d: 20, h: 20, rotationZ: 0, color: ['#4caf50', '#9c27b0', '#ff9800'][i % 3], children: [] };
    }
    const towerSnapshot = {
      kind: 'blocks',
      program: [{ block: 'repeat', count: 3, body: [{ block: 'addSphere' }, { block: 'moveZ', mm: 10 }] }],
      objects: [sphereObject(0, 0), sphereObject(1, 10), sphereObject(2, 20)],
    };

    const owners = [
      { id: students[0]!.id, nick: 'Tiny Turtle' },
      { id: students[1]!.id, nick: 'Blue Fox' },
      { id: educatorId, nick: 'Dana Whitlock' },
    ];
    const projects: { id: string; ownerId: string; kind: string; name: string }[] = [];
    for (const owner of owners) {
      const specs = [
        { kind: '3d', name: 'Gear Box', snapshot: gearSnapshot, savedAt: new Date(T.getTime() - 5 * 60000) },
        { kind: 'circuit', name: 'Night Light', snapshot: nightSnapshot, savedAt: new Date(T.getTime() - 20 * 60000) },
        { kind: 'blocks', name: 'Sphere Tower', snapshot: towerSnapshot, savedAt: new Date(T.getTime() - 30 * 60000) },
      ];
      for (const spec of specs) {
        const pid = randomId('prj');
        try {
          for (let rev = 1; rev <= 3; rev++) {
            await snapshotStore.put(pid, rev, JSON.stringify(spec.snapshot));
          }
        } catch {
          storageSeeded = false;
        }
        await pool.query(
          'INSERT INTO projects (id, kind, name, owner_id, classroom_id, revision, handed_in, saved_at) VALUES ($1, $2, $3, $4, $5, 3, FALSE, $6)',
          [pid, spec.kind, spec.name, owner.id, owner.id === educatorId ? null : classroomId, spec.savedAt],
        );
        projects.push({ id: pid, ownerId: owner.id, kind: spec.kind, name: spec.name });
      }
    }

    return {
      educator: { id: educatorId, email: 'dana@hollowbrook.test', password: 'kiln-maple-2026', displayName: 'Dana Whitlock' },
      assistant: { id: assistantId, email: 'sam@hollowbrook.test', password: 'brass-tack-2026', displayName: 'Sam Ortega' },
      personal: { id: personalId, email: 'priya@makers.test', password: 'orbit-glue-2026', displayName: 'Priya Natarajan' },
      classroom: { id: classroomId, name: 'Robotics Lab', joinCode: 'ROBO42', timeZone: 'America/Chicago', joinOpensAt: joinOpensAt.toISOString(), joinClosesAt: joinClosesAt.toISOString(), handInAt: handInAt.toISOString() },
      students: students.map((s) => ({ id: s.id, nickname: s.nickname })),
      projects: projects.map((p) => ({ id: p.id, ownerId: p.ownerId, kind: p.kind, name: p.name, revision: 3 })),
      storageSeeded,
    };
  }

  return routes;
}
