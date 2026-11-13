// Accounts: sign-up, confirmation links, sign-in with lockout, sessions, the trial view and Pro quotes.
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { COPY } from '../shared/copy.ts';
import type { MeResponse } from '../shared/types.ts';
import { cookieValue, requireUser, sha256, SESSION_COOKIE, SESSION_SECONDS, trialState } from './access.ts';
import { DEFAULT_ZONE, isStudioZone, studioDate, studioDateCompact, workspaceNow } from './clock.ts';
import { config } from './config.ts';
import { pool, query, transaction } from './db.ts';
import { createDrawing } from './drawing-store.ts';
import { studioPlanModel, wallDetailModel } from './engine/index.ts';
import { HttpError, registerRoute, validation } from './http.ts';
import { sendMail } from './smtp.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRO_PRICE = '12.00';
const ROOT_FOLDER = 'My Drawings';
const FIRST_REVISION_NOTE = 'Issued for coordination.';
const SAMPLE_FILES = ['Studio Plan Sample.dxf', 'Wall Detail Sample.dxf'] as const;

interface AccountRow {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  password_hash: string;
  time_zone: string;
  verified: boolean;
  confirmed_at: Date | null;
}

export const isEmail = (value: string): boolean => value.length <= 254 && EMAIL.test(value);

const token = (): string => randomBytes(32).toString('base64url');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, (error, derived) => (error ? reject(error) : resolve(derived))));
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split('$');
  if (!salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const derived = await new Promise<Buffer>((resolve, reject) =>
    scrypt(password, Buffer.from(salt, 'base64url'), expected.length, (error, result) => (error ? reject(error) : resolve(result))));
  return timingSafeEqual(derived, expected);
}

function sessionCookie(value: string, maxAge: number): string {
  const secure = config.publicUrl.startsWith('https:') ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export async function createSession(client: PoolClient | typeof pool, userId: string): Promise<string> {
  const value = token();
  await client.query('INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)', [sha256(value), userId, new Date()]);
  return value;
}

/** A workspace with its My Drawings root, title-block revision A and the two sample drawings. */
export async function createWorkspace(client: PoolClient, zone: string, at: Date): Promise<{ workspaceId: string; rootFolderId: string }> {
  const workspaceId = randomUUID();
  const rootFolderId = randomUUID();
  await client.query('INSERT INTO workspaces (id, time_zone, created_at) VALUES ($1, $2, $3)', [workspaceId, zone, at]);
  await client.query(
    'INSERT INTO folders (id, workspace_id, parent_id, name, name_key, created_at, modified_at) VALUES ($1, $2, NULL, $3, $4, $5, $5)',
    [rootFolderId, workspaceId, ROOT_FOLDER, ROOT_FOLDER.toLowerCase(), at],
  );
  await client.query(
    "INSERT INTO title_revisions (workspace_id, letter, footer_note, effective_date) VALUES ($1, 'A', $2, $3)",
    [workspaceId, FIRST_REVISION_NOTE, studioDate(at, zone)],
  );
  const [studioPlan, wallDetail] = SAMPLE_FILES;
  await createDrawing(client, { workspaceId, folderId: null, name: studioPlan, model: studioPlanModel('mm'), sample: true, at });
  await createDrawing(client, { workspaceId, folderId: null, name: wallDetail, model: wallDetailModel(), sample: true, at });
  return { workspaceId, rootFolderId };
}

/** Replaces every older confirmation link of the account with a fresh one and mails it. Resolves true when Mailpit accepted. */
async function sendConfirmation(user: Pick<AccountRow, 'id' | 'workspace_id' | 'name' | 'email'>): Promise<boolean> {
  const value = token();
  await transaction(async (client) => {
    await client.query('UPDATE verify_links SET replaced = true WHERE user_id = $1', [user.id]);
    await client.query('INSERT INTO verify_links (token, user_id, created_at) VALUES ($1, $2, $3)', [value, user.id, await workspaceNow(user.workspace_id, client)]);
  });
  return sendMail({
    to: user.email,
    subject: 'Confirm your Corbel Draft account',
    text: `Hello ${user.name},\n\nConfirm your email address to start your Corbel Draft trial:\n${config.publicUrl}/verify/${value}\n\nIf you did not create this account, ignore this message.\n`,
  });
}

function signupErrors(body: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 1 || [...name].length > 80) errors.name = COPY.nameRequired;
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!isEmail(email)) errors.email = COPY.emailInvalid;
  if (typeof body.password !== 'string' || [...body.password].length < 10) errors.password = COPY.passwordShort;
  if (body.time_zone !== undefined && body.time_zone !== null && !isStudioZone(body.time_zone)) errors.time_zone = COPY.timeZoneInvalid;
  return errors;
}

