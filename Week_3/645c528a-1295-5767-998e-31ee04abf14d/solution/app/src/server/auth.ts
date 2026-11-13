import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { promisify } from 'node:util';
import { query, transaction, type Db } from './db';
import { ApiError, isUniqueViolation, validationFailed } from './errors';
import { enqueueMail, deliverNow } from './mail';
import { balance, lockPlayer, SYSTEM, wallet, writePair } from './ledger';
import { route, openRoute, type Json, type Reply } from './http';
import { notifyPlayer } from './realtime';

const hashScrypt = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

const SESSION_COOKIE = 'hs_session';
const SIGN_UP_GRANT = 1000;
const FAILED_SIGN_IN_LIMIT = 5;
const FAILED_SIGN_IN_WINDOW_S = 60;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXY23456789';

export interface Session {
  id: string;
  playerId: string;
}

const SENTENCES = {
  underAge: 'Headstring is for players 13 and over.',
  email: 'Enter a valid email address.',
  password: 'Use at least 8 characters.',
  displayName: 'Use 2 to 20 characters.',
  birthYear: 'Enter a four-digit year.',
  emailTaken: 'That email already has an account.',
  badSignIn: 'Email or password is wrong.',
  rateLimited: 'Too many tries. Wait a minute and try again.',
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await hashScrypt(password, salt, 32);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function passwordMatches(password: string, stored: string | null): Promise<boolean> {
  const [salt, expected] = (stored ?? `${'0'.repeat(32)}:${'0'.repeat(64)}`).split(':');
  const derived = await hashScrypt(password, Buffer.from(salt, 'hex'), 32);
  return timingSafeEqual(derived, Buffer.from(expected, 'hex')) && stored !== null;
}

function cookieToken(request: IncomingMessage): string | null {
  const header = request.headers.cookie ?? '';
  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(header);
  return match?.[1] ?? null;
}

export async function sessionFromRequest(request: IncomingMessage): Promise<Session | null> {
  const token = cookieToken(request);
  if (token === null) return null;
  const rows = await query<{ id: string; player_id: string }>('SELECT id, player_id FROM sessions WHERE token_hash = $1', [sha256(token)]);
  return rows.length === 0 ? null : { id: rows[0].id, playerId: rows[0].player_id };
}

async function createSession(client: Db, playerId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await client.query('INSERT INTO sessions (token_hash, id, player_id) VALUES ($1,$2,$3)', [sha256(token), randomUUID(), playerId]);
  return token;
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function ageOf(birthYear: number): number {
  return new Date().getUTCFullYear() - birthYear;
}

export function isMinor(birthYear: number | null): boolean {
  return birthYear !== null && ageOf(birthYear) < 18;
}

function friendCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

interface NewPlayer {
  email: string;
  password: string;
  displayName: string;
  birthYear: number;
  level: number;
  xp: number;
  emailVerified: boolean;
}

/** One account row, its session-independent grants and its Starter Cue; sign-up and the grading route share it. */
export async function insertPlayer(client: Db, player: NewPlayer): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO players (id, email, password_hash, display_name, birth_year, level, xp, email_verified, friend_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, player.email.toLowerCase(), await hashPassword(player.password), player.displayName, player.birthYear, player.level, player.xp, player.emailVerified, friendCode()],
  );
  await client.query(`INSERT INTO owned_items (player_id, item_id) VALUES ($1,'cue-starter'), ($1,'cloth-hall-blue')`, [id]);
  return id;
}

export interface PlayerRow {
  id: string;
  email: string;
  display_name: string;
  birth_year: number;
  level: number;
  xp: number;
  wins: number;
  losses: number;
  win_streak: number;
  highest_pot: string;
  equipped_cue_id: string;
  equipped_cloth_id: string;
  email_verified: boolean;
  friend_code: string;
  settings: Json;
  password_hash: string | null;
}

export async function playerById(client: Db, id: string): Promise<PlayerRow> {
  const { rows } = await client.query<PlayerRow>('SELECT * FROM players WHERE id = $1', [id]);
  return rows[0];
}

export async function sessionBody(client: Db, player: PlayerRow): Promise<Json> {
  return {
    id: player.id,
    email: player.email,
    displayName: player.display_name,
    level: player.level,
    xp: player.xp,
    coins: await balance(client, player.id, 'coins'),
    cash: await balance(client, player.id, 'cash'),
    emailVerified: player.email_verified,
    minor: isMinor(player.birth_year),
  };
}

async function issueVerification(client: Db, playerId: string, email: string, origin: string): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await client.query('UPDATE players SET verify_token_hash = $1 WHERE id = $2', [sha256(token), playerId]);
  const link = `${origin}/verify?token=${token}`;
  return enqueueMail(client, playerId, 'verification', email, 'Verify your Long Rail email', `Welcome to Headstring.\n\nVerify your email:\n${link}\n`);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function validBirthYear(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1900 && (value as number) <= new Date().getUTCFullYear();
}

function signUpErrors(body: Json): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = text(body.displayName).trim();
  if (!EMAIL_PATTERN.test(text(body.email).trim())) errors.email = SENTENCES.email;
  if (text(body.password).length < 8 || text(body.password).length > 72) errors.password = SENTENCES.password;
  if (name.length < 2 || name.length > 20) errors.displayName = SENTENCES.displayName;
  if (!validBirthYear(body.birthYear)) errors.birthYear = SENTENCES.birthYear;
  return errors;
}

/**
 * Counts this attempt as a failure before the slow password check, in one statement, so simultaneous attempts cannot
 * all read a count under the limit. A correct password hands its count back; a window at zero counts as a fresh one.
 */
