import { Router } from 'express';
import { pool, withTransaction } from '../db.js';
import { config } from '../config.js';
import { notFound, validation, handle } from '../errors.js';
import { newId } from '../ids.js';
import { requireUser } from '../auth.js';
import type { VisibleRecipe } from '../recipes.js';
import {
  insertVersion,
  summaryOf,
  validateRecipeInput,
  versionOf,
  versionRows,
  visibleRecipe,
  visibleRecipes,
} from '../recipes.js';
import { compareVersions } from '../compare.js';
import { docFor, indexRecipe } from '../search.js';
import type { RecipeVersion } from '../../shared/protocol.js';
import { broadcast, type SaveEvent } from '../live.js';

export const recipesRouter = Router();

function saveEvent(recipe: VisibleRecipe, user: { id: string; displayName: string }, name: string, version: number): SaveEvent {
  return {
    recipeId: recipe.id,
    teamId: recipe.owner_type === 'team' ? recipe.owner_team_id : null,
    ownerUserId: recipe.owner_type === 'user' ? recipe.owner_user_id : null,
    version,
    name,
    authorId: user.id,
    authorName: user.displayName,
  };
}

recipesRouter.get('/', handle(async (req, res) => {
  const user = requireUser(req);
  const recipes = await visibleRecipes(user.id);
  const summaries = [];
  for (const r of recipes) {
    const v = await pool.query<{ name: string; tags: string[] }>(
      'SELECT name, tags FROM versions WHERE recipe_id = $1 AND n = $2',
      [r.id, r.current_version],
    );
    if (v.rows[0]) summaries.push(summaryOf(r, v.rows[0].name, v.rows[0].tags));
  }
  res.json({ recipes: summaries });
}));

recipesRouter.post('/', handle(async (req, res) => {
  const user = requireUser(req);
  const body = req.body ?? {};
  const input = validateRecipeInput(body);
  const owner = body.owner ?? { type: 'user' };
  let ownerUserId: string | null = user.id;
  let ownerTeamId: string | null = null;
  if (owner.type === 'team') {
    const t = await pool.query<{ id: string }>(
      'SELECT t.id FROM teams t JOIN team_members m ON m.team_id = t.id WHERE t.id = $1 AND m.user_id = $2',
      [owner.id, user.id],
    );
    if (!t.rows[0]) throw notFound();
    ownerUserId = null;
    ownerTeamId = t.rows[0].id;
  }
  const id = newId('r');
  await pool.query('INSERT INTO recipes (id, owner_type, owner_user_id, owner_team_id, current_version) VALUES ($1, $2, $3, $4, 1)', [
    id,
    owner.type,
    ownerUserId,
    ownerTeamId,
  ]);
  await pool.query('INSERT INTO versions (recipe_id, n, name, note, tags, steps, author_id) VALUES ($1, 1, $2, $3, $4, $5, $6)', [
    id,
    input.name,
    input.note,
    JSON.stringify(input.tags),
    JSON.stringify(input.steps),
    user.id,
  ]);
  const recipe = await visibleRecipe(user.id, id);
  const version: RecipeVersion = {
    n: 1,
    name: input.name,
    note: input.note,
    tags: input.tags,
    steps: input.steps,
    author: { id: user.id, displayName: user.displayName },
    createdAt: new Date().toISOString(),
  };
  await indexRecipe(docFor(recipe, input.name, input.note, input.tags, input.steps)).catch(() => undefined);
  broadcast(saveEvent(recipe, user, input.name, version.n));
  res.status(201).json({ recipe: summaryOf(recipe, input.name, input.tags), version });
}));

recipesRouter.get('/:id', handle(async (req, res) => {
  const user = requireUser(req);
  const recipe = await visibleRecipe(user.id, req.params.id);
  const versions = await versionRows(recipe.id, false);
  const newest = versions[0];
  res.json({
    recipe: summaryOf(recipe, newest?.name ?? '', newest?.tags ?? []),
    versions: versions.map((v) => versionOf(v, false)),
  });
}));

recipesRouter.get('/:id/versions/:n', handle(async (req, res) => {
  const user = requireUser(req);
  const recipe = await visibleRecipe(user.id, req.params.id);
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 1) throw notFound();
  const rows = await versionRows(recipe.id, true);
  const row = rows.find((r) => r.n === n);
  if (!row) throw notFound();
  res.json({ version: versionOf(row, true) });
}));

recipesRouter.post('/:id/versions', handle(async (req, res) => {
  const user = requireUser(req);
  const recipe = await visibleRecipe(user.id, req.params.id);
  const body = req.body ?? {};
  const input = validateRecipeInput(body);
  const baseVersion = body.baseVersion;
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 1) {
    throw validation({ baseVersion: 'A base version is needed.' });
  }
  const { n } = await withTransaction((client) =>
    insertVersion(client, recipe.id, baseVersion, input.name, input.note, input.tags, input.steps, user.id, user.displayName, config().versionsKept),
  );
  const rows = await versionRows(recipe.id, true);
  const row = rows.find((r) => r.n === n)!;
  await indexRecipe(docFor(recipe, input.name, input.note, input.tags, input.steps)).catch(() => undefined);
  broadcast(saveEvent(recipe, user, input.name, n));
  res.status(201).json({ recipe: summaryOf(recipe, input.name, input.tags), version: versionOf(row, true) });
}));

recipesRouter.post('/:id/restore', handle(async (req, res) => {
  const user = requireUser(req);
  const recipe = await visibleRecipe(user.id, req.params.id);
  const body = req.body ?? {};
  const k = body.version;
  const baseVersion = body.baseVersion;
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion)) throw validation({ baseVersion: 'A base version is needed.' });
  if (typeof k !== 'number' || !Number.isInteger(k) || k < 1) throw validation({ version: 'A version is needed.' });
  const rows = await versionRows(recipe.id, true);
  const source = rows.find((r) => r.n === k);
  if (!source) throw notFound();
  const { n } = await withTransaction((client) =>
    insertVersion(
      client,
      recipe.id,
      baseVersion,
      source.name,
      `Restored from version ${k}`,
      source.tags,
      source.steps,
      user.id,
      user.displayName,
      config().versionsKept,
    ),
  );
  const after = await versionRows(recipe.id, true);
  const row = after.find((r) => r.n === n)!;
  await indexRecipe(docFor(recipe, source.name, source.note, source.tags, source.steps)).catch(() => undefined);
  broadcast(saveEvent(recipe, user, source.name, n));
  res.status(201).json({ recipe: summaryOf(recipe, source.name, source.tags), version: versionOf(row, true) });
}));

recipesRouter.get('/:id/compare', handle(async (req, res) => {
  const user = requireUser(req);
  const recipe = await visibleRecipe(user.id, req.params.id);
  const from = Number(req.query.from);
  const to = Number(req.query.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1) throw notFound();
  const rows = await versionRows(recipe.id, true);
  const a = rows.find((r) => r.n === from);
  const b = rows.find((r) => r.n === to);
  if (!a || !b) throw notFound();
  res.json({ changes: compareVersions(a, b) });
}));

recipesRouter.post('/:id/opened', handle(async (req, res) => {
  const user = requireUser(req);
  const recipe = await visibleRecipe(user.id, req.params.id);
  await pool.query('UPDATE recipes SET last_used_at = now() WHERE id = $1', [recipe.id]);
  res.status(204).end();
}));


