import type { PoolClient } from 'pg';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { newId, pool, withTransaction } from './db.js';
import { apiErrors } from './errors.js';
import { findOperation, normalizeArgs } from '../shared/ops.js';
import type { RecipeStep } from '../shared/recipe.js';
import type { RecipeDocument } from './search.js';
import { indexRecipe } from './search.js';

const scrypt = promisify(scryptCallback);

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  verified: boolean;
}

export interface TeamMembership {
  id: string;
  name: string;
  role: 'owner' | 'member';
}

export interface RecipeSummary {
  id: string;
  name: string;
  owner: { type: 'user' | 'team'; id: string; name: string };
  latestVersion: number;
  tags: string[];
  updatedAt: string;
  lastUsedAt: string;
}

export interface VersionBody {
  n: number;
  name: string;
  note: string;
  tags: string[];
  steps: RecipeStep[];
  author: { id: string; displayName: string };
  createdAt: string;
}

export interface RecipeRow {
  id: string;
  name: string;
  ownerUserId: string | null;
  teamId: string | null;
  latestVersion: number;
  tags: string[];
  updatedAt: Date;
  lastUsedAt: Date;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 32)) as Buffer;
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [saltHex, digestHex] = stored.split(':');
  if (saltHex === undefined || digestHex === undefined) return false;
  const derived = (await scrypt(password, Buffer.from(saltHex, 'hex'), 32)) as Buffer;
  const expected = Buffer.from(digestHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(24).toString('hex');
}

export async function createUser(
  email: string,
  displayName: string,
  password: string,
  verified: boolean,
): Promise<UserRow> {
  const id = newId('u');
  const passwordHash = await hashPassword(password);
  await pool.query(
    'insert into users (id, email, display_name, password_hash, verified) values ($1, $2, $3, $4, $5)',
    [id, email, displayName, passwordHash, verified],
  );
  return { id, email, displayName, verified };
}

export async function findUserByEmail(email: string): Promise<(UserRow & { passwordHash: string }) | null> {
  const result = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    verified: boolean;
    password_hash: string;
  }>('select id, email, display_name, verified, password_hash from users where lower(email) = lower($1)', [email]);
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    verified: row.verified,
    passwordHash: row.password_hash,
  };
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const result = await pool.query<{ id: string; email: string; display_name: string; verified: boolean }>(
    'select id, email, display_name, verified from users where id = $1',
    [id],
  );
  const row = result.rows[0];
  return row === undefined ? null : { id: row.id, email: row.email, displayName: row.display_name, verified: row.verified };
}

export async function createSession(userId: string): Promise<string> {
  const token = newToken();
  await pool.query('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval \'30 days\')', [
    hashToken(token),
    userId,
  ]);
  return token;
}

