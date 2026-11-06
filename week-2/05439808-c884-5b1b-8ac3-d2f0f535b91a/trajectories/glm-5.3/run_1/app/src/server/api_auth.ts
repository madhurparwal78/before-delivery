// Accounts and sessions: sign-up, confirmation links, sign-in and out, password reset, profile.
import argon2 from 'argon2';
import type { PoolClient } from 'pg';
import { errors } from './errors.ts';
import { route } from './http.ts';
import { getApp, withTransaction } from './runtime.ts';
import {
  accountJson, createSession, endAllSessionsOfAccount, loadAccount, newToken, requireAccount, sessionCookie,
} from './sessions.ts';
import { checkThrottle } from './throttle.ts';
import { enqueueMail } from './mail.ts';
import { createStarterVillage } from './island.ts';
import {
  exactFields, optionalString, requireObject, requiredString, throwIfErrors, validateDisplayName, validateEmail, validatePassword, validateTimeZone,
} from './validate.ts';

const ARGON2 = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

interface AccountWithEmailRow {
  id: number;
  email: string;
  display_name: string;
  time_zone: string;
  verified: boolean;
  role: 'islander' | 'operator';
  village_id: number | null;
  clan_id: number | null;
  trophies: number;
  password_hash: string;
}

const ACCOUNT_SELECT = `SELECT a.id, a.email, a.display_name, a.time_zone, a.verified, a.role, v.id AS village_id,
  m.clan_id, v.trophies, a.password_hash
  FROM accounts a
  LEFT JOIN villages v ON v.account_id = a.id
  LEFT JOIN clan_members m ON m.account_id = a.id`;

async function lockAccount(client: PoolClient, accountId: number): Promise<void> {
  await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
}

// Issues one live link of a kind: every earlier unused link of the same kind is superseded in the
// same transaction that holds the lock on the account, so only the latest issue works.
async function issueToken(client: PoolClient, accountId: number, kind: 'verify' | 'reset', lifetimeSeconds: number, now: number): Promise<string> {
  await client.query(
    'UPDATE tokens SET superseded_at = $3 WHERE account_id = $1 AND kind = $2 AND used_at IS NULL AND superseded_at IS NULL',
    [accountId, kind, now]
  );
  const token = newToken();
  await client.query('INSERT INTO tokens (account_id, kind, token, issued_at, expires_at) VALUES ($1, $2, $3, $4, $5)', [
    accountId, kind, token, now, now + lifetimeSeconds * 1000,
  ]);
  return token;
}

async function findAccountByEmail(client: PoolClient, email: string): Promise<AccountWithEmailRow | null> {
  const result = await client.query(`${ACCOUNT_SELECT} WHERE a.email_lc = $1`, [email.toLowerCase()]);
  return result.rows[0] ? mapAccountRow(result.rows[0]) : null;
}

function mapAccountRow(row: Record<string, unknown>): AccountWithEmailRow {
  return {
    id: Number(row.id),
    email: row.email as string,
    display_name: row.display_name as string,
    time_zone: row.time_zone as string,
    verified: row.verified as boolean,
    role: row.role as 'islander' | 'operator',
    village_id: row.village_id === null || row.village_id === undefined ? null : Number(row.village_id),
    clan_id: row.clan_id === null || row.clan_id === undefined ? null : Number(row.clan_id),
    trophies: row.trophies === null || row.trophies === undefined ? 0 : Number(row.trophies),
    password_hash: row.password_hash as string,
  };
}

function accountOf(row: AccountWithEmailRow) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    timeZone: row.time_zone,
    verified: row.verified,
    role: row.role,
    villageId: row.village_id,
    clanId: row.clan_id,
    trophies: row.trophies,
  };
}

function confirmationMailBody(account: { verified: boolean }, token: string, publicUrl: string): string {
  if (account.verified) {
    return `This address already has a Saltreach account.\n\nSign in: ${publicUrl}/signin\nForgot your password? ${publicUrl}/forgot`;
  }
  return `Welcome to the salt flats.\n\nConfirm your email by following this link:\n${publicUrl}/verify?token=${token}`;
}

