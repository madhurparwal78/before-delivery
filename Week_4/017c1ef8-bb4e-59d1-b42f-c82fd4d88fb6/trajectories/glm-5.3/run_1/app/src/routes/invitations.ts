import { Router } from 'express';
import { withTransaction } from '../db.js';
import { businessMs } from '../clock.js';
import { errors, conflict } from '../errors.js';
import { wrap, requireSession } from '../http.js';
import { cooldownFor } from '../connections.js';
import { pushTo } from '../live.js';

/** Batch withdrawal: all-or-nothing, every request at the same business-clock instant. */
export const invitationsRouter = (): Router => {
  const router = Router();
  router.use('/invitations', requireSession);

  router.post('/withdraw', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const { member_ids } = (req.body ?? {}) as { member_ids?: string[] };
    if (!Array.isArray(member_ids) || member_ids.length < 1 || member_ids.length > 50 ||
        new Set(member_ids).size !== member_ids.length) {
      throw errors.validation({ member_ids: 'Choose 1 to 50 invitations.' });
    }
    const nowDate = new Date(businessMs());
    await withTransaction(async (client) => {
        for (const memberId of member_ids) {
          const row = await client.query(
            `SELECT requester_id FROM connections
             WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
            [viewerId, memberId]);
          const found = row.rows[0];
          if (!found || found.requester_id !== viewerId) {
            throw conflict({ error: 'not_pending', member_id: memberId });
          }
          const state = await client.query(`SELECT state FROM connections WHERE requester_id = $1 AND addressee_id = $2`,
            [viewerId, memberId]);
          if (state.rows[0].state !== 'pending') {
            throw conflict({ error: 'not_pending', member_id: memberId });
          }
        }
        for (const memberId of member_ids) {
          await client.query(
            `UPDATE connections SET state = 'withdrawn', withdrawn_at = $1 WHERE requester_id = $2 AND addressee_id = $3`,
            [nowDate, viewerId, memberId]);
          pushTo(memberId, 'connection', { member_id: viewerId, state: 'none' });
        }
      });
      res.json({
        withdrawn: member_ids,
        retry_at: cooldownFor(nowDate).toISOString(),
      });
    }));

  return router;
};
