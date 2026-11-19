import type { FastifyInstance } from 'fastify';
import { memberOf } from '../auth.js';
import { pool } from '../db.js';
import { entriesNewerThan, feedPage } from '../domain/feed.js';

export async function feedRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/feed', async (request) => {
    const query = request.query as { cursor?: unknown; newer_than?: unknown };
    const viewer = memberOf(request);
    if (typeof query.newer_than === 'string') return entriesNewerThan(pool, viewer.id, query.newer_than);
    return feedPage(pool, viewer.id, typeof query.cursor === 'string' && query.cursor !== '' ? query.cursor : null);
  });
}
