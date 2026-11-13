import { codePoints, invalid } from '../../domain/validate.js';
import { query } from '../db.js';
import { jsonBody, notFound, requireOwner, sendEmpty, sendJson, type Route } from '../http.js';
import { randomId, randomToken } from '../ids.js';
import { readRequestCount } from '../services/cache.js';

export const tokenRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/tokens',
    auth: 'session',
    body: 'json',
    handle: async (context) => {
      requireOwner(context);
      const body = jsonBody(context);
      const name = typeof body.name === 'string' ? body.name : '';
      if (codePoints(name) < 1 || codePoints(name) > 60) throw invalid('name');
      const id = randomId('tok');
      const token = randomToken('gct_', 40);
      const rows = await query<{ created_at: Date }>(
        `insert into read_tokens (id, name, token) values ($1,$2,$3) returning created_at`,
        [id, name, token],
      );
      sendJson(context.response, 201, { id, name, token, created_at: rows[0].created_at.toISOString() });
    },
  },
  {
    method: 'GET',
    path: '/api/tokens',
    auth: 'session',
    handle: async (context) => {
      requireOwner(context);
      const rows = await query<{ id: string; name: string; created_at: Date; last_used_at: Date | null }>(
        `select id, name, created_at, last_used_at from read_tokens where revoked_at is null order by created_at`,
      );
      const now = Math.floor(Date.now() / 1000);
      const items = [];
      for (const row of rows) {
        items.push({
          id: row.id,
          name: row.name,
          created_at: row.created_at.toISOString(),
          last_used_at: row.last_used_at === null ? null : row.last_used_at.toISOString(),
          requests_in_window: await readRequestCount(row.id, now),
        });
      }
      sendJson(context.response, 200, { items });
    },
  },
  {
    method: 'DELETE',
    path: '/api/tokens/{id}',
    auth: 'session',
    handle: async (context) => {
      requireOwner(context);
      const revoked = await query<{ id: string }>(
        `update read_tokens set revoked_at = now() where id = $1 and revoked_at is null returning id`,
        [context.params.id],
      );
      if (revoked.length === 0) throw notFound();
      sendEmpty(context.response, 204);
    },
  },
];