async function claimSignInAttempt(email: string): Promise<void> {
  const fresh = `signin_failures.failures = 0 OR signin_failures.window_started_at < now() - interval '${FAILED_SIGN_IN_WINDOW_S} seconds'`;
  const claimed = await query(
    `INSERT INTO signin_failures (email, window_started_at, failures) VALUES ($1, now(), 1)
     ON CONFLICT (email) DO UPDATE SET
       failures = CASE WHEN ${fresh} THEN 1 ELSE signin_failures.failures + 1 END,
       window_started_at = CASE WHEN ${fresh} THEN now() ELSE signin_failures.window_started_at END
     WHERE ${fresh} OR signin_failures.failures < $2
     RETURNING 1`,
    [email, FAILED_SIGN_IN_LIMIT],
  );
  if (claimed.length === 1) return;
  const rows = await query<{ wait: string }>(
    `SELECT ceil(extract(epoch FROM window_started_at + interval '${FAILED_SIGN_IN_WINDOW_S} seconds' - now())) AS wait FROM signin_failures WHERE email = $1`,
    [email],
  );
  const wait = Math.max(1, Number(rows[0]?.wait ?? 1));
  throw new ApiError(429, 'rate_limited', SENTENCES.rateLimited, undefined, { 'Retry-After': String(wait) });
}

export function registerAuthRoutes(): void {
  openRoute('POST', '/api/auth/signup', async ({ body, origin }): Promise<Reply> => {
    if (validBirthYear(body.birthYear) && ageOf(body.birthYear) < 13) throw new ApiError(403, 'under_age', SENTENCES.underAge);
    const email = text(body.email).trim().toLowerCase();
    const taken = await query('SELECT 1 FROM players WHERE email = $1', [email]);
    if (taken.length > 0) throw new ApiError(409, 'email_taken', SENTENCES.emailTaken);
    const errors = signUpErrors(body);
    if (Object.keys(errors).length > 0) throw validationFailed(errors);
    try {
      const { token, reply, mailId } = await transaction(async (client) => {
        const id = await insertPlayer(client, {
          email,
          password: text(body.password),
          displayName: text(body.displayName).trim(),
          birthYear: body.birthYear as number,
          level: 1,
          xp: 0,
          emailVerified: false,
        });
        await writePair(client, { from: SYSTEM, to: wallet(id), amount: SIGN_UP_GRANT, currency: 'coins', kind: 'grant', refId: id });
        const mail = await issueVerification(client, id, email, origin);
        const session = await createSession(client, id);
        return { token: session, reply: await sessionBody(client, await playerById(client, id)), mailId: mail };
      });
      void deliverNow(mailId).catch(() => undefined);
      return { status: 201, body: reply, headers: { 'Set-Cookie': sessionCookie(token) } };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError(409, 'email_taken', SENTENCES.emailTaken);
      throw error;
    }
  }, { body: true });

  openRoute('POST', '/api/auth/signin', async ({ body }): Promise<Reply> => {
    const email = text(body.email).trim().toLowerCase();
    await claimSignInAttempt(email);
    const players = await query<{ id: string; password_hash: string | null }>('SELECT id, password_hash FROM players WHERE email = $1', [email]);
    const hash = players[0]?.password_hash ?? null;
    if (!(await passwordMatches(text(body.password), hash))) {
      throw new ApiError(401, 'invalid_credentials', SENTENCES.badSignIn);
    }
    await query('UPDATE signin_failures SET failures = failures - 1 WHERE email = $1', [email]);
    const { token, reply } = await transaction(async (client) => ({
      token: await createSession(client, players[0].id),
      reply: await sessionBody(client, await playerById(client, players[0].id)),
    }));
    return { status: 200, body: reply, headers: { 'Set-Cookie': sessionCookie(token) } };
  }, { body: true });

  openRoute('POST', '/api/auth/signout', async ({ session }): Promise<Reply> => {
    if (session !== null) await query('DELETE FROM sessions WHERE id = $1', [session.id]);
    return { status: 204, headers: { 'Set-Cookie': clearedCookie() } };
  });

  route('POST', '/api/auth/resend-verification', async ({ session, origin }): Promise<Reply> => {
    const pending = await transaction(async (client) => {
      await lockPlayer(client, session.playerId);
      const player = await playerById(client, session.playerId);
      if (player.email_verified) throw new ApiError(409, 'already_verified', 'This email is already verified.');
      await client.query(`DELETE FROM mail_outbox WHERE player_id = $1 AND kind = 'verification' AND delivered_at IS NULL`, [player.id]);
      return issueVerification(client, player.id, player.email, origin);
    });
    if (!(await deliverNow(pending))) throw new ApiError(503, 'mail_unavailable', 'Could not send mail. Try again soon.');
    return { status: 202, body: { status: 'sent' } };
  });

  openRoute('POST', '/api/auth/verify', async ({ body }): Promise<Reply> => {
    const rows = await query<{ id: string }>(
      'UPDATE players SET email_verified = true, verify_token_hash = NULL WHERE verify_token_hash = $1 RETURNING id',
      [sha256(text(body.token))],
    );
    if (rows.length === 0) throw new ApiError(410, 'link_invalid', 'This link is no longer valid.');
    await query(`DELETE FROM mail_outbox WHERE player_id = $1 AND kind = 'verification' AND delivered_at IS NULL`, [rows[0].id]);
    notifyPlayer(rows[0].id);
    return { status: 200, body: { emailVerified: true } };
  }, { body: true });
}

