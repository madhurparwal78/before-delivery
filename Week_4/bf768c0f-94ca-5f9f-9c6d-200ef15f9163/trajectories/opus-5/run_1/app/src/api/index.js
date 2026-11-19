/**
 * The whole HTTP surface under /api.
 */

import express from 'express';
import { router as authRouter } from './auth.js';
import { router as gamesRouter } from './games.js';
import { router as socialRouter } from './social.js';
import { router as adminRouter } from './admin.js';
import { route, fail } from '../http.js';
import { storeReadable } from '../db.js';

export const api = express.Router();

api.get('/health', route(async (req, res) => {
  await storeReadable();
  res.json({ status: 'ok', store: 'readable' });
}));

api.use(authRouter);
api.use(gamesRouter);
api.use(socialRouter);
api.use(adminRouter);

api.use((req, res) => {
  res.status(404).json({ error: 'There is nothing at that address.', request_id: req.requestId });
});
