import type { PoolClient } from 'pg';
import { pool } from './db.js';
import { ApiError, notFound, validation } from './errors.js';
import type { Step } from '../shared/catalogue.js';
import { parseTags, validateSteps } from '../shared/catalogue.js';
import type { RecipeSummary, RecipeVersion } from '../shared/protocol.js';

export interface RecipeRow {
  id: string;
  owner_type: 'user' | 'team';
  owner_user_id: string | null;
  owner_team_id: string | null;
  current_version: number;
  last_used_at: Date;
  created_at: Date;
}

export interface VisibleRecipe {
  id: string;
  owner_type: 'user' | 'team';
  owner_user_id: string | null;
  owner_team_id: string | null;
  owner_name: string;
  current_version: number;
  last_used_at: Date;
  updated_at: Date;
}

/** One query for every recipe the caller can see, most recently used first. */
export async function visibleRecipes(userId: string): Promise<VisibleRecipe[]> {
  const r = await pool.query(
    `SELECT r.id, r.owner_type, r.owner_user_id, r.owner_team_id, r.current_version, r.last_used_at,
            COALESCE(t.name, u.display_name) AS owner_name,
            (SELECT MAX(v.created_at) FROM versions v WHERE v.recipe_id = r.id) AS updated_at
     FROM recipes r
     LEFT JOIN teams t ON t.id = r.owner_team_id
     LEFT JOIN users u ON u.id = r.owner_user_id
     WHERE (r.owner_type = 'user' AND r.owner_user_id = $1)
        OR (r.owner_type = 'team' AND r.owner_team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))
     ORDER BY r.last_used_at DESC`,
    [userId],
  );
  return r.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    owner_type: row.owner_type as 'user' | 'team',
    owner_user_id: row.owner_user_id as string | null,
    owner_team_id: row.owner_team_id as string | null,
    owner_name: row.owner_name as string,
    current_version: row.current_version as number,
    last_used_at: row.last_used_at as Date,
    updated_at: (row.updated_at as Date | null) ?? (row.created_at as Date),
  }));
}

/** The one visibility gate: resolves the recipe when the user can see it, else notFound. */
export async function visibleRecipe(userId: string, recipeId: string): Promise<VisibleRecipe> {
  const r = await pool.query(
    `SELECT r.id, r.owner_type, r.owner_user_id, r.owner_team_id, r.current_version, r.last_used_at,
            COALESCE(t.name, u.display_name) AS owner_name,
            (SELECT MAX(v.created_at) FROM versions v WHERE v.recipe_id = r.id) AS updated_at
     FROM recipes r
     LEFT JOIN teams t ON t.id = r.owner_team_id
     LEFT JOIN users u ON u.id = r.owner_user_id
     WHERE r.id = $2
       AND ((r.owner_type = 'user' AND r.owner_user_id = $1)
         OR (r.owner_type = 'team' AND r.owner_team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)))`,
    [userId, recipeId],
  );
  const row = r.rows[0];
  if (!row) throw notFound();
  return {
    id: row.id,
    owner_type: row.owner_type,
    owner_user_id: row.owner_user_id,
    owner_team_id: row.owner_team_id,
    owner_name: row.owner_name,
    current_version: row.current_version,
    last_used_at: row.last_used_at,
    updated_at: row.updated_at ?? row.created_at,
  };
}

export function summaryOf(recipe: VisibleRecipe, name: string, tags: string[]): RecipeSummary {
  return {
    id: recipe.id,
    name,
    owner: { type: recipe.owner_type, id: recipe.owner_type === 'team' ? (recipe.owner_team_id ?? '') : (recipe.owner_user_id ?? ''), name: recipe.owner_name },
    latestVersion: recipe.current_version,
    tags,
    updatedAt: recipe.updated_at.toISOString(),
    lastUsedAt: recipe.last_used_at.toISOString(),
  };
}

export interface VersionRow {
  n: number;
  name: string;
  note: string;
  tags: string[];
  steps: Step[];
  author_id: string;
  author_name: string;
  created_at: Date;
}

