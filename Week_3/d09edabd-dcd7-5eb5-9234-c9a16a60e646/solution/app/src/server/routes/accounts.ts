import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Queryable } from '../db.js';
import { db } from '../db.js';
import { fail } from '../errors.js';
import { clearedCookie, empty, json, loginIdOf, newLoginId, route, sessionCookie, useCookieSecret } from '../http.js';
import { insertRoom } from '../domain/seed.js';
import { CLOCKTOWER_DRAFT, STARTER_ROOMS } from '../../shared/starters.js';
import { EMAIL } from '../validate.js';
import type { Role, User } from '../../shared/types.js';

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('base64')}.${(await scrypt(password, salt, 32)).toString('base64')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split('.');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  return timingSafeEqual(expected, await scrypt(password, Buffer.from(salt, 'base64'), expected.length));
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  password_hash: string;
  workspace_id: string;
  workspace_name: string;
}

const toUser = (row: Pick<UserRow, 'id' | 'email' | 'display_name' | 'role'>): User => ({ id: row.id, email: row.email, displayName: row.display_name, role: row.role });

/** Reads the cookie signing secret, generating it on the first start of any instance. */
export async function loadCookieSecret(): Promise<void> {
  await db.query(`INSERT INTO settings (key, value) VALUES ('cookie_secret', $1) ON CONFLICT (key) DO NOTHING`, [randomBytes(32).toString('base64')]);
  const found = await db.query<{ value: string }>(`SELECT value FROM settings WHERE key = 'cookie_secret'`);
  useCookieSecret(found.rows[0]!.value);
}

async function addUser(client: Queryable, workspaceId: string, person: { email: string; password: string; displayName: string; role: Role }, id = randomUUID()): Promise<void> {
  await client.query(
    `INSERT INTO users (id, workspace_id, email, password_hash, display_name, role) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [id, workspaceId, person.email, await hashPassword(person.password), person.displayName, person.role],
  );
}

const SEED_LOCK = 481517;
const LANTERN_LANE = '6f0f7b2e-0001-4c1a-9a00-00000000a001';
const BRASS_KEY = '6f0f7b2e-0001-4c1a-9a00-00000000a002';

/** The seeded workspaces, applied idempotently (safe when several instances start at once). */
export async function seedWorkspaces(): Promise<void> {
  await db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK]);
    const existing = await client.query(`SELECT 1 FROM workspaces WHERE id = $1`, [LANTERN_LANE]);
    if (existing.rows.length > 0) return;
    await client.query(`INSERT INTO workspaces (id, name) VALUES ($1,'Lantern Lane Escapes'), ($2,'Brass Key Rooms')`, [LANTERN_LANE, BRASS_KEY]);
    await addUser(client, LANTERN_LANE, { email: 'mara@lanternlane.test', password: 'keyway-owner-1', displayName: 'Mara Quint', role: 'owner' });
    await addUser(client, LANTERN_LANE, { email: 'tobi@lanternlane.test', password: 'keyway-codesign-1', displayName: 'Tobi Ferreira', role: 'co_designer' });
    await addUser(client, BRASS_KEY, { email: 'ines@brasskey.test', password: 'keyway-other-1', displayName: 'Ines Albright', role: 'owner' });
    for (const room of STARTER_ROOMS) await insertRoom(client, LANTERN_LANE, room);
    await insertRoom(client, BRASS_KEY, CLOCKTOWER_DRAFT);
  });
}

async function startLogin(userId: string): Promise<string> {
  const id = newLoginId();
  await db.query(`INSERT INTO logins (id, user_id) VALUES ($1,$2)`, [id, userId]);
  return sessionCookie(id);
}

export function accountRoutes(): void {
  route('POST', '/api/auth/signup', {
    auth: 'none',
    conflict: async (ctx) => {
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      if (typeof email !== 'string') return;
      const taken = await ctx.db.query(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [email]);
      if (taken.rows.length > 0) throw fail(409, 'email_taken');
    },
    validate: (ctx) => {
      const input = ctx.input();
      const email = input.text('email', 3, 200, { trim: true });
      if (email !== undefined && !EMAIL.test(email)) input.fields.add('email', 'must be an email address');
      const out = {
        email,
        password: input.text('password', 10, 200),
        displayName: input.text('displayName', 1, 60, { trim: true }),
        venueName: input.text('venueName', 1, 60, { trim: true }),
      };
      input.fields.check();
      return out as { email: string; password: string; displayName: string; venueName: string };
    },
    run: async (_ctx, _loaded, input) => {
      const workspaceId = randomUUID();
      const userId = randomUUID();
      await db.transaction(async (client) => {
        await client.query(`INSERT INTO workspaces (id, name) VALUES ($1,$2)`, [workspaceId, input.venueName]);
        await addUser(client, workspaceId, { email: input.email, password: input.password, displayName: input.displayName, role: 'owner' }, userId);
        const made = await client.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
        if (made.rows.length === 0) throw fail(409, 'email_taken');
        for (const room of STARTER_ROOMS.filter((r) => r.starter)) await insertRoom(client, workspaceId, room);
      });
      return json(
        201,
        { user: { id: userId, email: input.email, displayName: input.displayName, role: 'owner' }, workspace: { id: workspaceId, name: input.venueName } },
        { 'set-cookie': await startLogin(userId) },
      );
    },
  });

  route('POST', '/api/auth/login', {
    auth: 'none',
    validate: (ctx) => {
      const input = ctx.input();
      const out = { email: input.text('email', 1, 200), password: input.text('password', 1, 200) };
      input.fields.check();
      return out as { email: string; password: string };
    },
    run: async (ctx, _loaded, input) => {
      const found = await ctx.db.query<UserRow>(
        `SELECT u.*, w.name AS workspace_name FROM users u JOIN workspaces w ON w.id = u.workspace_id WHERE lower(u.email) = lower($1)`,
        [input.email],
      );
      const row = found.rows[0];
      if (!row || !(await passwordMatches(input.password, row.password_hash))) throw fail(401, 'invalid_credentials');
      return json(200, { user: toUser(row) }, { 'set-cookie': await startLogin(row.id) });
    },
  });

  route('POST', '/api/auth/logout', {
    auth: 'none',
    run: async (ctx) => {
      const id = loginIdOf(ctx);
      if (id) await ctx.db.query(`DELETE FROM logins WHERE id = $1`, [id]);
      return { ...empty(204), headers: { 'set-cookie': clearedCookie } };
    },
  });

  route('GET', '/api/me', {
    auth: 'member',
    run: async (ctx) => {
      const { userId, email, displayName, role, workspaceId, workspaceName } = ctx.actor;
      return json(200, { user: { id: userId, email, displayName, role }, workspace: { id: workspaceId, name: workspaceName } });
    },
  });
}