const accountByEmail = async (emailKey: string): Promise<AccountRow | undefined> =>
  (await query<AccountRow>('SELECT * FROM users WHERE email_key = $1', [emailKey]))[0];

/** The consecutive-failure count and lock for one address; unknown addresses are counted too. */
async function recordFailure(emailKey: string, now: Date): Promise<void> {
  await transaction(async (client) => {
    await client.query('INSERT INTO signin_attempts (email_key) VALUES ($1) ON CONFLICT DO NOTHING', [emailKey]);
    const { rows } = await client.query<{ failures: number }>(
      'SELECT failures FROM signin_attempts WHERE email_key = $1 FOR UPDATE', [emailKey]);
    const failures = (rows[0]?.failures ?? 0) + 1;
    if (failures >= config.signinMaxFailures) {
      await client.query('UPDATE signin_attempts SET failures = 0, locked_until = $2 WHERE email_key = $1',
        [emailKey, new Date(now.getTime() + config.signinLockSeconds * 1000)]);
    } else {
      await client.query('UPDATE signin_attempts SET failures = $2, locked_until = NULL WHERE email_key = $1', [emailKey, failures]);
    }
  });
}

const userView = (user: AccountRow): { id: string; name: string; email: string; time_zone: string; verified: boolean } =>
  ({ id: user.id, name: user.name, email: user.email, time_zone: user.time_zone, verified: user.verified });

