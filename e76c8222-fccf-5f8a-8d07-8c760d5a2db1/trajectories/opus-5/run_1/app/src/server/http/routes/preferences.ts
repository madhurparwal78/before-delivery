import { Router } from 'express';
import { pool } from '../../db/pool';
import { listInterpreters, preferencesOf, savePreferences } from '../../domain/preferences';
import { jsonObject, requireRoles } from '../context';
import { readIdList } from '../validation';

export const preferencesRouter = Router();

preferencesRouter.get('/consumers/me/preferences', async (req, res) => {
  const user = requireRoles(req, ['consumer']);
  const lists = await preferencesOf(pool, user.id);
  res.json({ ...lists, interpreters: await listInterpreters(pool) });
});

preferencesRouter.put('/consumers/me/preferences', async (req, res) => {
  const user = requireRoles(req, ['consumer']);
  const body = jsonObject(req);
  const saved = await savePreferences(user.id, {
    preferred: readIdList(body.preferred, 'preferred'),
    blocked: readIdList(body.blocked, 'blocked'),
  });
  res.json(saved);
});
