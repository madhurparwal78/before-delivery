import { Router } from 'express';
import { pool } from '../db.js';
import { requireUser } from '../auth.js';
import { handle } from '../errors.js';
import { summaryOf, visibleRecipe, visibleRecipes } from '../recipes.js';
import { searchRecipes } from '../search.js';

export const searchRouteRouter = Router();

searchRouteRouter.get('/', handle(async (req, res) => {
  const user = requireUser(req);
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const all = await visibleRecipes(user.id);

  if (q.trim() === '') {
    const summaries = [];
    for (const r of all) {
      const v = await pool.query<{ name: string; tags: string[] }>('SELECT name, tags FROM versions WHERE recipe_id = $1 AND n = $2', [r.id, r.current_version]);
      if (v.rows[0]) summaries.push(summaryOf(r, v.rows[0].name, v.rows[0].tags));
    }
    res.json({ results: summaries, total: summaries.length });
    return;
  }

  const searched = await searchRecipes(user.id, q, all);
  const ids = searched.ids;
  const total = searched.total;
  const summaries = [];
  for (const id of ids) {
    try {
      const r = await visibleRecipe(user.id, id);
      const v = await pool.query<{ name: string; tags: string[] }>('SELECT name, tags FROM versions WHERE recipe_id = $1 AND n = $2', [r.id, r.current_version]);
      if (v.rows[0]) summaries.push(summaryOf(r, v.rows[0].name, v.rows[0].tags));
    } catch {
      // a deleted or invisible recipe never appears
    }
  }
  res.json({ results: summaries, total: total });
}));