export async function versionRows(recipeId: string, includeSteps: boolean): Promise<VersionRow[]> {
  const cols = includeSteps ? 'v.n, v.name, v.note, v.tags, v.steps, v.author_id, u.display_name AS author_name, v.created_at' : 'v.n, v.name, v.note, v.tags, v.author_id, u.display_name AS author_name, v.created_at';
  const r = await pool.query(`SELECT ${cols} FROM versions v JOIN users u ON u.id = v.author_id WHERE v.recipe_id = $1 ORDER BY v.n DESC`, [recipeId]);
  return r.rows.map((row: Record<string, unknown>) => ({
    n: row.n as number,
    name: row.name as string,
    note: row.note as string,
    tags: row.tags as string[],
    steps: includeSteps ? (row.steps as Step[]) : ([] as Step[]),
    author_id: row.author_id as string,
    author_name: row.author_name as string,
    created_at: row.created_at as Date,
  }));
}

export function versionOf(row: VersionRow, includeSteps: boolean): RecipeVersion {
  return {
    n: row.n,
    name: row.name,
    note: row.note,
    tags: row.tags,
    steps: includeSteps ? row.steps : [],
    author: { id: row.author_id, displayName: row.author_name },
    createdAt: row.created_at.toISOString(),
  };
}

/** Validates name/note/tags/steps from a save payload; every route funnels through here. */
export function validateRecipeInput(body: Record<string, unknown>): { name: string; note: string; tags: string[]; steps: Step[] } {
  const fields: Record<string, string> = {};
  const name = body.name;
  if (typeof name !== 'string' || name.length < 1 || name.length > 80) fields.name = 'Name needs 1 to 80 characters.';
  const note = body.note ?? '';
  if (typeof note !== 'string' || note.length > 200) fields.note = 'The note is at most 200 characters.';
  let tags: string[] = [];
  if (body.tags === undefined || body.tags === null) tags = [];
  else if (typeof body.tags === 'string') {
    const parsed = parseTags(body.tags);
    if ('message' in parsed) fields.tags = parsed.message;
    else tags = parsed.tags;
  } else if (Array.isArray(body.tags)) {
    if (body.tags.some((t) => typeof t !== 'string') || body.tags.length > 10 || body.tags.some((t) => typeof t === 'string' && !/^[a-z0-9-]{1,30}$/.test(t))) {
      fields.tags = 'Tags need 1 to 30 lowercase letters, digits or hyphens each, 10 at most.';
    } else tags = body.tags as string[];
  }
  const stepsRaw = body.steps;
  if (!Array.isArray(stepsRaw)) {
    fields.steps = 'Steps are needed.';
  } else {
    const v = validateSteps(stepsRaw);
    if ('fields' in v) Object.assign(fields, v.fields);
    else if (v.steps.length === 0) fields.steps = 'A recipe needs at least one step.';
    else {
      const r = { steps: v.steps };
      return { name: (name as string).trim(), note: (note as string).trim(), tags, steps: r.steps };
    }
  }
  throw validation(fields);
}

/** The one version-conflict check (Engineering standards): inside the caller's transaction. */
export async function insertVersion(
  client: PoolClient,
  recipeId: string,
  baseVersion: number,
  name: string,
  note: string,
  tags: string[],
  steps: Step[],
  authorId: string,
  authorName: string,
  versionsKept: number,
): Promise<{ n: number }> {
  const lock = await client.query<{ current_version: number; author_name: string }>(
    `SELECT r.current_version,
            (SELECT u.display_name FROM versions v JOIN users u ON u.id = v.author_id WHERE v.recipe_id = r.id AND v.n = r.current_version) AS author_name
     FROM recipes r WHERE r.id = $1 FOR UPDATE`,
    [recipeId],
  );
  const row = lock.rows[0];
  if (!row) throw notFound();
  if (row.current_version !== baseVersion) {
    throw new ApiError(409, 'version_conflict', `Version ${row.current_version} was saved by ${row.author_name ?? 'someone'} while you were editing.`, {
      latestVersion: row.current_version,
      authorName: row.author_name ?? 'someone',
    });
  }
  const n = baseVersion + 1;
  await client.query(
    'INSERT INTO versions (recipe_id, n, name, note, tags, steps, author_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [recipeId, n, name, note, JSON.stringify(tags), JSON.stringify(steps), authorId],
  );
  await client.query('UPDATE recipes SET current_version = $2 WHERE id = $1', [recipeId, n]);
  if (n > versionsKept) {
    await client.query('DELETE FROM versions WHERE recipe_id = $1 AND n <= $2', [recipeId, n - versionsKept]);
  }
  return { n };
}
