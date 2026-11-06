// Accounts, sessions, email links and the starter island.
import { randomBytes } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';
import type { BuildingType, League, Rotation } from '../shared/catalog';
import { now } from './clock';
import { config } from './config';
import { tx, type Db } from './db';
import { fail } from './errors';
import { publicRoute, randomToken, sessionCookie, sessionRoute, sha256, type Account } from './http';
import { writePair } from './island';
import { MAIL, queueMail } from './mail';
import { emailKey, FORGOT_LIMIT, RESEND_LIMIT, SIGNIN_LIMIT } from './throttle';
import { Fields, isDisplayName, isEmail, isPassword, isString, MESSAGES } from './validate';
import { knownZone } from './zones';

export async function hashPassword(password: string): Promise<string> {
  return argon2id({ password, salt: randomBytes(16), parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32, outputType: 'encoded' });
}

const DUMMY_HASH = hashPassword(randomToken());

export function leagueFor(trophies: number): League {
  if (trophies >= 1200) return 'Tidewall';
  if (trophies >= 800) return 'Saltmarsh';
  if (trophies >= 400) return 'Shingle';
  return 'Mudflat';
}

const STARTER_BUILDINGS: readonly { type: BuildingType; x: number; y: number; rotation: Rotation }[] = [
  { type: 'tide_barracks', x: 12, y: 18, rotation: 0 },
  { type: 'driftwood_camp', x: 25, y: 18, rotation: 0 },
  { type: 'brine_pan', x: 12, y: 24, rotation: 0 },
  { type: 'peat_cutter', x: 26, y: 24, rotation: 0 },
  { type: 'kiln_tower', x: 18, y: 26, rotation: 0 },
];
const STARTER_BALANCES = { brine: 1500, peat: 1500, copper: 100, saltjack: 10 } as const;

export async function createStarterIsland(db: Db, accountId: number, at: number): Promise<number> {
  const { rows } = await db.query<{ id: number }>('INSERT INTO villages (account_id, created_at) VALUES ($1, $2) RETURNING id', [accountId, at]);
  const villageId = (rows[0] as { id: number }).id;
  for (const b of STARTER_BUILDINGS) {
    await db.query(
      'INSERT INTO buildings (village_id, type, x, y, rotation, level, accrual_start, created_at) VALUES ($1, $2, $3, $4, $5, 1, $6, $6)',
      [villageId, b.type, b.x, b.y, b.rotation, at],
    );
  }
  for (const [asset, amount] of Object.entries(STARTER_BALANCES) as [keyof typeof STARTER_BALANCES, number][]) {
    await writePair(db, { kind: 'starter', asset, amount, from: null, to: villageId, at });
  }
  return villageId;
}

interface AccountRow {
  id: number;
  email: string;
  email_lower: string;
  password_hash: string;
  display_name: string;
  time_zone: string;
  verified: boolean;
  role: Account['role'];
  trophies: number;
  created_at: number;
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id, email: row.email, displayName: row.display_name, timeZone: row.time_zone, verified: row.verified,
    role: row.role, trophies: row.trophies, createdAt: row.created_at,
  };
}

