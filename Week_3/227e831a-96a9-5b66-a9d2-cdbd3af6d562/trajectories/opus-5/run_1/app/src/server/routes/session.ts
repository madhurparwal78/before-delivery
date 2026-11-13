import { HttpError } from '../http/errors.js';
import { declaredBody, textOf } from '../http/json.js';
import type { Route } from '../http/pipeline.js';
import { pool } from '../db.js';
import {
  clearedCookie,
  createSession,
  endSession,
  passphraseMatches,
  sessionCookie,
} from '../sessions.js';
import { loadProfileRow, profileJson } from '../store.js';

export const sessionRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/health',
    auth: 'public',
    body: 'json',
    handler: async () => {
      try {
        await pool.query('SELECT 1');
      } catch {
        return { status: 503, json: { status: 'starting' } };
      }
      return { status: 200, json: { status: 'ok' } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/session',
    auth: 'public',
    body: 'json',
    handler: async (ctx) => {
      const body = declaredBody(ctx.body, ['passphrase']);
      const passphrase = textOf(body['passphrase']) ?? '';
      const profile = await loadProfileRow();
      if (!passphraseMatches(passphrase, profile.passphrase_hash)) {
        throw new HttpError(401, 'invalid_passphrase', "That passphrase didn't match.");
      }
      const id = await createSession();
      return { status: 204, headers: { 'set-cookie': sessionCookie(id) } };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/session',
    auth: 'public',
    body: 'json',
    handler: async (ctx) => {
      if (ctx.sessionId !== null) await endSession(ctx.sessionId);
      return { status: 204, headers: { 'set-cookie': clearedCookie() } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/profile',
    auth: 'owner',
    body: 'json',
    handler: async () => ({ status: 200, json: { profile: profileJson(await loadProfileRow()) } }),
  },
];