export function registerAccountRoutes(): void {
  registerRoute('POST', '/api/auth/signup', async (ctx) => {
    const body = await ctx.json();
    const errors = signupErrors(body);
    const email = String(body.email ?? '').trim();
    if (!errors.email && await accountByEmail(email.toLowerCase())) errors.email = COPY.emailTaken;
    if (Object.keys(errors).length > 0) throw validation(errors);
    const zone = isStudioZone(body.time_zone) ? body.time_zone : DEFAULT_ZONE;
    const passwordHash = await hashPassword(String(body.password));
    const at = new Date();
    const userId = randomUUID();
    const name = String(body.name).trim();
    let workspaceId: string;
    try {
      workspaceId = await transaction(async (client) => {
        const workspace = await createWorkspace(client, zone, at);
        await client.query(
          `INSERT INTO users (id, workspace_id, name, email, email_key, password_hash, time_zone, verified, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)`,
          [userId, workspace.workspaceId, name, email, email.toLowerCase(), passwordHash, zone, at],
        );
        return workspace.workspaceId;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw validation({ email: COPY.emailTaken });
      throw error;
    }
    const sent = await sendConfirmation({ id: userId, workspace_id: workspaceId, name, email });
    return { status: 201, body: { user: { id: userId, name, email, verified: false }, email_status: sent ? 'sent' : 'not_sent' } };
  }, { anonymous: true });

  registerRoute('POST', '/api/auth/verify', async (ctx) => {
    const value = (await ctx.json()).token;
    const rows = typeof value === 'string'
      ? await query<{ replaced: boolean; link_created_at: Date } & AccountRow>(
        'SELECT l.replaced, l.created_at AS link_created_at, u.* FROM verify_links l JOIN users u ON u.id = l.user_id WHERE l.token = $1', [value])
      : [];
    const link = rows[0];
    if (!link) throw new HttpError(404, { error: 'not_found' });
    if (link.verified) return { status: 200, body: { verified: true, email: link.email } };
    if (link.replaced) throw new HttpError(410, { error: 'verify_link_replaced', email: link.email });
    const now = await workspaceNow(link.workspace_id);
    if (now.getTime() >= link.link_created_at.getTime() + config.verifyLinkSeconds * 1000) {
      throw new HttpError(410, { error: 'verify_link_expired', email: link.email });
    }
    await query('UPDATE users SET verified = true, confirmed_at = $2 WHERE id = $1', [link.id, now]);
    return { status: 200, body: { verified: true, email: link.email } };
  }, { anonymous: true });

  registerRoute('POST', '/api/auth/verify/resend', async (ctx) => {
    const body = await ctx.json();
    let user: AccountRow | undefined;
    if (typeof body.token === 'string') {
      user = (await query<AccountRow>('SELECT u.* FROM verify_links l JOIN users u ON u.id = l.user_id WHERE l.token = $1', [body.token]))[0];
    } else {
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      if (!isEmail(email)) throw validation({ email: COPY.emailInvalid });
      user = await accountByEmail(email.toLowerCase());
    }
    if (user && !user.verified && !await sendConfirmation(user)) throw new HttpError(503, { error: 'mail_unavailable' });
    return { status: 202, body: { email_status: 'sent' } };
  }, { anonymous: true });

  registerRoute('POST', '/api/auth/signin', async (ctx) => {
    const body = await ctx.json();
    const emailKey = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const user = emailKey ? await accountByEmail(emailKey) : undefined;
    const now = user ? await workspaceNow(user.workspace_id) : new Date();
    const [attempt] = await query<{ locked_until: Date | null }>('SELECT locked_until FROM signin_attempts WHERE email_key = $1', [emailKey]);
    if (attempt?.locked_until && attempt.locked_until > now) {
      throw new HttpError(429, { error: 'signin_locked', retry_after_seconds: Math.max(1, Math.ceil((attempt.locked_until.getTime() - now.getTime()) / 1000)) });
    }
    const password = typeof body.password === 'string' ? body.password : '';
    if (!user || !await passwordMatches(password, user.password_hash)) {
      if (emailKey) await recordFailure(emailKey, now);
      throw new HttpError(401, { error: 'invalid_credentials' });
    }
    if (!user.verified) throw new HttpError(403, { error: 'unverified', email: user.email });
    await query('DELETE FROM signin_attempts WHERE email_key = $1', [emailKey]);
    const session = await createSession(pool, user.id);
    return { status: 200, body: { user: userView(user) }, headers: { 'Set-Cookie': sessionCookie(session, SESSION_SECONDS) } };
  }, { anonymous: true });

  registerRoute('POST', '/api/auth/signout', async (ctx) => {
    const session = cookieValue(ctx.req, SESSION_COOKIE);
    if (session) await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(session)]);
    return { status: 204, headers: { 'Set-Cookie': sessionCookie('', 0) } };
  }, { anonymous: true });

  registerRoute('GET', '/api/me', async (ctx) => {
    const user = requireUser(ctx);
    const now = await workspaceNow(user.workspace_id);
    const me: MeResponse = {
      user: { id: user.id, name: user.name, email: user.email, time_zone: user.time_zone, verified: user.verified },
      trial: trialState(user.confirmed_at, user.time_zone, now),
      now: now.toISOString(),
    };
    return { status: 200, body: me };
  });

  registerRoute('POST', '/api/quotes', async (ctx) => {
    const user = requireUser(ctx);
    const quote = await transaction(async (client) => {
      await client.query('SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE', [user.workspace_id]);
      const now = await workspaceNow(user.workspace_id, client);
      const day = studioDateCompact(now, user.time_zone);
      const { rows } = await client.query<{ next: number }>(
        'SELECT coalesce(max(sequence), 0) + 1 AS next FROM quotes WHERE workspace_id = $1 AND day = $2', [user.workspace_id, day]);
      const sequence = rows[0]?.next ?? 1;
      const number = `Q-${day}-${String(sequence).padStart(4, '0')}`;
      const accepted = await sendMail({
        to: user.email,
        subject: 'Your Corbel Draft Pro quote',
        text: `Corbel Draft Pro: $${PRO_PRICE} per month.\n\nQuote number: ${number}\nDate: ${studioDate(now, user.time_zone)}\n\nThere is nothing to pay here; this quote is for your records.\n`,
      });
      if (!accepted) throw new HttpError(503, { error: 'mail_unavailable' });
      await client.query(
        'INSERT INTO quotes (workspace_id, day, sequence, number, sent_to, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [user.workspace_id, day, sequence, number, user.email, now],
      );
      return number;
    });
    return { status: 201, body: { quote: { number: quote, amount: PRO_PRICE, currency: 'USD', sent_to: user.email } } };
  });
}
