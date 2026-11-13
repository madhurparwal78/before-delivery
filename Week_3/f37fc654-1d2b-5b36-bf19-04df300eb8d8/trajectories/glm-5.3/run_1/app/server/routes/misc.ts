import crypto from 'node:crypto';
import { Router } from 'express';
import type { Config } from '../config.js';
import { pool, withTransaction } from '../db.js';
import { HttpError } from '../http.js';
import type { AuthedRequest } from '../middleware.js';
import { requireAuth } from '../middleware.js';
import * as svc from '../commission-service.js';
import * as dates from '../domain/dates.js';
import { KillBill, KillBillUnavailable, type KbInvoice } from '../services/killbill.js';
import { KeycloakAdmin, SEEDED_USERS } from '../services/keycloak.js';
import { Svix, SvixUnavailable } from '../services/svix.js';
import { ObjectStore } from '../services/objectstore.js';
import { enqueueJob } from '../jobs.js';
import type { LayoutItem } from '../domain/placement.js';

export function miscRouter(cfg: Config): Router {
  const router = Router();
  const auth = requireAuth(cfg.accessTtlSeconds);
  const kb = new KillBill(cfg);
  const svix = new Svix(cfg);
  const store = new ObjectStore(cfg);

  // ---------- Documents ----------

  router.get('/commissions/:id/documents', auth, async (req, res, next) => {
    try {
      const id = (req.params as { id?: string })['id'] ?? '';
      const tx = await pool.connect();
      try {
        const user = (req as AuthedRequest).user!;
        const commission = await svc.getCommission(tx, id);
        if (!commission) throw new HttpError(404, 'not_found', '');
        if (user.role !== 'producer' && commission.client_id !== user.id) throw new HttpError(404, 'not_found', '');
        const rows = await tx.query(`SELECT * FROM documents WHERE commission_id = $1 ORDER BY created_at`, [id]);
        res.json({
          documents: rows.rows.map((d: { id: string; kind: string; version: number; label: string; size_bytes: number | null; sha256: string | null; issued_at: Date | null }) => ({
            id: d.id,
            kind: d.kind,
            version: d.version,
            label: d.label,
            status: d.sha256 ? 'issued' : 'preparing',
            sizeBytes: d.size_bytes,
            sha256: d.sha256,
            issuedAt: d.issued_at?.toISOString() ?? null,
          })),
        });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  router.get('/documents/:docId/pdf', auth, async (req, res, next) => {
    try {
      const docId = (req.params as { docId?: string })['docId'] ?? '';
      const tx = await pool.connect();
      let key = '';
      try {
        const user = (req as AuthedRequest).user!;
        const row = (await tx.query(`SELECT * FROM documents WHERE id = $1`, [docId])).rows[0] as { commission_id: string; s3_key: string; sha256: string | null; killbill_invoice_id: string | null } | undefined;
        if (!row) throw new HttpError(404, 'not_found', '');
        const commission = await svc.getCommission(tx, row.commission_id);
        if (!commission) throw new HttpError(404, 'not_found', '');
        const isSponsor = user.role === 'sponsor';
        const boundFunder = isSponsor ? (await tx.query(`SELECT id FROM funders WHERE commission_id = $1 AND app_user_id = $2 AND document_id = $3`, [row.commission_id, user.id, docId])).rows[0] : undefined;
        if (user.role !== 'producer' && commission.client_id !== user.id && !boundFunder) throw new HttpError(404, 'not_found', '');
        if (!row.sha256) throw new HttpError(409, 'document_preparing', '');
        key = row.s3_key;
      } finally {
        tx.release();
      }
      const object = await store.get(key);
      if (!object) throw new HttpError(409, 'document_preparing', '');
      res.setHeader('content-type', 'application/pdf');
      res.send(object.bytes);
    } catch (e) {
      next(e);
    }
  });

  // ---------- Crew ----------

  router.get('/crew', auth, async (req, res, next) => {
    try {
      const user = (req as AuthedRequest).user!;
      if (user.role !== 'producer') throw new HttpError(403, 'forbidden', '');
      const tx = await pool.connect();
      try {
        const kc = new KeycloakAdmin(cfg);
        for (const su of SEEDED_USERS.filter((s) => s.role === 'crew')) {
          const found = (await tx.query(`SELECT id FROM app_users WHERE email = $1`, [su.email])).rows[0] as { id: string } | undefined;
          if (found) continue;
          const kcUser = await kc.findUserByEmail(su.email).catch(() => null);
          await tx.query(
            `INSERT INTO app_users (id, keycloak_id, email, name, role) VALUES ($1, $2, $3, $4, 'crew')`,
            [crypto.randomUUID(), kcUser?.id ?? `seed-${su.email}`, su.email, su.name],
          );
        }
        const rows = await tx.query(`SELECT id, name, email FROM app_users WHERE role = 'crew'`);
        res.json({ crew: rows.rows });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  router.get('/install-days', auth, async (req, res, next) => {
    try {
      const user = (req as AuthedRequest).user!;
      const tx = await pool.connect();
      try {
        let rows: unknown[];
        if (user.role === 'producer') {
          rows = (await tx.query(`SELECT * FROM install_days ORDER BY date`)).rows;
        } else if (user.role === 'crew') {
          rows = (await tx.query(`SELECT * FROM install_days WHERE $1 = ANY(crew_user_ids) ORDER BY date`, [user.id])).rows;
        } else {
          throw new HttpError(403, 'forbidden', '');
        }
        const days = [];
        for (const row of rows as Array<{ id: string; commission_id: string; date: string; starts_at: Date; ends_at: Date; crew_user_ids: string[]; venue_id: string }> ) {
          const commission = await svc.getCommission(tx, row.commission_id);
          if (!commission) continue;
          const venue = svc.venueById(row.venue_id);
          const clientName = ((await tx.query(`SELECT name FROM app_users WHERE id = $1`, [commission.client_id])).rows[0] as { name: string } | undefined)?.name ?? '';
          days.push({
            id: row.id,
            commissionId: row.commission_id,
            commissionTitle: commission.title,
            clientName,
            venue: { id: venue.id, name: venue.name, address: venue.address, city: venue.city, timeZone: venue.time_zone },
            date: row.date,
            startsAt: row.starts_at.toISOString(),
            endsAt: row.ends_at.toISOString(),
            crewUserIds: row.crew_user_ids,
          });
        }
        res.json({ installDays: days });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  router.get('/install-days/:dayId', auth, async (req, res, next) => {
    try {
      const dayId = (req.params as { dayId?: string })['dayId'] ?? '';
      const tx = await pool.connect();
      try {
        const user = (req as AuthedRequest).user!;
        const row = (await tx.query(`SELECT * FROM install_days WHERE id = $1`, [dayId])).rows[0] as { id: string; commission_id: string; date: string; starts_at: Date; ends_at: Date; crew_user_ids: string[]; venue_id: string; placement_alert_sent: boolean; loadin_alert_sent: boolean } | undefined;
        if (!row) throw new HttpError(404, 'not_found', '');
        if (user.role === 'crew' && !row.crew_user_ids.includes(user.id)) throw new HttpError(404, 'not_found', '');
        if (user.role !== 'producer' && user.role !== 'crew') throw new HttpError(403, 'forbidden', '');
        const commission = await svc.getCommission(tx, row.commission_id);
        if (!commission) throw new HttpError(404, 'not_found', '');
        const venue = svc.venueById(row.venue_id);
        const clientName = ((await tx.query(`SELECT name FROM app_users WHERE id = $1`, [commission.client_id])).rows[0] as { name: string } | undefined)?.name ?? '';
        const layout = (await tx.query(`SELECT items FROM layouts WHERE commission_id = $1`, [row.commission_id])).rows[0] as { items: LayoutItem[] } | undefined;
        const alerts = [];
        alerts.push({ kind: 'slot_confirmed', title: `Slot confirmed — ${venue.name} — ${dates.formatDate(row.date)}`, sendAt: row.starts_at.toISOString(), status: 'sent' });
        const loadInAt = dates.startOfLocalDay(dates.addDays(row.date, -1), venue.time_zone);
        alerts.push({
          kind: 'day_before_loadin',
          title: `Load-in tomorrow — ${venue.name} — ${dates.formatDate(row.date)}`,
          sendAt: loadInAt.toISOString(),
          status: row.loadin_alert_sent ? 'sent' : 'scheduled',
        });
        if (row.placement_alert_sent) {
          alerts.push({ kind: 'placement_changed', title: `Placement changed — ${commission.title}`, sendAt: new Date().toISOString(), status: 'sent' });
        }
        res.json({
          id: row.id,
          commissionId: row.commission_id,
          commissionTitle: commission.title,
          clientName,
          venue: { id: venue.id, name: venue.name, address: venue.address, city: venue.city, timeZone: venue.time_zone },
          date: row.date,
          startsAt: row.starts_at.toISOString(),
          endsAt: row.ends_at.toISOString(),
          crewUserIds: row.crew_user_ids,
          layout: { items: layout?.items ?? [] },
          alerts,
        });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  router.post('/install-days/:dayId/crew', auth, async (req, res, next) => {
    try {
      const dayId = (req.params as { dayId?: string })['dayId'] ?? '';
      const body = req.body as { crewUserId?: string };
      const result = await withTransaction(async (tx) => {
        const user = (req as AuthedRequest).user!;
        if (user.role !== 'producer') throw new HttpError(403, 'forbidden', '');
        const crewUser = (await tx.query(`SELECT id, role FROM app_users WHERE id = $1`, [body.crewUserId ?? ''])).rows[0] as { id: string; role: string } | undefined;
        if (!crewUser || crewUser.role !== 'crew') throw new HttpError(404, 'not_found', '');
        const day = (await tx.query(`SELECT * FROM install_days WHERE id = $1`, [dayId])).rows[0] as { id: string; crew_user_ids: string[] } | undefined;
        if (!day) throw new HttpError(404, 'not_found', '');
        if (!day.crew_user_ids.includes(crewUser.id)) {
          await tx.query(`UPDATE install_days SET crew_user_ids = array_append(crew_user_ids, $2) WHERE id = $1`, [dayId, crewUser.id]);
        }
        const after = (await tx.query(`SELECT * FROM install_days WHERE id = $1`, [dayId])).rows[0] as { id: string; crew_user_ids: string[] };
        return { id: after.id, crewUserIds: after.crew_user_ids };
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  // ---------- CRM ----------

  router.put('/me/crm-endpoint', auth, async (req, res, next) => {
    try {
      const user = (req as AuthedRequest).user!;
      if (user.role !== 'client') throw new HttpError(403, 'forbidden', '');
      const body = req.body as { url?: string };
      const url = body.url;
      if (typeof url !== 'string' || !/^https?:\/\/[^\s]+$/i.test(url) || url.length > 2048) {
        res.status(422).json({ errors: { url: 'Enter a full http or https address.' } });
        return;
      }
      try {
        const secret = await svix.saveEndpoint(`client-${user.id}`, url);
        await withTransaction(async (tx) => {
          await tx.query(`UPDATE app_users SET crm_endpoint_url = $2, crm_signing_secret = $3 WHERE id = $1`, [user.id, url, secret]);
        });
        res.json({ url, signingSecret: secret });
      } catch (e) {
        if (e instanceof SvixUnavailable) {
          res.status(503).json({ error: { code: 'webhooks_unavailable', message: "CRM updates are delayed — they'll be sent once our webhook service is back." } });
          return;
        }
        throw e;
      }
    } catch (e) {
      next(e);
    }
  });

  router.get('/me/crm-endpoint', auth, async (req, res, next) => {
    try {
      const user = (req as AuthedRequest).user!;
      const tx = await pool.connect();
      try {
        const row = (await tx.query(`SELECT crm_endpoint_url, crm_signing_secret FROM app_users WHERE id = $1`, [user.id])).rows[0] as { crm_endpoint_url: string | null; crm_signing_secret: string | null } | undefined;
        res.json({ url: row?.crm_endpoint_url ?? null, signingSecret: row?.crm_signing_secret ?? null });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  router.get('/commissions/:id/webhook-deliveries', auth, async (req, res, next) => {
    try {
      const id = (req.params as { id?: string })['id'] ?? '';
      const tx = await pool.connect();
      try {
        const user = (req as AuthedRequest).user!;
        const commission = await svc.getCommission(tx, id);
        if (!commission) throw new HttpError(404, 'not_found', '');
        if (user.role !== 'producer' && commission.client_id !== user.id) throw new HttpError(404, 'not_found', '');
        const rows = await tx.query(`SELECT * FROM crm_events WHERE commission_id = $1 ORDER BY created_at`, [id]);
        const deliveries = [];
        for (const row of rows.rows as Array<{ id: string; event_type: string; created_at: Date; payload: Record<string, unknown> }> ) {
          const attempts = await svix.listAttempts(`client-${commission.client_id}`, row.id).catch(() => []);
          const endpoint = await (async () => {
            const u = (await tx.query(`SELECT crm_endpoint_url FROM app_users WHERE id = $1`, [commission.client_id])).rows[0] as { crm_endpoint_url: string | null } | undefined;
            return u?.crm_endpoint_url ?? null;
          })();
          deliveries.push({
            eventId: row.id,
            eventType: row.event_type,
            createdAt: row.created_at.toISOString(),
            finalState: endpoint ? Svix.finalState(attempts) : 'no_endpoint',
            attempts: attempts.map((a) => ({ at: a.at, responseStatus: a.responseStatusCode ?? 0, status: (a.responseStatusCode ?? 0) >= 200 && (a.responseStatusCode ?? 0) < 300 ? 'success' : 'failed' })),
          });
        }
        res.json({ deliveries });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  // ---------- Maintenance ----------

  router.post('/commissions/:id/maintenance', auth, async (req, res, next) => {
    try {
      const id = (req.params as { id?: string })['id'] ?? '';
      const body = req.body as { plan?: string };
      const plan = body.plan === 'priority' ? 'priority' : body.plan === 'essential' ? 'essential' : null;
      if (!plan) {
        res.status(422).json({ errors: { plan: 'Pick Essential or Priority.' } });
        return;
      }
      const result = await withTransaction(async (tx) => {
        const user = (req as AuthedRequest).user!;
        const commission = await svc.getCommission(tx, id);
        if (!commission || commission.client_id !== user.id) throw new HttpError(404, 'not_found', '');
        if (commission.state !== 'accepted') throw new HttpError(409, 'illegal_state', '');
        const milestones = await svc.getMilestones(tx, id);
        const acceptance = milestones.find((m) => m.label === 'Signed acceptance');
        if (acceptance && acceptance.state !== 'paid') throw new HttpError(409, 'milestone_unpaid', '', { milestoneId: acceptance.id });
        const existing = (await tx.query(`SELECT * FROM maintenance WHERE commission_id = $1`, [id])).rows[0] as { subscription_id: string } | undefined;
        if (existing) throw new HttpError(409, 'illegal_state', '');
        const venue = svc.venueById(commission.venue_id);
        const client = (await tx.query(`SELECT name, email FROM app_users WHERE id = $1`, [commission.client_id])).rows[0] as { name: string; email: string };
        const accountId = await kb.ensureAccount(commission.client_id, client.name, client.email);
        const { MAINTENANCE_PLANS } = await import('../domain/seed.js');
        const planMeta = MAINTENANCE_PLANS[plan];
        const today = dates.localDate(new Date(), venue.time_zone);
        const sub = await kb.createSubscription(accountId, planMeta.kbPlanId, `maint-${id}`);
        await tx.query(`INSERT INTO maintenance (commission_id, plan, killbill_subscription_id, started_at) VALUES ($1, $2, $3, now())`, [id, plan, sub.subscriptionId]);
        await svc.setState(tx, id, 'maintained');
        const invoice = await kb.findSubscriptionByExternalKey(`maint-${id}`);
        const chargedThrough = invoice?.chargedThroughDate ?? null;
        const invoices = await kb.accountInvoices(accountId);
        const startInvoice = invoices.find((i) => i.items.some((item) => item.startDate === today)) ?? invoices[invoices.length - 1] ?? null;
        const eventId = crypto.randomUUID();
        await tx.query(`INSERT INTO crm_events (id, commission_id, event_type, created_at, payload) VALUES ($1, $2, 'maintenance.changed', now(), $3)`, [
          eventId, id, JSON.stringify({ fromPlan: null, toPlan: plan, effectiveDate: today }),
        ]);
        await enqueueJob(tx, 'webhook', id, { eventKind: 'maintenance.changed', eventId }, `crm-${eventId}`);
        return {
          plan,
          killbillSubscriptionId: sub.subscriptionId,
          startDate: today,
          chargedThroughDate: chargedThrough,
          invoice: startInvoice ? { killbillInvoiceId: startInvoice.invoiceId, items: startInvoice.items, amountCents: startInvoice.amountCents } : null,
        };
      });
      res.status(201).json(result);
    } catch (e) {
      if (e instanceof KillBillUnavailable) {
        res.status(503).json({ error: { code: 'billing_unavailable', message: "Payments are paused — our billing system isn't answering. Nothing has been charged." } });
        return;
      }
      next(e);
    }
  });

  router.get('/commissions/:id/maintenance', auth, async (req, res, next) => {
    try {
      const id = (req.params as { id?: string })['id'] ?? '';
      const tx = await pool.connect();
      try {
        const user = (req as AuthedRequest).user!;
        const commission = await svc.getCommission(tx, id);
        if (!commission || (user.role !== 'producer' && commission.client_id !== user.id)) throw new HttpError(404, 'not_found', '');
        const maintenance = (await tx.query(`SELECT * FROM maintenance WHERE commission_id = $1`, [id])).rows[0] as { plan: string; killbill_subscription_id: string } | undefined;
        if (!maintenance) throw new HttpError(404, 'not_found', '');
        const client = (await tx.query(`SELECT name, email FROM app_users WHERE id = $1`, [commission!.client_id])).rows[0] as { name: string; email: string };
        const accountId = await kb.ensureAccount(commission!.client_id, client.name, client.email);
        const sub = await kb.findSubscriptionByExternalKey(`maint-${id}`);
        const invoices = await kb.accountInvoices(accountId);
        const planMeta = (await import('../domain/seed.js')).MAINTENANCE_PLANS[maintenance.plan as 'essential' | 'priority'];
        const relevant = invoices.filter((i) => i.items.some((item) => item.description?.includes(planMeta.kbPlanId)));
        res.json({
          plan: maintenance.plan,
          chargedThroughDate: sub?.chargedThroughDate ?? null,
          invoices: relevant.map((i) => ({ killbillInvoiceId: i.invoiceId, invoiceNumber: i.invoiceNumber, items: i.items, amountCents: i.amountCents, status: i.status })),
        });
      } finally {
        tx.release();
      }
    } catch (e) {
      if (e instanceof KillBillUnavailable) {
        res.status(503).json({ error: { code: 'billing_unavailable', message: "Payments are paused — our billing system isn't answering. Nothing has been charged." } });
        return;
      }
      next(e);
    }
  });

  router.put('/commissions/:id/maintenance', auth, async (req, res, next) => {
    try {
      const id = (req.params as { id?: string })['id'] ?? '';
      const body = req.body as { plan?: string };
      const plan = body.plan === 'priority' ? 'priority' : body.plan === 'essential' ? 'essential' : null;
      if (!plan) {
        res.status(422).json({ errors: { plan: 'Pick Essential or Priority.' } });
        return;
      }
      const result = await withTransaction(async (tx) => {
        const user = (req as AuthedRequest).user!;
        const commission = await svc.getCommission(tx, id);
        if (!commission || commission.client_id !== user.id) throw new HttpError(404, 'not_found', '');
        const maintenance = (await tx.query(`SELECT * FROM maintenance WHERE commission_id = $1`, [id])).rows[0] as { plan: string; killbill_subscription_id: string } | undefined;
        if (!maintenance) throw new HttpError(404, 'not_found', '');
        if (maintenance.plan === plan) throw new HttpError(409, 'same_plan', '');
        const venue = svc.venueById(commission.venue_id);
        const { MAINTENANCE_PLANS } = await import('../domain/seed.js');
        const planMeta = MAINTENANCE_PLANS[plan];
        const today = dates.localDate(new Date(), venue.time_zone);
        // The change takes effect immediately from the venue-local date; Kill Bill prorates.
        await kb.changePlan(maintenance.killbill_subscription_id, planMeta.kbPlanId, today);
        await tx.query(`UPDATE maintenance SET plan = $2 WHERE commission_id = $1`, [id, plan]);
        const client = (await tx.query(`SELECT name, email FROM app_users WHERE id = $1`, [commission.client_id])).rows[0] as { name: string; email: string };
        const accountId = await kb.ensureAccount(commission.client_id, client.name, client.email);
        // Kill Bill writes the proration invoice asynchronously; give it a moment.
        let proration: KbInvoice | null = null;
        for (let attempt = 0; attempt < 10 && !proration; attempt++) {
          const invoices = await kb.accountInvoices(accountId);
          proration = invoices.find((i) => i.items.some((item) => item.description?.includes('Adjustment'))) ?? null;
          if (!proration) await new Promise((r) => setTimeout(r, 300));
        }
        const eventId = crypto.randomUUID();
        await tx.query(`INSERT INTO crm_events (id, commission_id, event_type, created_at, payload) VALUES ($1, $2, 'maintenance.changed', now(), $3)`, [
          eventId, id, JSON.stringify({ fromPlan: maintenance.plan, toPlan: plan, effectiveDate: today }),
        ]);
        await enqueueJob(tx, 'webhook', id, { eventKind: 'maintenance.changed', eventId }, `crm-${eventId}`);
        return {
          plan,
          previousPlan: maintenance.plan,
          prorationDate: today,
          invoice: proration ? { killbillInvoiceId: proration.invoiceId, items: proration.items, amountCents: proration.amountCents } : null,
        };
      });
      res.json(result);
    } catch (e) {
      if (e instanceof KillBillUnavailable) {
        res.status(503).json({ error: { code: 'billing_unavailable', message: "Payments are paused — our billing system isn't answering. Nothing has been charged." } });
        return;
      }
      next(e);
    }
  });

  // ---------- Jobs (producer) ----------

  router.get('/jobs', auth, async (req, res, next) => {
    try {
      const user = (req as AuthedRequest).user!;
      if (user.role !== 'producer') throw new HttpError(403, 'forbidden', '');
      const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
      const commissionId = typeof req.query['commissionId'] === 'string' ? req.query['commissionId'] : undefined;
      const tx = await pool.connect();
      try {
        let rows;
        if (status && commissionId) {
          rows = await tx.query(`SELECT * FROM jobs WHERE status = $1 AND commission_id = $2 ORDER BY created_at DESC`, [status, commissionId]);
        } else if (status) {
          rows = await tx.query(`SELECT * FROM jobs WHERE status = $1 ORDER BY created_at DESC`, [status]);
        } else if (commissionId) {
          rows = await tx.query(`SELECT * FROM jobs WHERE commission_id = $1 ORDER BY created_at DESC`, [commissionId]);
        } else {
          rows = await tx.query(`SELECT * FROM jobs ORDER BY created_at DESC`);
        }
        res.json({
          jobs: rows.rows.map((j: { id: string; kind: string; commission_id: string | null; status: string; attempts: number; last_error: string | null; created_at: Date; finished_at: Date | null }) => ({
            id: j.id,
            kind: j.kind,
            commissionId: j.commission_id,
            status: j.status,
            attempts: j.attempts,
            lastError: j.last_error,
            createdAt: j.created_at.toISOString(),
            finishedAt: j.finished_at?.toISOString() ?? null,
          })),
        });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  return router;
}
