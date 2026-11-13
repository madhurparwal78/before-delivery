import crypto from 'node:crypto';
import { Router } from 'express';
import type { Config } from '../config.js';
import { pool, withTransaction } from '../db.js';
import { HttpError } from '../http.js';
import type { AuthedRequest } from '../middleware.js';
import { requireAuth } from '../middleware.js';
import * as svc from '../commission-service.js';
import { serializeCommission } from './briefs.js';
import * as placement from '../domain/placement.js';
import { quoteAmounts } from '../domain/money.js';
import * as sm from '../domain/state-machine.js';
import * as dates from '../domain/dates.js';
import type { LayoutItem } from '../domain/placement.js';
import { enqueueJob } from '../jobs.js';

export function commissionsRouter(cfg: Config): Router {
  const router = Router();
  const auth = requireAuth(cfg.accessTtlSeconds);

  const paramId = (req: { params: { id?: string } }): string => {
    const id = req.params['id'];
    if (!id) throw new HttpError(404, 'not_found', '');
    return id;
  };

  /** Caller may see this commission: owner or producer. */
  async function visibleCommission(tx: svc.DbClientAlias, req: AuthedRequest, id: string): Promise<svc.CommissionRow> {
    const user = req.user;
    if (!user) throw new HttpError(401, 'unauthenticated', '');
    const commission = await svc.getCommission(tx, id);
    if (!commission) throw new HttpError(404, 'not_found', '');
    if (user.role !== 'producer' && commission.client_id !== user.id) throw new HttpError(404, 'not_found', '');
    return commission;
  }

  router.get('/commissions', auth, async (req, res, next) => {
    try {
      const user = (req as AuthedRequest).user!;
      const tx = await pool.connect();
      try {
        let rows: svc.CommissionRow[];
        if (user.role === 'producer') {
          rows = (await tx.query(`SELECT * FROM commissions ORDER BY created_at DESC`)).rows as svc.CommissionRow[];
        } else if (user.role === 'client') {
          rows = (await tx.query(`SELECT * FROM commissions WHERE client_id = $1 ORDER BY created_at DESC`, [user.id])).rows as svc.CommissionRow[];
        } else {
          rows = [];
        }
        const list = [];
        for (const c of rows) {
          const quote = await svc.currentQuote(tx, c.id);
          const milestones = await svc.getMilestones(tx, c.id);
          const next = milestones.find((m) => m.state === 'invoiced' || m.state === 'payment_pending');
          const hold = await svc.latestHold(tx, c.id);
          const installDay = (await tx.query(`SELECT date FROM install_days WHERE commission_id = $1`, [c.id])).rows[0] as { date: string } | undefined;
          const paid = (await tx.query(`SELECT coalesce(sum(amount_cents),0)::int AS total FROM ledger_entries WHERE commission_id = $1`, [c.id])).rows[0] as { total: number };
          const venue = svc.venueById(c.venue_id);
          const clientRes = await tx.query(`SELECT name FROM app_users WHERE id = $1`, [c.client_id]);
          list.push({
            id: c.id,
            title: c.title,
            state: c.state,
            venueName: venue.name,
            clientName: (clientRes.rows[0] as { name: string } | undefined)?.name ?? '',
            totalCents: quote?.total_cents ?? 0,
            paidCents: paid.total ?? 0,
            nextDueAt: next?.due_at?.toISOString() ?? null,
            nextDueCents: next?.amount_cents ?? null,
            installDate: installDay?.date ?? null,
          });
        }
        res.json({ commissions: list });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  router.get('/commissions/:id', auth, async (req, res, next) => {
    try {
      const tx = await pool.connect();
      try {
        await visibleCommission(tx, req as AuthedRequest, paramId(req));
        res.json(await serializeCommission(tx, paramId(req)));
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  router.get('/commissions/:id/ledger', auth, async (req, res, next) => {
    try {
      const tx = await pool.connect();
      try {
        await visibleCommission(tx, req as AuthedRequest, paramId(req));
        const rows = await tx.query(`SELECT * FROM ledger_entries WHERE commission_id = $1 ORDER BY at`, [req.params['id']]);
        res.json({
          entries: rows.rows.map((r: { id: string; payer_name: string; label: string; amount_cents: number; killbill_payment_id: string; at: Date }) => ({
            id: r.id,
            payerName: r.payer_name,
            label: r.label,
            amountCents: r.amount_cents,
            killbillPaymentId: r.killbill_payment_id,
            at: r.at.toISOString(),
          })),
        });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  router.post('/commissions/:id/transitions', auth, async (req, res, next) => {
    try {
      const user = (req as AuthedRequest).user!;
      const to = (req.body as { to?: string })['to'] as sm.TransitionTarget | undefined;
      if (!to) throw new HttpError(422, 'validation', '', { errors: { to: 'Pick a transition.' } });
      await withTransaction(async (tx) => {
        const commission = await svc.getCommission(tx, paramId(req));
        if (!commission) throw new HttpError(404, 'not_found', '');
        const actor = sm.manualActor(commission.state, to);
        if (!actor) {
          throw new HttpError(409, 'illegal_transition', `A commission can't move from ${commission.state} to ${to}.`, { from: commission.state, to });
        }
        if (actor === 'client_owner' && user.id !== commission.client_id) throw new HttpError(404, 'not_found', '');
        if (actor === 'producer' && user.role !== 'producer') throw new HttpError(403, 'forbidden', '');
        if (actor === 'crew_or_producer') {
          // The producer or an assigned crew lead may confirm installation.
          if (user.role === 'crew') {
            const day = (await tx.query(`SELECT crew_user_ids FROM install_days WHERE commission_id = $1`, [commission.id])).rows[0] as { crew_user_ids: string[] } | undefined;
            if (!day || !day.crew_user_ids.includes(user.id)) throw new HttpError(404, 'not_found', '');
          } else if (user.role !== 'producer') {
            throw new HttpError(403, 'forbidden', '');
          }
        }
        // Guards on unpaid milestones.
        if (to === 'fabricating') {
          const milestones = await svc.getMilestones(tx, commission.id);
          const concept = milestones.find((m) => m.label === 'Concept approval');
          if (concept && concept.state !== 'paid') throw new HttpError(409, 'milestone_unpaid', '', { milestoneId: concept.id });
        }
        if (to === 'installed') {
          const milestones = await svc.getMilestones(tx, commission.id);
          const fab = milestones.find((m) => m.label === 'Fabrication');
          if (fab && fab.state !== 'paid') throw new HttpError(409, 'milestone_unpaid', '', { milestoneId: fab.id });
        }
        if (to === 'cancelled') {
          await tx.query(`UPDATE holds SET state = 'released' WHERE commission_id = $1 AND state = 'held'`, [commission.id]);
          await tx.query(`DELETE FROM install_days WHERE commission_id = $1`, [commission.id]);
        }
        if (to === 'concept_approved') {
          await invoiceMilestone(tx, cfg, commission.id, 'Concept approval');
        }
        if (to === 'fabricating') {
          await invoiceMilestone(tx, cfg, commission.id, 'Fabrication');
        }
        if (to === 'accepted') {
          await invoiceMilestone(tx, cfg, commission.id, 'Signed acceptance');
        }
        await svc.setState(tx, commission.id, to);
      });
      const tx = await pool.connect();
      try {
        res.json(await serializeCommission(tx, paramId(req)));
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  // ---- Layout ----

  router.put('/commissions/:id/layout', auth, async (req, res, next) => {
    try {
      const body = req.body as { version?: number; items?: LayoutItem[] };
      const result = await withTransaction(async (tx) => {
        const commission = await visibleCommission(tx, req as AuthedRequest, paramId(req));
        const allowed = ['previewed', 'placed', 'held', 'contracted', 'concept_approved'];
        if (!allowed.includes(commission.state)) throw new HttpError(409, 'illegal_state', '');
        const layoutRow = (await tx.query(`SELECT version FROM layouts WHERE commission_id = $1`, [commission.id])).rows[0] as { version: number } | undefined;
        if (!layoutRow) throw new HttpError(404, 'not_found', '');
        const currentVersion = layoutRow.version;
        if (typeof body.version !== 'number' || body.version !== currentVersion) {
          throw new HttpError(412, 'version_conflict', '', { currentVersion });
        }
        const items = Array.isArray(body.items) ? body.items : [];
        const message = placement.validateLayout(items, {
          widthM: Number(commission.width_m),
          depthM: Number(commission.depth_m),
          doorWall: commission.door_wall,
        }, commission.installation_type, commission.add_ons);
        if (message) {
          const index = items.findIndex(() => true);
          throw new HttpError(422, 'validation', '', { errors: { [`items[${index}]`]: message } });
        }
        await tx.query(`UPDATE layouts SET version = version + 1, items = $2 WHERE commission_id = $1`, [commission.id, JSON.stringify(items)]);
        // Moving to placed when complete.
        if (commission.state === 'previewed' && placement.layoutComplete(items, commission.installation_type, commission.add_ons)) {
          await svc.setState(tx, commission.id, 'placed');
        }
        // A save while booked queues a placement-changed crew alert.
        const booked = (await tx.query(`SELECT id FROM install_days WHERE commission_id = $1`, [commission.id])).rows[0] as { id: string } | undefined;
        if (booked) {
          await enqueueJob(tx, 'crew_alert', commission.id, { alertKind: 'placement_changed' }, `placement-${commission.id}-${currentVersion + 1}`);
        }
        const updated = (await tx.query(`SELECT version, items FROM layouts WHERE commission_id = $1`, [commission.id])).rows[0] as { version: number; items: LayoutItem[] };
        return updated;
      });
      res.json({ version: result.version, items: result.items });
    } catch (e) {
      next(e);
    }
  });

  router.post('/commissions/:id/quote-preview', auth, async (req, res, next) => {
    try {
      const body = req.body as { size?: string; addOns?: string[] };
      const tx = await pool.connect();
      try {
        const commission = await visibleCommission(tx, req as AuthedRequest, paramId(req));
        const venue = svc.venueById(commission.venue_id);
        const size = typeof body.size === 'string' && ['compact', 'standard', 'grand'].includes(body.size) ? (body.size as 'compact' | 'standard' | 'grand') : commission.size;
        const addOns = Array.isArray(body.addOns) ? (body.addOns.filter((a) => ['ambient-sound', 'night-lighting', 'photo-takeaway'].includes(a)) as svc.CommissionRow['add_ons']) : commission.add_ons;
        res.json(quoteAmounts(commission.installation_type, size, addOns, venue.tax_rate_bp));
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  return router;
}

/** Invoices a milestone in Kill Bill at its trigger, inside the caller's transaction. */
export async function invoiceMilestone(tx: svc.DbClientAlias, cfg: Config, commissionId: string, label: string): Promise<void> {
  const commission = await svc.getCommission(tx, commissionId);
  if (!commission) throw new HttpError(404, 'not_found', '');
  const milestones = await svc.getMilestones(tx, commissionId);
  const milestone = milestones.find((m) => m.label === label);
  if (!milestone || milestone.state !== 'scheduled') return;
  const venue = svc.venueById(commission.venue_id);
  const now = new Date();
  const dueAt = dates.milestoneDueAt(now, venue.time_zone);
  const { KillBill } = await import('../services/killbill.js');
  const kb = new KillBill(cfg);
  const clientRes = await tx.query(`SELECT name, email FROM app_users WHERE id = $1`, [commission.client_id]);
  const client = clientRes.rows[0] as { name: string; email: string };
  const accountId = await kb.ensureAccount(commission.client_id, client.name, client.email);
  const invoice = await kb.createInvoice(accountId, commission.title, label, milestone.subtotal_cents, milestone.tax_cents, dates.localDate(now, venue.time_zone));
  await tx.query(
    `UPDATE milestones SET state = 'invoiced', invoiced_at = $2, due_at = $3, killbill_invoice_id = $4 WHERE id = $1`,
    [milestone.id, now, dueAt, invoice.invoiceId],
  );
  // Invoice PDF + milestone-due email + PDF job, created in this transaction.
  const docId = crypto.randomUUID();
  await tx.query(
    `INSERT INTO documents (id, commission_id, kind, version, label, s3_key, issued_at, killbill_invoice_id)
     VALUES ($1, $2, 'invoice', 1, $3, $4, $5, $6)`,
    [docId, commissionId, label, `commissions/${commissionId}/documents/invoice-${invoice.invoiceId}.pdf`, now, invoice.invoiceId],
  );
  await tx.query(`UPDATE milestones SET document_id = $2 WHERE id = $1`, [milestone.id, docId]);
  await enqueueJob(tx, 'pdf', commissionId, { documentId: docId, kind: 'invoice' }, `pdf-${docId}`);
  await enqueueJob(tx, 'email', commissionId, { emailKind: 'milestone_due', milestoneId: milestone.id }, `milestone-due-${milestone.id}`);
}
