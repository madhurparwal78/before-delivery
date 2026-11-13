import crypto from 'node:crypto';
import { Router } from 'express';
import type { Config } from '../config.js';
import { pool, withTransaction } from '../db.js';
import { HttpError } from '../http.js';
import type { AuthedRequest } from '../middleware.js';
import { requireAuth } from '../middleware.js';
import * as svc from '../commission-service.js';
import * as dates from '../domain/dates.js';
import { layoutComplete } from '../domain/placement.js';
import type { LayoutItem } from '../domain/placement.js';
import { enqueueJob } from '../jobs.js';

/** A hold that lost the race for a venue day; the free days are read after rollback. */
export class DayTaken extends Error {
  constructor(public venueId: string, public date: string, public today: string) {
    super('That day was just taken.');
  }
}

export function holdsRouter(cfg: Config): Router {
  const router = Router();
  const auth = requireAuth(cfg.accessTtlSeconds);

  router.post('/commissions/:id/hold', auth, async (req, res, next) => {
    try {
      const id = (req.params as { id?: string })['id'] ?? '';
      const body = req.body as { date?: string };
      const result = await withTransaction(async (tx) => {
        const user = (req as AuthedRequest).user!;
        const commission = await svc.getCommission(tx, id);
        if (!commission || (commission.client_id !== user.id && user.role !== 'producer')) throw new HttpError(404, 'not_found', '');
        // Ending is judged on the server on every write.
        await svc.expireHolds(tx, commission);
        const fresh = (await svc.getCommission(tx, id))!;
        if (fresh.state !== 'placed' && fresh.state !== 'held') throw new HttpError(409, 'illegal_state', '');
        if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
          throw new HttpError(422, 'validation', '', { errors: { date: 'Pick a day from 21 days to one year ahead.' } });
        }
        const venue = svc.venueById(fresh.venue_id);
        const today = dates.localDate(new Date(), venue.time_zone);
        const win = dates.bookableWindow(today);
        if (body.date < win.from || body.date > win.to) {
          throw new HttpError(422, 'validation', '', { errors: { date: 'Pick a day from 21 days to one year ahead.' } });
        }
        // Placement must be complete to hold a day.
        const layoutRow = (await tx.query(`SELECT items FROM layouts WHERE commission_id = $1`, [id])).rows[0] as { items: LayoutItem[] } | undefined;
        if (!layoutRow || !layoutComplete(layoutRow.items, fresh.installation_type, fresh.add_ons)) {
          throw new HttpError(409, 'placement_incomplete', '', {});
        }
        // Exactly one winner per venue day: the install_days row is the unique slot.
        const booked = await tx.query(`SELECT 1 FROM install_days WHERE venue_id = $1 AND date = $2`, [venue.id, body.date]);
        if (booked.rowCount && booked.rowCount > 0) {
          throw new HttpError(409, 'day_taken', 'That day was just taken.', { nextFreeDays: await nextFreeDays(tx, venue.id, body.date, today) });
        }
        const active = await tx.query(`SELECT commission_id FROM holds WHERE venue_id = $1 AND date = $2 AND state = 'held' AND expires_at > now()`, [venue.id, body.date]);
        if (active.rowCount && active.rowCount > 0) {
          const heldByOther = (active.rows[0] as { commission_id: string }).commission_id !== id;
          if (heldByOther) {
            throw new HttpError(409, 'day_taken', 'That day was just taken.', { nextFreeDays: await nextFreeDays(tx, venue.id, body.date, today) });
          }
        }
        // A new hold releases the previous one in the same step.
        await tx.query(`UPDATE holds SET state = 'released' WHERE commission_id = $1 AND state = 'held'`, [id]);
        const holdId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + cfg.holdSeconds * 1000);
        try {
          await tx.query(
            `INSERT INTO holds (id, commission_id, venue_id, date, expires_at, state) VALUES ($1, $2, $3, $4, $5, 'held')`,
            [holdId, id, venue.id, body.date, expiresAt],
          );
        } catch (insertErr) {
          // The unique partial index makes exactly one simultaneous hold win;
          // the transaction is aborted, so the free days are read after rollback.
          if (typeof insertErr === 'object' && insertErr !== null && 'code' in insertErr && (insertErr as { code?: string }).code === '23505') {
            const dayTaken = new DayTaken(venue.id, body.date, today);
            throw dayTaken;
          }
          throw insertErr;
        }
        await svc.setState(tx, id, 'held');
        // Slot-held CRM event.
        await enqueueJob(tx, 'webhook', id, { eventKind: 'slot.held', holdId }, `slot-held-${holdId}`);
        return { holdId, date: body.date, expiresAt, venue };
      });
      res.status(201).json({
        holdId: result.holdId,
        date: result.date,
        expiresAt: result.expiresAt.toISOString(),
        secondsRemaining: cfg.holdSeconds,
        serverTime: new Date().toISOString(),
        status: 'held',
      });
    } catch (e) {
      if (e instanceof DayTaken) {
        const tx = await pool.connect();
        try {
          const free = await nextFreeDays(tx, e.venueId, e.date, e.today);
          res.status(409).json({ error: { code: 'day_taken', message: 'That day was just taken.', nextFreeDays: free } });
        } finally {
          tx.release();
        }
        return;
      }
      next(e);
    }
  });

  router.get('/commissions/:id/hold', auth, async (req, res, next) => {
    try {
      const id = (req.params as { id?: string })['id'] ?? '';
      const result = await withTransaction(async (tx) => {
        const user = (req as AuthedRequest).user!;
        const commission = await svc.getCommission(tx, id);
        if (!commission || (commission.client_id !== user.id && user.role !== 'producer')) throw new HttpError(404, 'not_found', '');
        await svc.expireHolds(tx, commission);
        const hold = await svc.latestHold(tx, id);
        if (!hold) return null;
        const status = await svc.holdStatus(tx, hold);
        return {
          holdId: hold.id,
          date: hold.date,
          expiresAt: hold.expires_at.toISOString(),
          secondsRemaining: Math.max(0, Math.floor((hold.expires_at.getTime() - Date.now()) / 1000)),
          serverTime: new Date().toISOString(),
          status,
        };
      });
      if (!result) {
        res.status(404).json({ error: { code: 'not_found' } });
        return;
      }
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  router.delete('/commissions/:id/hold', auth, async (req, res, next) => {
    try {
      const id = (req.params as { id?: string })['id'] ?? '';
      await withTransaction(async (tx) => {
        const user = (req as AuthedRequest).user!;
        const commission = await svc.getCommission(tx, id);
        if (!commission || (commission.client_id !== user.id && user.role !== 'producer')) throw new HttpError(404, 'not_found', '');
        await tx.query(`UPDATE holds SET state = 'released' WHERE commission_id = $1 AND state = 'held'`, [id]);
        const fresh = (await svc.getCommission(tx, id))!;
        if (fresh.state === 'held') await svc.setState(tx, id, 'placed');
      });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}

export async function nextFreeDays(tx: svc.DbClientAlias, venueId: string, afterDate: string, today: string): Promise<string[]> {
  const win = dates.bookableWindow(today);
  const free: string[] = [];
  let cursor = afterDate < win.from ? win.from : dates.addDays(afterDate, 1);
  while (free.length < 3 && cursor <= win.to) {
    const booked = await tx.query(`SELECT 1 FROM install_days WHERE venue_id = $1 AND date = $2`, [venueId, cursor]);
    const held = await tx.query(`SELECT 1 FROM holds WHERE venue_id = $1 AND date = $2 AND state = 'held' AND expires_at > now()`, [venueId, cursor]);
    if (!(booked.rowCount && booked.rowCount > 0) && !(held.rowCount && held.rowCount > 0)) {
      free.push(cursor);
    }
    cursor = dates.addDays(cursor, 1);
  }
  return free;
}
