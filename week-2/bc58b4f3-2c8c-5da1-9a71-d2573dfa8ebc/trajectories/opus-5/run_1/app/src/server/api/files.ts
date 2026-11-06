import { pool } from '../db/pool.js';
import { fail } from '../http/errors.js';
import type { Reply, Route } from '../http/router.js';
import { getObject, StorageUnavailableError } from '../services/storage.js';

const downloadForm: Route = {
  method: 'GET',
  pattern: '/files/:token',
  body: 'none',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    const result = await pool.query<{ object_key: string; content_type: string }>(
      `SELECT v.object_key, v.content_type
       FROM file_tokens t
       JOIN verifications v ON v.seat_id = t.seat_id
       WHERE t.token = $1 AND t.session_id = $2 AND t.expires_at > now()`,
      [ctx.params['token'] ?? '', ctx.session.id],
    );
    const stored = result.rows[0];
    if (stored === undefined) {
      fail('not_found');
    }
    try {
      const bytes = await getObject(stored.object_key);
      return {
        status: 200,
        raw: bytes,
        headers: {
          'content-type': stored.content_type,
          'content-disposition': 'attachment',
          'cache-control': 'no-store',
        },
      };
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        fail('storage_unavailable');
      }
      throw error;
    }
  },
};

export const fileRoutes = [downloadForm];