export async function sessionUser(token: string): Promise<UserRow | null> {
  const result = await pool.query<{ id: string; email: string; display_name: string; verified: boolean }>(
    `select u.id, u.email, u.display_name, u.verified from sessions s
     join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  return row === undefined ? null : { id: row.id, email: row.email, displayName: row.display_name, verified: row.verified };
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query('delete from sessions where token_hash = $1', [hashToken(token)]);
}

export async function teamsOf(userId: string): Promise<TeamMembership[]> {
  const result = await pool.query<{ id: string; name: string; role: string }>(
    `select t.id, t.name, m.role from team_members m join teams t on t.id = m.team_id
     where m.user_id = $1 order by t.created_at`,
    [userId],
  );
  return result.rows.map((row) => ({ id: row.id, name: row.name, role: row.role as 'owner' | 'member' }));
}

export interface TeamBody {
  id: string;
  name: string;
  owner: string;
  members: { id: string; displayName: string; email: string; role: 'owner' | 'member' }[];
  invites?: { email: string; expiresAt: string }[];
}

export async function teamBody(teamId: string, withInvites: boolean): Promise<TeamBody | null> {
  const team = await pool.query<{ id: string; name: string; owner_id: string }>(
    'select id, name, owner_id from teams where id = $1',
    [teamId],
  );
  const row = team.rows[0];
  if (row === undefined) return null;
  const members = await pool.query<{ id: string; display_name: string; email: string; role: string }>(
    `select u.id, u.display_name, u.email, m.role from team_members m join users u on u.id = m.user_id
     where m.team_id = $1 order by case when m.role = 'owner' then 0 else 1 end, u.display_name`,
    [teamId],
  );
  const body: TeamBody = {
    id: row.id,
    name: row.name,
    owner: row.owner_id,
    members: members.rows.map((member) => ({
      id: member.id,
      displayName: member.display_name,
      email: member.email,
      role: member.role as 'owner' | 'member',
    })),
  };
  if (withInvites) {
    const invites = await pool.query<{ email: string; expires_at: Date }>(
      'select email, expires_at from invites where team_id = $1 and spent = false and expires_at > now() order by created_at',
      [teamId],
    );
    body.invites = invites.rows.map((invite) => ({
      email: invite.email,
      expiresAt: invite.expires_at.toISOString(),
    }));
  }
  return body;
}

export async function isTeamMember(teamId: string, userId: string): Promise<boolean> {
  const result = await pool.query('select 1 from team_members where team_id = $1 and user_id = $2', [teamId, userId]);
  return result.rowCount === 1;
}

export async function teamMemberIds(teamId: string): Promise<string[]> {
  const result = await pool.query<{ user_id: string }>('select user_id from team_members where team_id = $1', [teamId]);
  return result.rows.map((row) => row.user_id);
}

export async function teamMemberCount(teamId: string): Promise<number> {
  const result = await pool.query<{ count: string }>('select count(*)::text as count from team_members where team_id = $1', [
    teamId,
  ]);
  return Number(result.rows[0]?.count ?? '0');
}

function toSummary(row: {
  id: string;
  name: string;
  owner_user_id: string | null;
  team_id: string | null;
  latest_version: number;
  tags: string[];
  updated_at: Date;
  last_used_at: Date;
  owner_name: string;
}): RecipeSummary {
  return {
    id: row.id,
    name: row.name,
    owner:
      row.team_id === null
        ? { type: 'user', id: row.owner_user_id!, name: row.owner_name }
        : { type: 'team', id: row.team_id, name: row.owner_name },
    latestVersion: row.latest_version,
    tags: row.tags,
    updatedAt: row.updated_at.toISOString(),
    lastUsedAt: row.last_used_at.toISOString(),
  };
}

const SUMMARY_SELECT = `
  select r.id, r.name, r.owner_user_id, r.team_id, r.latest_version, r.tags, r.updated_at, r.last_used_at,
         coalesce(t.name, u.display_name, '') as owner_name
  from recipes r
  left join teams t on t.id = r.team_id
  left join users u on u.id = r.owner_user_id
`;

const VISIBLE_WHERE = `
  (r.owner_user_id = $1 or r.team_id in (select team_id from team_members where user_id = $1))
`;

export async function visibleRecipes(userId: string): Promise<RecipeSummary[]> {
  const result = await pool.query(`${SUMMARY_SELECT} where ${VISIBLE_WHERE} order by r.last_used_at desc`, [userId]);
  return result.rows.map((row) => toSummary(row as never));
}

export async function recipeSummary(recipeId: string): Promise<RecipeSummary | null> {
  const result = await pool.query(`${SUMMARY_SELECT} where r.id = $1`, [recipeId]);
  const row = result.rows[0];
  return row === undefined ? null : toSummary(row as never);
}

export async function visibleRecipe(recipeId: string, userId: string): Promise<RecipeSummary | null> {
  const result = await pool.query(`${SUMMARY_SELECT} where r.id = $2 and ${VISIBLE_WHERE}`, [userId, recipeId]);
  const row = result.rows[0];
  return row === undefined ? null : toSummary(row as never);
}

export async function recipeAudience(recipeId: string): Promise<string[]> {
  const result = await pool.query<{ owner_user_id: string | null; team_id: string | null }>(
    'select owner_user_id, team_id from recipes where id = $1',
    [recipeId],
  );
  const row = result.rows[0];
  if (row === undefined) return [];
  if (row.team_id !== null) return teamMemberIds(row.team_id);
  return row.owner_user_id === null ? [] : [row.owner_user_id];
}

function versionFromRow(row: {
  n: number;
  name: string;
  note: string;
  tags: string[];
  steps: RecipeStep[];
  author_id: string;
  display_name: string;
  created_at: Date;
}): VersionBody {
  return {
    n: row.n,
    name: row.name,
    note: row.note,
    tags: row.tags,
    steps: row.steps,
    author: { id: row.author_id, displayName: row.display_name },
    createdAt: row.created_at.toISOString(),
  };
}

export async function keptVersions(recipeId: string): Promise<Omit<VersionBody, 'steps'>[]> {
  const result = await pool.query(
    `select v.n, v.name, v.note, v.tags, '[]'::jsonb as steps, v.author_id, u.display_name, v.created_at
     from recipe_versions v join users u on u.id = v.author_id
     where v.recipe_id = $1 order by v.n desc`,
    [recipeId],
  );
  return result.rows.map((row) => {
    const { steps: _steps, ...rest } = versionFromRow(row as never);
    return rest;
  });
}

export async function getVersion(recipeId: string, n: number): Promise<VersionBody | null> {
  const result = await pool.query(
    `select v.n, v.name, v.note, v.tags, v.steps, v.author_id, u.display_name, v.created_at
     from recipe_versions v join users u on u.id = v.author_id
     where v.recipe_id = $1 and v.n = $2`,
    [recipeId, n],
  );
  const row = result.rows[0];
  return row === undefined ? null : versionFromRow(row as never);
}

export interface VersionDraft {
  name: string;
  note: string;
  tags: string[];
  steps: RecipeStep[];
}

export interface SaveOutcome {
  summary: RecipeSummary;
  version: VersionBody;
}

/** The single place that decides whether a save is based on the recipe's newest version. */
export async function conflictIfStale(
  recipeId: string,
  baseVersion: number,
  client?: PoolClient,
): Promise<number> {
  const runner = client ?? pool;
  const locked = await runner.query<{ latest_version: number }>(
    client === undefined
      ? 'select latest_version from recipes where id = $1'
      : 'select latest_version from recipes where id = $1 for update',
    [recipeId],
  );
  const current = locked.rows[0];
  if (current === undefined) throw apiErrors.notFound();
  if (current.latest_version !== baseVersion) {
    const author = await runner.query<{ display_name: string }>(
      `select u.display_name from recipe_versions v join users u on u.id = v.author_id
       where v.recipe_id = $1 order by v.n desc limit 1`,
      [recipeId],
    );
    throw apiErrors.versionConflict(current.latest_version, author.rows[0]?.display_name ?? 'a teammate');
  }
  return current.latest_version;
}

/** Writes the next immutable version from a stated base version. */
export async function appendVersion(
  recipeId: string,
  baseVersion: number,
  draft: VersionDraft,
  authorId: string,
): Promise<SaveOutcome> {
  const outcome = await withTransaction(async (client) => {
    const next = (await conflictIfStale(recipeId, baseVersion, client)) + 1;
    await client.query(
      `insert into recipe_versions (recipe_id, n, name, note, tags, steps, author_id)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
      [recipeId, next, draft.name, draft.note, JSON.stringify(draft.tags), JSON.stringify(draft.steps), authorId],
    );
    await client.query(
      `update recipes set name = $2, tags = $3::jsonb, latest_version = $4, updated_at = now(), last_used_at = now()
       where id = $1`,
      [recipeId, draft.name, JSON.stringify(draft.tags), next],
    );
    await pruneVersions(client, recipeId, next);
    return next;
  });
  const summary = (await recipeSummary(recipeId))!;
  const version = (await getVersion(recipeId, outcome))!;
  await indexSummary(summary, version);
  return { summary, version };
}

