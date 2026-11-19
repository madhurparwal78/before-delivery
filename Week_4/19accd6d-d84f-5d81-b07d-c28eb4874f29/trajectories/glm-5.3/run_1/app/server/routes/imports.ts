import { Router } from 'express';
import { createHash } from 'node:crypto';
import { pool } from '../db.js';
import { ApiError, notFound, validation, handle } from '../errors.js';
import { newId } from '../ids.js';
import { requireUser } from '../auth.js';
import { parseWringLine } from '../wringline.js';
import { summaryOf, visibleRecipe } from '../recipes.js';
import { docFor, indexRecipe } from '../search.js';

export const importsRouter = Router();

importsRouter.post('/', handle(async (req, res) => {
  const user = requireUser(req);
  const body = req.body ?? {};
  if (typeof body.text !== 'string') throw validation({ text: 'Wring Line text is needed.' });
  const owner = body.owner ?? { type: 'user' };
  let ownerUserId: string | null = user.id;
  let ownerTeamId: string | null = null;
  if (owner.type === 'team') {
    const t = await pool.query('SELECT t.id FROM teams t JOIN team_members m ON m.team_id = t.id WHERE t.id = $1 AND m.user_id = $2', [owner.id, user.id]);
    if (!t.rows[0]) throw notFound();
    ownerUserId = null;
    ownerTeamId = t.rows[0].id;
  }

  const normalized = body.text.replace(/\r\n?/g, '\n');
  const textHash = createHash('sha256').update(normalized).update(`|${owner.type}|${ownerUserId ?? ownerTeamId}`).digest('hex');

  const prior = await pool.query<{ recipe_id: string; status: string }>(
    'SELECT recipe_id, status FROM imports WHERE user_id = $1 AND text_hash = $2 AND status IN (\'created\', \'already_imported\') ORDER BY created_at DESC LIMIT 1',
    [user.id, textHash],
  );
  if (prior.rows[0] && prior.rows[0].recipe_id) {
    const recipe = await visibleRecipe(user.id, prior.rows[0].recipe_id);
    const v = await pool.query<{ n: number; name: string; tags: string[] }>(
      'SELECT n, name, tags FROM versions WHERE recipe_id = $1 ORDER BY n ASC LIMIT 1',
      [recipe.id],
    );
    const first = v.rows[0];
    await pool.query('INSERT INTO imports (id, user_id, owner_type, owner_user_id, owner_team_id, text_hash, status, report, recipe_id) VALUES ($1,$2,$3,$4,$5,$6,\'already_imported\',$7,$8)', [
      newId('im'),
      user.id,
      owner.type,
      ownerUserId,
      ownerTeamId,
      textHash,
      JSON.stringify({ message: `Already imported as ${first.name} (version 1). Nothing was created.` }),
      recipe.id,
    ]);
    return res.status(200).json({
      import: {
        status: 'already_imported',
        recipe: summaryOf(recipe, first.name, first.tags),
        version: 1,
        message: `Already imported as ${first.name} (version 1). Nothing was created.`,
      },
    });
  }

  const report = parseWringLine(body.text);
  if (report.errors.length > 0 || report.steps.length === 0) {
    const count = report.errors.length > 0 ? report.errors.length : 1;
    const linesMsg = report.errors.length > 0 ? report.errors : ['Line 1: expected \'wringline 1\''];
    await pool.query('INSERT INTO imports (id, user_id, owner_type, owner_user_id, owner_team_id, text_hash, status, report) VALUES ($1,$2,$3,$4,$5,$6,\'unmatched\',$7)', [
      newId('im'),
      user.id,
      owner.type,
      ownerUserId,
      ownerTeamId,
      textHash,
      JSON.stringify({ lines: linesMsg }),
    ]);
    const noun = count === 1 ? 'line did not match' : 'lines did not match';
    throw new ApiError(422, 'import_unmatched', `${count} ${noun}. Nothing was created.`, { lines: linesMsg });
  }

  const id = newId('r');
  await pool.query('INSERT INTO recipes (id, owner_type, owner_user_id, owner_team_id, current_version) VALUES ($1, $2, $3, $4, 1)', [
    id,
    owner.type,
    ownerUserId,
    ownerTeamId,
  ]);
  await pool.query('INSERT INTO versions (recipe_id, n, name, note, tags, steps, author_id) VALUES ($1, 1, $2, \'\', $3, $4, $5)', [
    id,
    report.name,
    JSON.stringify([]),
    JSON.stringify(report.steps),
    user.id,
  ]);
  await pool.query('INSERT INTO imports (id, user_id, owner_type, owner_user_id, owner_team_id, text_hash, status, report, recipe_id) VALUES ($1,$2,$3,$4,$5,$6,\'created\',$7,$8)', [
    newId('im'),
    user.id,
    owner.type,
    ownerUserId,
    ownerTeamId,
    textHash,
    JSON.stringify({ lineCount: report.lineCount }),
    id,
  ]);
  const recipe = await visibleRecipe(user.id, id);
  await indexRecipe(docFor(recipe, report.name, '', [], report.steps)).catch(() => undefined);
  res.status(201).json({
    import: {
      status: 'created',
      recipe: summaryOf(recipe, report.name, []),
      version: 1,
      lineCount: report.lineCount,
    },
  });
}));