export async function createAccount(
  db: Db,
  input: { email: string; passwordHash: string; displayName: string; timeZone: string; verified: boolean; role: Account['role']; trophies: number; at: number },
): Promise<number | null> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO accounts (email, email_lower, password_hash, display_name, time_zone, verified, role, trophies, created_at)
     VALUES ($1, lower($1), $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (email_lower) DO NOTHING RETURNING id`,
    [input.email, input.passwordHash, input.displayName, input.timeZone, input.verified, input.role, input.trophies, input.at],
  );
  return rows[0]?.id ?? null;
}

async function lockAccountByEmail(db: Db, email: string): Promise<AccountRow | null> {
  const { rows } = await db.query<AccountRow>('SELECT * FROM accounts WHERE email_lower = lower($1) FOR UPDATE', [email]);
  return rows[0] ?? null;
}

/** Issues a link and supersedes every earlier unused link of that kind, under the account lock. */
async function issueLink(db: Db, accountId: number, kind: 'confirm' | 'reset'): Promise<string> {
  await db.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
  const at = now();
  await db.query(
    'UPDATE email_links SET superseded_at = $3 WHERE account_id = $1 AND kind = $2 AND used_at IS NULL AND superseded_at IS NULL',
    [accountId, kind, at],
  );
  const token = randomToken(32);
  await db.query('INSERT INTO email_links (account_id, kind, token_hash, issued_at) VALUES ($1, $2, $3, $4)', [accountId, kind, sha256(token), at]);
  return token;
}

/** Locks and returns the live link behind a token, or answers invalid_token. */
async function liveLink(db: Db, token: string, kind: 'confirm' | 'reset', lifetimeMs: number): Promise<{ id: number; account_id: number }> {
  const { rows } = await db.query<{ id: number; account_id: number; issued_at: number; used_at: number | null; superseded_at: number | null; kind: string }>(
    'SELECT id, account_id, issued_at, used_at, superseded_at, kind FROM email_links WHERE token_hash = $1 FOR UPDATE',
    [sha256(token)],
  );
  const link = rows[0];
  if (!link || link.kind !== kind || link.used_at !== null || link.superseded_at !== null || now() >= link.issued_at + lifetimeMs) {
    return fail('invalid_token');
  }
  return link;
}

export async function meView(db: Db, account: Account): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ village_id: number | null; clan_id: number | null; trophies: number }>(
    `SELECT (SELECT id FROM villages WHERE account_id = a.id) AS village_id,
            (SELECT clan_id FROM clan_members WHERE account_id = a.id) AS clan_id, a.trophies
       FROM accounts a WHERE a.id = $1`,
    [account.id],
  );
  const row = rows[0] as { village_id: number | null; clan_id: number | null; trophies: number };
  const trophies = account.role === 'operator' ? 0 : row.trophies;
  return {
    id: account.id, email: account.email, displayName: account.displayName, timeZone: account.timeZone,
    verified: account.verified, role: account.role, villageId: row.village_id, trophies, league: leagueFor(trophies), clanId: row.clan_id,
  };
}

async function newSession(db: Db, accountId: number | null): Promise<{ token: string; csrf: string }> {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const at = now();
  await db.query(
    'INSERT INTO sessions (token_hash, csrf_token, account_id, created_at, signed_in_at) VALUES ($1, $2, $3, $4, $5)',
    [sha256(token), csrf, accountId, at, accountId === null ? null : at],
  );
  return { token, csrf };
}

const check_email = { status: 202, body: { status: 'check_email' } };

publicRoute('GET', '/api/session', async (ctx) => {
  if (ctx.session) {
    const user = ctx.session.account ? await tx((db) => meView(db, ctx.session?.account as Account)) : null;
    return { status: 200, body: { user, csrfToken: ctx.session.csrf } };
  }
  const fresh = await tx((db) => newSession(db, null));
  ctx.cookies.push(sessionCookie(fresh.token));
  return { status: 200, body: { user: null, csrfToken: fresh.csrf } };
});

publicRoute('POST', '/api/auth/signup', async (ctx) => {
  const f = new Fields(ctx.body, ['email', 'password', 'displayName', 'timeZone']);
  const email = f.take('email', isEmail, MESSAGES.email);
  const password = f.take('password', isPassword, MESSAGES.password);
  const displayName = f.take('displayName', isDisplayName, MESSAGES.displayName);
  const timeZone = f.take('timeZone', (v): v is string => isString(v) && knownZone(v), MESSAGES.timeZone);
  f.done();
  const passwordHash = await hashPassword(password as string);
  await tx(async (db) => {
    const at = now();
    let account = await lockAccountByEmail(db, email as string);
    if (account === null) {
      const id = await createAccount(db, {
        email: email as string, passwordHash, displayName: displayName as string, timeZone: timeZone as string,
        verified: false, role: 'islander', trophies: 0, at,
      });
      if (id !== null) await createStarterIsland(db, id, at);
      account = await lockAccountByEmail(db, email as string);
    }
    const target = account as AccountRow;
    const body = target.verified ? MAIL.alreadyVerified() : MAIL.confirmLink(await issueLink(db, target.id, 'confirm'));
    await queueMail(db, email as string, MAIL.confirmSubject, body);
  });
  return check_email;
});

publicRoute('POST', '/api/auth/verify', async (ctx) => {
  const f = new Fields(ctx.body, ['token']);
  const token = f.take('token', (v): v is string => isString(v) && v.length > 0, MESSAGES.token);
  f.done();
  await tx(async (db) => {
    const link = await liveLink(db, token as string, 'confirm', config.verifyTokenMs);
    await db.query('UPDATE email_links SET used_at = $2 WHERE id = $1', [link.id, now()]);
    await db.query('UPDATE accounts SET verified = true WHERE id = $1', [link.account_id]);
  });
  return { status: 200, body: { status: 'verified' } };
});

publicRoute('POST', '/api/auth/resend-verification', async (ctx) => {
  const f = new Fields(ctx.body, ['email']);
  const email = f.take('email', isEmail, MESSAGES.email) as string;
  f.done();
  await tx(async (db) => {
    const account = await lockAccountByEmail(db, email);
    const body = account === null
      ? MAIL.noAccountForResend()
      : account.verified ? MAIL.alreadyVerified() : MAIL.confirmLink(await issueLink(db, account.id, 'confirm'));
    await queueMail(db, email, MAIL.confirmSubject, body);
  });
  return check_email;
}, { throttle: (ctx) => withKey(emailKey('resend', ctx.body), RESEND_LIMIT) });

publicRoute('POST', '/api/auth/signin', async (ctx) => {
  const f = new Fields(ctx.body, ['email', 'password']);
  const email = f.take('email', isEmail, MESSAGES.email) as string;
  const password = f.take('password', isString, MESSAGES.password) as string;
  f.done();
  const row = await tx((db) => db.query<AccountRow>('SELECT * FROM accounts WHERE email_lower = lower($1)', [email])).then((r) => r.rows[0] ?? null);
  const matches = await argon2Verify({ password, hash: row?.password_hash ?? (await DUMMY_HASH) });
  if (row === null || !matches) fail('invalid_credentials');
  const account = toAccount(row as AccountRow);
  const result = await tx(async (db) => {
    if (ctx.session) await db.query('UPDATE sessions SET ended_at = $2 WHERE id = $1 AND ended_at IS NULL', [ctx.session.id, now()]);
    const session = await newSession(db, account.id);
    return { session, user: await meView(db, account) };
  });
  ctx.cookies.push(sessionCookie(result.session.token));
  return { status: 200, body: { user: result.user, csrfToken: result.session.csrf } };
}, { throttle: (ctx) => withKey(emailKey('signin', ctx.body), SIGNIN_LIMIT) });

sessionRoute('POST', '/api/auth/signout', async (ctx) => {
  new Fields(ctx.body, []).done();
  await tx((db) => db.query('UPDATE sessions SET ended_at = $2 WHERE id = $1', [ctx.session.id, now()]));
  return { status: 204 };
});

publicRoute('POST', '/api/auth/forgot', async (ctx) => {
  const f = new Fields(ctx.body, ['email']);
  const email = f.take('email', isEmail, MESSAGES.email) as string;
  f.done();
  await tx(async (db) => {
    const account = await lockAccountByEmail(db, email);
    const body = account === null ? MAIL.noAccountForReset() : MAIL.resetLink(await issueLink(db, account.id, 'reset'));
    await queueMail(db, email, MAIL.resetSubject, body);
  });
  return check_email;
}, { throttle: (ctx) => withKey(emailKey('forgot', ctx.body), FORGOT_LIMIT) });

publicRoute('POST', '/api/auth/reset', async (ctx) => {
  const f = new Fields(ctx.body, ['token', 'password']);
  const token = f.take('token', (v): v is string => isString(v) && v.length > 0, MESSAGES.token);
  const password = f.take('password', isPassword, MESSAGES.password);
  f.done();
  const passwordHash = await hashPassword(password as string);
  await tx(async (db) => {
    const link = await liveLink(db, token as string, 'reset', config.resetTokenMs);
    const at = now();
    await db.query('UPDATE email_links SET used_at = $2 WHERE id = $1', [link.id, at]);
    await db.query('UPDATE accounts SET password_hash = $2, verified = true WHERE id = $1', [link.account_id, passwordHash]);
    await db.query('UPDATE sessions SET ended_at = $2 WHERE account_id = $1 AND ended_at IS NULL', [link.account_id, at]);
  });
  return { status: 200, body: { status: 'password_reset' } };
});

sessionRoute('GET', '/api/me', async (ctx) => ({ status: 200, body: await tx((db) => meView(db, ctx.account)) }));

sessionRoute('PATCH', '/api/me', async (ctx) => {
  const f = new Fields(ctx.body, ['displayName', 'timeZone']);
  const displayName = f.optional('displayName', isDisplayName, MESSAGES.displayName);
  const timeZone = f.optional('timeZone', (v): v is string => isString(v) && knownZone(v), MESSAGES.timeZone);
  f.done();
  const body = await tx(async (db) => {
    const { rows } = await db.query<AccountRow>(
      'UPDATE accounts SET display_name = COALESCE($2, display_name), time_zone = COALESCE($3, time_zone) WHERE id = $1 RETURNING *',
      [ctx.account.id, displayName ?? null, timeZone ?? null],
    );
    return meView(db, toAccount(rows[0] as AccountRow));
  });
  return { status: 200, body };
});

function withKey(key: string | null, rule: { limit: number; windowMs: number }): { key: string; limit: number; windowMs: number } | null {
  return key === null ? null : { key, ...rule };
}

export const SEED_ACCOUNTS = [
  { displayName: 'Studio Ops', email: 'ops@lowtide.test', password: 'Tideline-Operator-27', role: 'operator', timeZone: 'UTC', trophies: 0 },
  { displayName: 'Ivo Brack', email: 'ivo@lowtide.test', password: 'Saltpan-Ivo-27', role: 'islander', timeZone: 'America/Chicago', trophies: 120 },
  { displayName: 'Marrow Quay', email: 'marrow@lowtide.test', password: 'Saltpan-Marrow-27', role: 'islander', timeZone: 'Europe/Lisbon', trophies: 240 },
  { displayName: 'Pell Saunder', email: 'pell@lowtide.test', password: 'Saltpan-Pell-27', role: 'islander', timeZone: 'Australia/Hobart', trophies: 610 },
  { displayName: 'Wren Sallow', email: 'wren@lowtide.test', password: 'Saltpan-Wren-27', role: 'islander', timeZone: 'Europe/Dublin', trophies: 396 },
  { displayName: 'Tamsin Rook', email: 'tamsin@lowtide.test', password: 'Saltpan-Tamsin-27', role: 'islander', timeZone: 'Asia/Kolkata', trophies: 401 },
] as const;