async function pruneVersions(client: PoolClient, recipeId: string, newest: number): Promise<void> {
  await client.query('delete from recipe_versions where recipe_id = $1 and n <= $2', [
    recipeId,
    newest - config.limits.versionsKept,
  ]);
}

export async function createRecipe(
  owner: { type: 'user' | 'team'; id: string },
  draft: VersionDraft,
  authorId: string,
): Promise<SaveOutcome> {
  const id = newId('r');
  await withTransaction(async (client) => {
    await client.query(
      `insert into recipes (id, name, owner_user_id, team_id, latest_version, tags)
       values ($1, $2, $3, $4, 1, $5::jsonb)`,
      [
        id,
        draft.name,
        owner.type === 'user' ? owner.id : null,
        owner.type === 'team' ? owner.id : null,
        JSON.stringify(draft.tags),
      ],
    );
    await client.query(
      `insert into recipe_versions (recipe_id, n, name, note, tags, steps, author_id)
       values ($1, 1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
      [id, draft.name, draft.note, JSON.stringify(draft.tags), JSON.stringify(draft.steps), authorId],
    );
  });
  const summary = (await recipeSummary(id))!;
  const version = (await getVersion(id, 1))!;
  await indexSummary(summary, version);
  return { summary, version };
}

export async function markRecipeOpened(recipeId: string): Promise<void> {
  await pool.query('update recipes set last_used_at = now() where id = $1', [recipeId]);
}

/** Builds the search document for a recipe's newest version. */
export function recipeDocument(summary: RecipeSummary, version: VersionBody): RecipeDocument {
  const operations: string[] = [];
  const argumentValues: string[] = [];
  for (const step of version.steps) {
    const op = findOperation(step.op);
    if (op === undefined) continue;
    operations.push(op.name);
    const args = normalizeArgs(op, step.args);
    for (const spec of op.args) {
      const value = args[spec.key];
      if (typeof value === 'boolean') continue;
      const asText = String(value);
      if (asText !== '') argumentValues.push(asText);
    }
  }
  return {
    id: summary.id,
    name: version.name,
    note: version.note,
    tags: version.tags,
    operations,
    argumentValues,
    ownerUserId: summary.owner.type === 'user' ? summary.owner.id : null,
    teamId: summary.owner.type === 'team' ? summary.owner.id : null,
    latestVersion: summary.latestVersion,
    updatedAt: Math.floor(new Date(summary.updatedAt).getTime() / 1000),
  };
}

export async function indexSummary(summary: RecipeSummary, version: VersionBody): Promise<void> {
  await indexRecipe(recipeDocument(summary, version));
}

export async function summariesByIds(ids: readonly string[], userId: string): Promise<RecipeSummary[]> {
  if (ids.length === 0) return [];
  const result = await pool.query(`${SUMMARY_SELECT} where r.id = any($2::text[]) and ${VISIBLE_WHERE}`, [
    userId,
    ids,
  ]);
  const byId = new Map(result.rows.map((row) => [row['id'] as string, toSummary(row as never)]));
  return ids.map((id) => byId.get(id)).filter((summary): summary is RecipeSummary => summary !== undefined);
}
