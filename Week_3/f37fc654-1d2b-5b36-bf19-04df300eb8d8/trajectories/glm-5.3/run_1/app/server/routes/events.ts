import type { Config } from '../config.js';
import { Router } from 'express';
import type { AuthedRequest } from '../middleware.js';
import { authenticate } from '../middleware.js';
import { pool } from '../db.js';

interface Subscriber {
  userId: string;
  role: string;
  send: (event: string, data: unknown) => void;
  maySee: (commissionId: string) => Promise<boolean>;
}

const subscribers = new Set<Subscriber>();

/** Fan-out for board events; each subscriber keeps its own visibility rule. */
export function publishPayment(commissionId: string, payerName: string, amountCents: number, label: string, commissionTitle?: string): void {
  for (const sub of subscribers) {
    void sub.maySee(commissionId).then((allowed) => {
      if (allowed) sub.send('payment.confirmed', { commissionId, payerName, amountCents, label, commissionTitle });
    });
  }
}

export function publishCommission(commissionId: string, state: string): void {
  for (const sub of subscribers) {
    void sub.maySee(commissionId).then((allowed) => {
      if (allowed) sub.send('commission.updated', { commissionId, state });
    });
  }
}

export function publishRender(renderId: string, state: string, progress: number, commissionId: string): void {
  for (const sub of subscribers) {
    void sub.maySee(commissionId).then((allowed) => {
      if (allowed) sub.send('render.updated', { renderId, state, progress });
    });
  }
}

export function publishJob(jobId: string, status: string): void {
  for (const sub of subscribers) {
    if (sub.role !== 'producer') continue;
    sub.send('job.updated', { jobId, status });
  }
}

export function publishHold(commissionId: string, status: string): void {
  for (const sub of subscribers) {
    void sub.maySee(commissionId).then((allowed) => {
      if (allowed) sub.send('hold.updated', { commissionId, status });
    });
  }
}

export function eventsRouter(cfg: Config): Router {
  const router = Router();

  router.get('/events', async (req, res) => {
    const outcome = await authenticate(req as AuthedRequest, cfg.accessTtlSeconds);
    if (!outcome || 'expired' in outcome) {
      res.status(401).json({ error: { code: 'unauthenticated' } });
      return;
    }
    const user = outcome.user;
    res.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.flushHeaders?.();
    // Visibility is checked at publish time, so new commissions reach open streams.
    const sub: Subscriber = {
      userId: user.id,
      role: user.role,
      send: (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
      maySee: (commissionId: string) => maySee(commissionId, user.id, user.role),
    };
    subscribers.add(sub);
    res.write(': connected\n\n');
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      subscribers.delete(sub);
    });
  });

  return router;
}

/** True when the user may see that commission. */
export async function maySee(commissionId: string, userId: string, role: string): Promise<boolean> {
  const tx = await pool.connect();
  try {
    if (role === 'producer') return true;
    if (role === 'client') {
      const rows = await tx.query(`SELECT 1 FROM commissions WHERE id = $1 AND client_id = $2`, [commissionId, userId]);
      return (rows.rowCount ?? 0) > 0;
    }
    if (role === 'sponsor') {
      const rows = await tx.query(`SELECT 1 FROM funders WHERE commission_id = $1 AND app_user_id = $2`, [commissionId, userId]);
      return (rows.rowCount ?? 0) > 0;
    }
    if (role === 'crew') {
      const rows = await tx.query(`SELECT 1 FROM install_days WHERE commission_id = $1 AND $2 = ANY(crew_user_ids)`, [commissionId, userId]);
      return (rows.rowCount ?? 0) > 0;
    }
    return false;
  } finally {
    tx.release();
  }
}
