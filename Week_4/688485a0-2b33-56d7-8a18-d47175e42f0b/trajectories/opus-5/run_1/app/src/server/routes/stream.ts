import { Router } from 'express';
import { collectionAccess, requireUser } from '../access';
import { query, queryOne } from '../db';
import { subscribeChanges } from '../events';
import { handler } from '../httpUtil';

export const streamRoutes = Router();

interface ChangeRow {
  seq: string;
  op: string;
  doc_id: string;
  body: string | null;
  version: number | null;
}

streamRoutes.get(
  '/projects/:pid/collections/:cid/events',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    const collectionId = access.collection.id;

    const resumeHeader = req.headers['last-event-id'];
    const resumeQuery = req.query['after'];
    const resume = typeof resumeHeader === 'string' ? resumeHeader : typeof resumeQuery === 'string' ? resumeQuery : '';
    let lastSent = /^\d+$/.test(resume) ? Number(resume) : Number(access.collection.sequence);
    let role = access.role;

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let flushing = false;
    let again = false;
    const flush = async (): Promise<void> => {
      if (flushing) {
        again = true;
        return;
      }
      flushing = true;
      try {
        do {
          again = false;
          const rows = await query<ChangeRow>(
            `select seq::text as seq, op, doc_id, body, version from changes
             where collection_id = $1 and seq > $2 order by seq asc`,
            [collectionId, lastSent],
          );
          for (const row of rows) {
            const data = {
              seq: Number(row.seq),
              op: row.op,
              _id: row.doc_id,
              document: row.body ? (JSON.parse(row.body) as unknown) : null,
              version: row.version,
            };
            res.write(`id: ${row.seq}\nevent: change\ndata: ${JSON.stringify(data)}\n\n`);
            lastSent = Number(row.seq);
          }
        } while (again);
      } finally {
        flushing = false;
      }
    };

    const checkRole = async (): Promise<void> => {
      const row = await queryOne<{ role: string }>(
        'select role from memberships where project_id = $1 and user_id = $2',
        [access.project.id, user.id],
      );
      if (!row) {
        res.end();
        return;
      }
      if (row.role !== role) {
        role = row.role as typeof role;
        res.write(`event: role\ndata: ${JSON.stringify({ role })}\n\n`);
      }
    };

    const unsubscribe = subscribeChanges(collectionId, () => {
      void flush();
    });
    const ticker = setInterval(() => {
      void flush();
      void checkRole();
    }, 700);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);

    req.on('close', () => {
      clearInterval(ticker);
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });

    await flush();
  }),
);