route('GET', '/api/health', 'public', async () => ({ status: 200, body: { status: 'ok' } }));

route('GET', '/api/status', 'public', async () => {
  const app = getApp();
  return { status: 200, body: { database: app.dbUp ? 'up' : 'down', mail: app.mailUp ? 'up' : 'down' } };
});

route('GET', '/api/session', 'public', async (ctx) => {
  let session = ctx.session;
  let created = false;
  if (!session) {
    session = await withTransaction((client) => createSession(client, null, ctx.now));
    created = true;
  }
  let user = null;
  if (session.accountId !== null) {
    user = accountJson(await requireAccount(session));
  }
  return {
    status: 200,
    body: { user, csrfToken: session.csrfToken },
    headers: created ? { 'Set-Cookie': sessionCookie(session.token) } : undefined,
  };
});

route('POST', '/api/auth/signup', 'public', async (ctx) => {
  const app = getApp();
  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['email', 'password', 'displayName', 'timeZone']);
  const email = requiredString(body, fieldErrors, 'email');
  const password = requiredString(body, fieldErrors, 'password');
  const displayName = requiredString(body, fieldErrors, 'displayName');
  const timeZone = requiredString(body, fieldErrors, 'timeZone');
  const emailError = fieldErrors.email ? undefined : validateEmail(email);
  if (emailError) fieldErrors.email = emailError;
  const passwordError = fieldErrors.password ? undefined : validatePassword(password);
  if (passwordError) fieldErrors.password = passwordError;
  const nameError = fieldErrors.displayName ? undefined : validateDisplayName(displayName);
  if (nameError) fieldErrors.displayName = nameError;
  const zoneError = fieldErrors.timeZone ? undefined : validateTimeZone(timeZone);
  if (zoneError) fieldErrors.timeZone = zoneError;
  throwIfErrors(fieldErrors);

  const now = ctx.now;
  await withTransaction(async (client) => {
    const existing = await findAccountByEmail(client, email);
    if (existing) {
      await lockAccount(client, existing.id);
      const token = await issueToken(client, existing.id, 'verify', app.env.verifyTokenSeconds, now);
      await enqueueMail(client, { to: email, subject: 'Confirm your Saltreach email', body: confirmationMailBody(existing, token, app.env.appPublicUrl) }, now);
      return;
    }
    const hash = await argon2.hash(password, ARGON2);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO accounts (email, email_lc, password_hash, display_name, time_zone, verified, role, created_at)
       VALUES ($1, $2, $3, $4, $5, FALSE, 'islander', $6) RETURNING id`,
      [email, email.toLowerCase(), hash, displayName, timeZone, now]
    );
    const accountId = Number(inserted.rows[0].id);
    await createStarterVillage(client, accountId, now);
    const token = await issueToken(client, accountId, 'verify', app.env.verifyTokenSeconds, now);
    await enqueueMail(client, { to: email, subject: 'Confirm your Saltreach email', body: confirmationMailBody({ verified: false }, token, app.env.appPublicUrl) }, now);
  });
  return { status: 202, body: { status: 'check_email' } };
});

route('POST', '/api/auth/verify', 'public', async (ctx) => {
  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['token']);
  const token = requiredString(body, fieldErrors, 'token');
  throwIfErrors(fieldErrors);

  await withTransaction(async (client) => {
    const result = await client.query('SELECT id, account_id, expires_at, used_at, superseded_at FROM tokens WHERE token = $1 AND kind = $2', [token, 'verify']);
    const row = result.rows[0];
    if (!row || row.used_at !== null || row.superseded_at !== null || ctx.now >= Number(row.expires_at)) throw errors.invalidToken();
    await lockAccount(client, Number(row.account_id));
    await client.query('UPDATE tokens SET used_at = $2 WHERE id = $1', [Number(row.id), ctx.now]);
    await client.query('UPDATE accounts SET verified = TRUE WHERE id = $1', [Number(row.account_id)]);
  });
  return { status: 200, body: { status: 'verified' } };
});

route('POST', '/api/auth/resend-verification', 'public', async (ctx) => {
  const app = getApp();
  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['email']);
  const email = requiredString(body, fieldErrors, 'email');
  const emailError = fieldErrors.email ? undefined : validateEmail(email);
  if (emailError) fieldErrors.email = emailError;
  throwIfErrors(fieldErrors);

  await checkThrottle(`resend:${email.toLowerCase()}`, 3, 60000, ctx.now);
  const now = ctx.now;
  await withTransaction(async (client) => {
    const account = await findAccountByEmail(client, email);
    if (!account) {
      await enqueueMail(client, {
        to: email,
        subject: 'Confirm your Saltreach email',
        body: `No Saltreach account uses this address yet.\n\nCreate one: ${app.env.appPublicUrl}/signup`,
      }, now);
      return;
    }
    await lockAccount(client, account.id);
    const token = await issueToken(client, account.id, 'verify', app.env.verifyTokenSeconds, now);
    await enqueueMail(client, { to: email, subject: 'Confirm your Saltreach email', body: confirmationMailBody(account, token, app.env.appPublicUrl) }, now);
  });
  return { status: 202, body: { status: 'check_email' } };
});

route('POST', '/api/auth/signin', 'public', async (ctx) => {
  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['email', 'password']);
  const email = requiredString(body, fieldErrors, 'email');
  const password = requiredString(body, fieldErrors, 'password');
  const emailError = fieldErrors.email ? undefined : validateEmail(email);
  if (emailError) fieldErrors.email = emailError;
  throwIfErrors(fieldErrors);

  await checkThrottle(`signin:${email.toLowerCase()}`, 5, 60000, ctx.now);

  const account = await withTransaction((client) => findAccountByEmail(client, email));
  const hash = account?.password_hash ?? '$argon2id$v=19$m=65536,t=3,p=1$invalid$invalid';
  const ok = account ? await argon2.verify(hash, password).catch(() => false) : false;
  if (!account || !ok) throw errors.invalidCredentials();
  const session = await withTransaction((client) => createSession(client, account.id, ctx.now));
  return {
    status: 200,
    body: { user: accountJson(accountOf(account)), csrfToken: session.csrfToken },
    headers: { 'Set-Cookie': sessionCookie(session.token) },
  };
});

route('POST', '/api/auth/signout', 'session', async (ctx) => {
  // signing out ends the account's sessions, so other open tabs of the same account follow
  await withTransaction((client) => endAllSessionsOfAccount(client, ctx.account!.id, ctx.now));
  return { headers: { 'Set-Cookie': 'saltreach_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' } };
});

route('POST', '/api/auth/forgot', 'public', async (ctx) => {
  const app = getApp();
  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['email']);
  const email = requiredString(body, fieldErrors, 'email');
  const emailError = fieldErrors.email ? undefined : validateEmail(email);
  if (emailError) fieldErrors.email = emailError;
  throwIfErrors(fieldErrors);

  await checkThrottle(`forgot:${email.toLowerCase()}`, 3, 60000, ctx.now);
  const now = ctx.now;
  await withTransaction(async (client) => {
    const account = await findAccountByEmail(client, email);
    if (!account) {
      await enqueueMail(client, {
        to: email,
        subject: 'Reset your Saltreach password',
        body: `No Saltreach account uses this address yet.\n\nCreate one: ${app.env.appPublicUrl}/signup`,
      }, now);
      return;
    }
    await lockAccount(client, account.id);
    const token = await issueToken(client, account.id, 'reset', app.env.resetTokenSeconds, now);
    await enqueueMail(client, {
      to: email,
      subject: 'Reset your Saltreach password',
      body: `Follow this link to choose a new password:\n${app.env.appPublicUrl}/reset?token=${token}`,
    }, now);
  });
  return { status: 202, body: { status: 'check_email' } };
});

route('POST', '/api/auth/reset', 'public', async (ctx) => {
  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['token', 'password']);
  const token = requiredString(body, fieldErrors, 'token');
  const password = requiredString(body, fieldErrors, 'password');
  const passwordError = fieldErrors.password ? undefined : validatePassword(password);
  if (passwordError) fieldErrors.password = passwordError;
  throwIfErrors(fieldErrors);

  const hash = await argon2.hash(password, ARGON2);
  await withTransaction(async (client) => {
    const result = await client.query('SELECT id, account_id, expires_at, used_at, superseded_at FROM tokens WHERE token = $1 AND kind = $2', [token, 'reset']);
    const row = result.rows[0];
    if (!row || row.used_at !== null || row.superseded_at !== null || ctx.now >= Number(row.expires_at)) throw errors.invalidToken();
    await lockAccount(client, Number(row.account_id));
    await client.query('UPDATE tokens SET used_at = $2 WHERE id = $1', [Number(row.id), ctx.now]);
    await client.query('UPDATE accounts SET password_hash = $2, verified = TRUE WHERE id = $1', [Number(row.account_id), hash]);
    await endAllSessionsOfAccount(client, Number(row.account_id), ctx.now);
  });
  return { status: 200, body: { status: 'password_reset' } };
});

route('GET', '/api/me', 'session', async (ctx) => {
  return { status: 200, body: accountJson(ctx.account!) };
});

route('PATCH', '/api/me', 'session', async (ctx) => {
  const body = requireObject(ctx.body);
  const fieldErrors = exactFields(body, ['displayName', 'timeZone']);
  const displayName = optionalString(body, 'displayName');
  const timeZone = optionalString(body, 'timeZone');
  if (displayName !== undefined) {
    const err = validateDisplayName(displayName);
    if (err) fieldErrors.displayName = err;
  }
  if (timeZone !== undefined) {
    const err = validateTimeZone(timeZone);
    if (err) fieldErrors.timeZone = err;
  }
  throwIfErrors(fieldErrors);

  const accountId = ctx.account!.id;
  await withTransaction(async (client) => {
    await lockAccount(client, accountId);
    if (displayName !== undefined) await client.query('UPDATE accounts SET display_name = $2 WHERE id = $1', [accountId, displayName]);
    if (timeZone !== undefined) await client.query('UPDATE accounts SET time_zone = $2 WHERE id = $1', [accountId, timeZone]);
  });
  const account = await loadAccount(accountId);
  return { status: 200, body: accountJson(account!) };
});

route('GET', '/api/catalog', 'public', async () => {
  const app = getApp();
  const { BUILDINGS, UNITS, BUILDING_ORDER } = await import('../domain/catalog.ts');
  const applied = (seconds: number) => Math.max(1, Math.ceil(seconds / app.env.buildTimeDivisor));
  const buildings = BUILDING_ORDER.map((key) => {
    const b = BUILDINGS[key];
    return {
      type: key,
      name: b.name,
      width: b.width,
      depth: b.depth,
      maxCount: b.maxCount,
      levels: b.levels.map((level, i) => ({
        level: i + 1,
        cost: i === 2 ? { ...level.cost, copper: level.cost.copper + 200 } : level.cost,
        buildSeconds: applied(level.buildSeconds),
        hp: level.hp,
      })),
    };
  });
  const units = (['saltjack', 'peat_slinger'] as const).map((key) => {
    const u = UNITS[key];
    return {
      key,
      name: u.name,
      housing: u.housing,
      cost: u.cost,
      trainSeconds: applied(u.trainSeconds),
      hp: u.hp,
      damage: u.damage,
      attacksEvery: u.intervalTicks,
      rangeCells: u.rangeThousandths / 1000,
      speedCellsPerTick: u.speedThousandths / 1000,
    };
  });
  return { status: 200, body: { buildings, units } };
});
